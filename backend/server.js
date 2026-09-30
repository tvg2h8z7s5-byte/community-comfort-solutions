'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { contactClientIP } = require('./client-ip');
const SITE_DIR = path.join(__dirname, '..', 'site');

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

if (require.main === module && (!SMTP_HOST || !SMTP_USER || !SMTP_PASS)) {
  console.error('Missing SMTP_HOST / SMTP_USER / SMTP_PASS. Configure the SMTP environment variables before starting.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_SECURE === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  disableFileAccess: true,
  disableUrlAccess: true,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
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
const validEmail = s => /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(s);

const origins = ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

// Hash the existing inline cookie/GPC scripts and structured data, preserving behavior.
const scriptHashes = [...new Set(fs.readdirSync(SITE_DIR).filter(f => f.endsWith('.html')).flatMap(file => {
  const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
}))];

function createApp(mailTransport = transporter, allowedOrigins = origins) {
const app = express();
const upload = multer({ limits: { fieldNameSize: 100, fieldSize: 16000, fields: 16, parts: 16, files: 0 } });
// Preserve the deployed proxy assumption; confirm topology before changing it.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
      "form-action 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'",
      "script-src 'self' " + scriptHashes.join(' '), "connect-src 'self'",
    ].join('; '),
  });
  next();
});
app.get('/404.html', (_req, res) => res.status(404).sendFile(path.join(SITE_DIR, '404.html')));
app.use(express.static(SITE_DIR, { dotfiles: 'deny' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: contactClientIP,
  message: { ok: false, error: 'Too many requests. Please call 917-608-3201.' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/contact', limiter,
  express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 20 }),
  express.json({ limit: '32kb' }), upload.none(), async (req, res) => {
  // Browser-origin check only; non-browser clients can omit Origin.
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const body = req.body || {};
  if (Array.isArray(body) || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid form data.' });
  }
  for (const [key, , max] of [...FIELDS, ['_subject', '', 120], ['_gotcha', '', 50]]) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > max)) {
      return res.status(400).json({ ok: false, error: 'Invalid or overly long form field.' });
    }
  }

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
    await mailTransport.sendMail({
      from: SMTP_FROM,
      to: CONTACT_TO,
      replyTo: data.email && validEmail(data.email) ? { name: data.name, address: data.email } : undefined,
      subject,
      text,
      html: `<table style="font-family:Arial,sans-serif;font-size:14px">${htmlRows}</table>`,
    });
    return res.json({ ok: true });
  } catch (err) {
    // Never log the SMTP response/message: it can include credentials or customer data.
    console.error('Contact email delivery failed.');
    return res.status(502).json({ ok: false, error: 'We could not send your request. Please call 917-608-3201.' });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ ok: false, error: 'Not found.' });
  res.status(404).sendFile(path.join(SITE_DIR, '404.html'), err => { if (err) next(err); });
});
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const tooLarge = err.status === 413 || err.type === 'entity.too.large' || (err instanceof multer.MulterError && err.code !== 'LIMIT_UNEXPECTED_FILE');
  const malformed = err.status === 400 || err instanceof multer.MulterError;
  if (!tooLarge && !malformed) console.error('Public request failed.');
  res.status(tooLarge ? 413 : malformed ? 400 : 500).json({
    ok: false,
    error: tooLarge ? 'Request is too large.' : malformed ? 'Invalid form data.' : 'Unable to process your request.',
  });
});
return app;
}

if (require.main === module) {
  if (!/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535 ||
      !/^\d+$/.test(SMTP_PORT) || Number(SMTP_PORT) < 1 || Number(SMTP_PORT) > 65535 ||
      !['true', 'false'].includes(SMTP_SECURE)) {
    console.error('Invalid port or SMTP secure configuration.');
    process.exit(1);
  }
  const server = createApp().listen(Number(PORT), '0.0.0.0', () => console.log('Public backend listening.'));
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
}
module.exports = { createApp };
