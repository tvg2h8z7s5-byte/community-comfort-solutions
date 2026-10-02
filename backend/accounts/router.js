'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { contactClientIP } = require('../client-ip');
const security = require('./crypto');
const { accountEmail, receiptEmail } = require('../emails');
const COOKIE = '__Host-ccs_session';
const SESSION_SECONDS = 8 * 60 * 60;
const GENERIC = { ok: true, message: 'If eligible, you will receive an email with the next step.' };
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
function fail(status, message) { const err = new Error(message); err.status = status; throw err; }
function email(value) {
  if (typeof value !== 'string') fail(400, 'Enter a valid email address.');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(normalized)) fail(400, 'Enter a valid email address.');
  return normalized;
}
function fields(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) {
    fail(400, 'Invalid account fields.');
  }
}
function text(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || (required && !value.trim())) fail(400, 'Invalid account fields.');
  return value.trim();
}
function password(value) {
  if (!security.validPassword(value)) fail(400, 'Use a password between 15 and 128 characters.');
  return value;
}
function token(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(400, 'This link is invalid or expired.');
  return value;
}
function sessionCookie(req) {
  const matches = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function createAccountRouter({ db, origin, secret, mailTransport, from }) {
  const router = express.Router();
  const csrf = raw => security.keyedHash(secret, 'csrf:' + raw);
  async function count(scope, identifier, maximum, seconds) {
    const key = security.keyedHash(secret, scope + ':' + identifier);
    const result = await db.query(`INSERT INTO account_rate_limits(key_hash,count,expires_at)
      VALUES($1,1,now()+$2 * interval '1 second')
      ON CONFLICT(key_hash) DO UPDATE SET
        count=CASE WHEN account_rate_limits.expires_at <= now() THEN 1 ELSE account_rate_limits.count+1 END,
        expires_at=CASE WHEN account_rate_limits.expires_at <= now() THEN excluded.expires_at ELSE account_rate_limits.expires_at END
      RETURNING count`, [key, seconds]);
    if (result.rows[0].count > maximum) fail(429, 'Too many attempts. Please try again later.');
  }
  async function limits(req, action, address) {
    await count(action + ':ip', contactClientIP(req), 20, 900);
    if (address) await count(action + ':account', address, 5, 900);
  }
  async function notify(account, purpose) {
    // Invalidate previous links only after a replacement has been delivered.
    await count('email', account.email, 6, 86400);
    const raw = security.randomToken();
    const hash = security.tokenHash(raw);
    await db.query(`INSERT INTO account_tokens(token_hash,account_id,purpose,expires_at)
      VALUES($1,$2,$3,now()+$4 * interval '1 second')`, [hash, account.id, purpose, purpose === 'verify' ? 86400 : 1800]);
    const url = `${origin}/account/${purpose === 'verify' ? 'verify' : 'reset'}#token=${raw}`;
    try {
      await mailTransport.sendMail({ from, to: account.email, replyTo: from, ...accountEmail(purpose, url) });
    } catch (_) {
      await db.query('DELETE FROM account_tokens WHERE token_hash=$1', [hash]);
      console.error('Account email delivery failed.');
      // Keep the response generic, allowing verification resend/recovery retries.
      return;
    }
    await db.query(`UPDATE account_tokens SET consumed_at=now() WHERE account_id=$1 AND purpose=$2
      AND issued_order < (SELECT issued_order FROM account_tokens WHERE token_hash=$3) AND consumed_at IS NULL`, [account.id, purpose, hash]);
  }
  async function authenticated(req) {
    const raw = sessionCookie(req);
    if (!raw) fail(401, 'Please sign in.');
    const result = await db.query(`UPDATE account_sessions s SET last_seen_at=now()
      FROM customer_accounts a WHERE s.account_id=a.id AND s.session_hash=$1
      AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'
      AND a.verified_at IS NOT NULL AND a.state='active'
      RETURNING a.id,a.email,a.name,a.phone,a.role`, [security.tokenHash(raw)]);
    if (!result.rows.length) fail(401, 'Please sign in.');
    if (!['GET', 'HEAD'].includes(req.method) && !security.equalToken(req.get('x-csrf-token'), csrf(raw))) fail(403, 'Invalid request.');
    return { account: result.rows[0], raw };
  }
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    if (!req.secure) return res.status(403).json({ ok: false, error: 'HTTPS is required.' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('origin') !== origin || !req.is('application/json')) return res.status(403).json({ ok: false, error: 'Invalid request origin or content type.' });
    }
    next();
  });
  const normalJSON = express.json({ limit: '8kb', strict: true });
  const billingJSON = express.json({ limit: '32kb', strict: true });
  router.use((req,res,next) => (req.path.startsWith('/admin/billing/') ? billingJSON : normalJSON)(req,res,next));
  router.post('/register', asyncRoute(async (req, res) => {
    fields(req.body, ['email', 'password']);
    const address = email(req.body.email);
    const pass = password(req.body.password);
    await limits(req, 'register', address);
    const hash = await security.hashPassword(pass);
    const result = await db.query(`INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3)
      ON CONFLICT(email) DO NOTHING RETURNING id,email`, [randomUUID(), address, hash]);
    if (result.rows.length) await notify(result.rows[0], 'verify');
    res.json(GENERIC);
  }));
  for (const [route, purpose] of [['resend-verification', 'verify'], ['forgot-password', 'reset']]) {
    router.post('/' + route, asyncRoute(async (req, res) => {
      fields(req.body, ['email']);
      const address = email(req.body.email);
      await limits(req, route, address);
      const result = await db.query('SELECT id,email,verified_at,state FROM customer_accounts WHERE email=$1', [address]);
      const account = result.rows[0];
      // Same outbound-email budget check regardless of account eligibility.
      if (account && account.state === 'active' && (purpose === 'reset' ? !!account.verified_at : !account.verified_at)) await notify(account, purpose);
      else await count('email', address, 6, 86400);
      res.json(GENERIC);
    }));
  }
  router.post('/verify-email', asyncRoute(async (req, res) => {
    fields(req.body, ['token']);
    await limits(req, 'verify');
    const hash = security.tokenHash(token(req.body.token));
    await db.transaction(async client => {
      const result = await client.query(`SELECT t.account_id FROM account_tokens t JOIN customer_accounts a ON a.id=t.account_id
        WHERE t.token_hash=$1 AND t.purpose='verify' AND t.consumed_at IS NULL AND t.expires_at>now() AND a.state='active' FOR UPDATE OF a,t`, [hash]);
      if (!result.rows.length) fail(400, 'This link is invalid or expired.');
      await client.query('UPDATE customer_accounts SET verified_at=coalesce(verified_at,now()),updated_at=now() WHERE id=$1', [result.rows[0].account_id]);
      await client.query("UPDATE account_tokens SET consumed_at=now() WHERE account_id=$1 AND purpose='verify' AND consumed_at IS NULL", [result.rows[0].account_id]);
    });
    res.json({ ok: true });
  }));
  router.post('/reset-password', asyncRoute(async (req, res) => {
    fields(req.body, ['token', 'password']);
    await limits(req, 'reset');
    const hash = security.tokenHash(token(req.body.token));
    const encoded = await security.hashPassword(password(req.body.password));
    await db.transaction(async client => {
      const result = await client.query(`SELECT t.account_id FROM account_tokens t JOIN customer_accounts a ON a.id=t.account_id
        WHERE t.token_hash=$1 AND t.purpose='reset' AND t.consumed_at IS NULL AND t.expires_at>now()
        AND a.verified_at IS NOT NULL AND a.state='active' FOR UPDATE OF a,t`, [hash]);
      if (!result.rows.length) fail(400, 'This link is invalid or expired.');
      const id = result.rows[0].account_id;
      await client.query('UPDATE customer_accounts SET password_hash=$1,updated_at=now() WHERE id=$2', [encoded, id]);
      await client.query("UPDATE account_tokens SET consumed_at=now() WHERE account_id=$1 AND purpose='reset' AND consumed_at IS NULL", [id]);
      await client.query('DELETE FROM account_sessions WHERE account_id=$1', [id]);
    });
    res.json({ ok: true });
  }));
  router.post('/login', asyncRoute(async (req, res) => {
    fields(req.body, ['email', 'password']);
    const address = email(req.body.email);
    const pass = password(req.body.password);
    await limits(req, 'login', address);
    const raw = security.randomToken();
    const account = await db.transaction(async client => {
      // Serialize password recovery/suspension against login session creation.
      const result = await client.query('SELECT id,email,password_hash,verified_at,state,name,phone,role FROM customer_accounts WHERE email=$1 FOR UPDATE', [address]);
      const row = result.rows[0];
      const valid = await security.verifyPassword(pass, row?.password_hash);
      if (!valid || !row.verified_at || row.state !== 'active') fail(401, 'Unable to sign in with these details.');
      const previous = sessionCookie(req);
      if (previous) await client.query('DELETE FROM account_sessions WHERE session_hash=$1', [security.tokenHash(previous)]);
      await client.query(`INSERT INTO account_sessions(session_hash,account_id,expires_at)
        VALUES($1,$2,now()+$3 * interval '1 second')`, [security.tokenHash(raw), row.id, SESSION_SECONDS]);
      return { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role };
    });
    res.cookie(COOKIE, raw, { secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS * 1000 });
    res.json({ ok: true, account, csrfToken: csrf(raw) });
  }));
  router.get('/session', asyncRoute(async (req, res) => {
    const { account, raw } = await authenticated(req);
    res.json({ ok: true, account, csrfToken: csrf(raw) });
  }));
  router.post('/logout', asyncRoute(async (req, res) => {
    fields(req.body, []);
    const { raw } = await authenticated(req);
    await db.query('DELETE FROM account_sessions WHERE session_hash=$1', [security.tokenHash(raw)]);
    res.clearCookie(COOKIE, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  }));
  router.patch('/profile', asyncRoute(async (req, res) => {
    fields(req.body, ['name', 'phone']);
    const { account } = await authenticated(req);
    const result = await db.query('UPDATE customer_accounts SET name=$1,phone=$2,updated_at=now() WHERE id=$3 RETURNING id,email,name,phone,role',
      [text(req.body.name, 100, true), text(req.body.phone, 40), account.id]);
    res.json({ ok: true, account: result.rows[0] });
  }));
  router.get('/addresses', asyncRoute(async (req, res) => {
    const { account } = await authenticated(req);
    const result = await db.query('SELECT id,label,line1,line2,city,region,postal_code,country FROM customer_addresses WHERE account_id=$1 ORDER BY created_at,id', [account.id]);
    res.json({ ok: true, addresses: result.rows });
  }));
  router.post('/addresses', asyncRoute(async (req, res) => {
    fields(req.body, ['label', 'line1', 'line2', 'city', 'region', 'postal_code', 'country']);
    const { account } = await authenticated(req);
    const country = text(req.body.country === undefined ? 'US' : req.body.country, 2, true);
    if (!/^[A-Z]{2}$/.test(country)) fail(400, 'Invalid account fields.');
    const values = [randomUUID(), account.id, text(req.body.label, 60), text(req.body.line1, 200, true), text(req.body.line2, 200),
      text(req.body.city, 100, true), text(req.body.region, 100, true), text(req.body.postal_code, 20, true), country];
    const result = await db.transaction(async client => {
      await client.query('SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE', [account.id]);
      const total = await client.query('SELECT count(*)::int AS count FROM customer_addresses WHERE account_id=$1', [account.id]);
      if (total.rows[0].count >= 20) fail(400, 'Address limit reached.');
      return client.query(`INSERT INTO customer_addresses(id,account_id,label,line1,line2,city,region,postal_code,country)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,label,line1,line2,city,region,postal_code,country`, values);
    });
    res.status(201).json({ ok: true, address: result.rows[0] });
  }));
  require('./portal').installPortal(router, { db, authenticated, fields, text, fail, count, origin, notifications: require('./notifications').createRequestNotifications({db, mailTransport, from}), notifyRequest: async (account, request) => {
    try {
      await mailTransport.sendMail({ from, to: account.email, replyTo: from,
        ...receiptEmail({name: account.name, kind: 'service', portalUrl: origin+'/account/dashboard', rows: [
          ['Request reference', request.id], ['Service', request.service],
          ['Preferred day', request.preferred_day], ['Description', request.description]
        ]}) });
    } catch (_) {
      // The request is already saved; never encourage duplicate submissions.
      console.error('Service request acknowledgment delivery failed.');
    }
  } });
  require('./billing').installBilling(router, { db, authenticated, fields, fail });
  const pages = express.Router();
  pages.use((req,res,next)=> { if(!req.secure) return res.status(403).send('HTTPS is required.'); res.set({'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}); next(); });
  pages.get(['/dashboard','/admin','/contractor'], asyncRoute(async(req,res)=> {
    let account;
    try { ({account}=await authenticated(req)); }
    catch(err) { if(err.status===401) return res.redirect('/account/login'); throw err; }
    const target=account.role==='admin' ? '/admin' : account.role==='contractor' ? '/contractor' : '/dashboard';
    if(req.path!==target) return res.redirect('/account'+target);
    res.sendFile(require('node:path').join(__dirname,'views','dashboard.html'));
  }));
  router.pages = pages;
  router.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  router.use((err, _req, res, _next) => {
    const status = [400, 401, 403, 404, 409, 429, 503].includes(err.status) ? err.status : err.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) console.error('Account request failed.');
    if (status === 429 || status === 503) res.set('Retry-After', status === 429 ? '900' : '5');
    res.status(status).json({ ok: false, error: status === 500 ? 'Unable to process your request.' :
      status === 413 ? 'Request is too large.' : err instanceof SyntaxError ? 'Invalid account fields.' : err.message });
  });
  return router;
}
module.exports = { createAccountRouter };
