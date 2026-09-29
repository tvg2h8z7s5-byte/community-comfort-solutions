'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// --- tiny .env loader (no extra dependency) ---
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch (_) { /* no .env file; rely on real environment */ }

const {
  PORT = '3000',
  CONTACT_TO = 'contact@communitycomfortsolutions.org',
  SMTP_HOST, SMTP_PORT = '587', SMTP_SECURE = 'false', SMTP_USER, SMTP_PASS,
  SMTP_FROM = 'Community Comfort Solutions Website <contact@communitycomfortsolutions.org>',
  ALLOWED_ORIGINS = 'https://communitycomfortsolutions.org,https://www.communitycomfortsolutions.org',
} = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error('Missing SMTP_HOST / SMTP_USER / SMTP_PASS. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_SECURE === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// Fields we accept, with labels and max lengths. Anything else is ignored.
const FIELDS = [
  ['name', 'Name', 100],
  ['phone', 'Phone', 40],
  ['email', 'Email', 200],
  ['town', 'Town', 100],
  ['address', 'Service address', 200],
  ['type', 'Customer type', 40],
  ['system', 'Service needed', 40],
  ['preferred_day', 'Preferred day', 20],
  ['preferred_time', 'Preferred time', 60],
  ['urgency', 'Urgency', 80],
  ['request_type', 'Request type', 80],
  ['message', 'Message', 4000],
];
const ALLOWED_SUBJECT_PREFIXES = [
  'New contact message', 'New SERVICE REQUEST', 'Privacy request',
];

const clean = (v, max) =>
  String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s*\n\s*/g, ' ');
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const origins = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.set('trust proxy', 1); // running behind nginx
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please call 917-608-3201.' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/contact', limiter, async (req, res) => {
  // Reject cross-site posts from other origins (browsers always send Origin on POST)
  const origin = req.get('origin');
  if (origin && !origins.includes(origin)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const body = req.body || {};

  // Honeypot: bots fill the hidden field. Pretend success, send nothing.
  if (clean(body._gotcha, 50)) return res.json({ ok: true });

  const data = {};
  for (const [key, , max] of FIELDS) data[key] = key === 'message' ? clean(body[key], max) : oneLine(body[key], max);

  if (!data.name) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  if (!data.phone && !data.email) return res.status(400).json({ ok: false, error: 'Please enter a phone number or email.' });
  if (data.email && !validEmail(data.email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });

  let subject = oneLine(body._subject, 120) || 'New message - Community Comfort Solutions';
  if (!ALLOWED_SUBJECT_PREFIXES.some(p => subject.startsWith(p))) subject = 'New message - Community Comfort Solutions';
  subject = `${subject} (${data.name})`.slice(0, 200);

  const rows = FIELDS.filter(([k]) => data[k]);
  const text = rows.map(([k, label]) => `${label}: ${data[k]}`).join('\n');
  const htmlRows = rows.map(([k, label]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top"><b>${esc(label)}</b></td><td style="padding:4px 0;white-space:pre-wrap">${esc(data[k])}</td></tr>`).join('');

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: CONTACT_TO,
      replyTo: data.email && validEmail(data.email) ? { name: data.name, address: data.email } : undefined,
      subject,
      text,
      html: `<table style="font-family:Arial,sans-serif;font-size:14px">${htmlRows}</table>`,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Send failed:', err && err.message);
    return res.status(502).json({ ok: false, error: 'We could not send your message. Please call 917-608-3201.' });
  }
});

app.listen(Number(PORT), '0.0.0.0', () => console.log(`Form backend listening on 0.0.0.0:${PORT}`));
