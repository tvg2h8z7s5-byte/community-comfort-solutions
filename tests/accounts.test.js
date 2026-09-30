'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { createApp } = require('../backend/server');
const { migrate, cleanup } = require('../backend/accounts/migrate');
const { accountConfig } = require('../backend/accounts/config');
const crypto = require('../backend/accounts/crypto');
const ORIGIN = 'https://accounts.example.test';
const PASSWORD = 'a long unique test password';
async function withAccounts(run) {
  const engine = new PGlite();
  await engine.waitReady;
  let pending = Promise.resolve();
  function serial(fn) { const result = pending.then(fn); pending = result.catch(() => {}); return result; }
  const client = { query: (sql, values) => values ? engine.query(sql, values) :
    /;/.test(sql) ? engine.exec(sql).then(() => ({ rows: [] })) : engine.query(sql) };
  const db = {
    query: (sql, values) => serial(() => client.query(sql, values)),
    transaction: fn => serial(() => engine.transaction(tx => fn({ query: (sql, values) => values ? tx.query(sql, values) :
      /;/.test(sql) ? tx.exec(sql).then(() => ({ rows: [] })) : tx.query(sql) }))),
  };
  await migrate(db);
  const messages = [];
  let mailFails = false;
  const transport = { sendMail: async msg => { if (mailFails) throw new Error('secret SMTP diagnostics'); messages.push(msg); } };
  const secret = randomBytes(32);
  const server = createApp(transport, [ORIGIN], { db, origin: ORIGIN, secret }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, body, options = {}) {
    const method = options.method || (body === undefined ? 'GET' : 'POST');
    return fetch(base + '/api/account/' + route, { method,
      headers: { 'X-Forwarded-Proto': 'https', Origin: ORIGIN, 'Content-Type': 'application/json', ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const latestToken = () => /#token=([a-f0-9]{64})/.exec(messages.at(-1).text)[1];
  async function register(address) {
    assert.equal((await request('register', { email: address, password: PASSWORD })).status, 200);
    return latestToken();
  }
  async function login(address) {
    const response = await request('login', { email: address, password: PASSWORD });
    assert.equal(response.status, 200);
    const value = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: value.csrfToken, account: value.account,
      header: response.headers.get('set-cookie') };
  }
  try { await run({ db, request, messages, latestToken, register, login, setMailFailure: value => { mailFails = value; }, base }); }
  finally { await new Promise(resolve => server.close(resolve)); await engine.close(); }
}
test('account configuration is off by default and rejects incomplete/insecure settings', () => {
  assert.equal(accountConfig({}), null);
  assert.equal(accountConfig({ AUTH_ENABLED: 'false' }), null);
  const valid = { AUTH_ENABLED: 'true', AUTH_PUBLIC_URL: ORIGIN, DATABASE_URL: 'postgres://test:test@localhost/business', AUTH_SECRET: randomBytes(32).toString('base64') };
  assert.equal(accountConfig(valid).origin, ORIGIN);
  for (const override of [{ AUTH_ENABLED: 'yes' }, { AUTH_PUBLIC_URL: 'http://example.test' }, { AUTH_PUBLIC_URL: ORIGIN + '/path' },
    { AUTH_PUBLIC_URL: 'https://user:secret@example.test' }, { AUTH_SECRET: 'weak' }, { DATABASE_URL: 'https://example.test' }]) {
    assert.throws(() => accountConfig({ ...valid, ...override }));
  }
});
test('password hashes are salted, checked safely and memory-heavy concurrency is bounded', async () => {
  assert.equal(crypto.validPassword('short'), false);
  const task = crypto.hashPassword(PASSWORD);
  await assert.rejects(crypto.hashPassword(PASSWORD), err => err.status === 503);
  const first = await task;
  const second = await crypto.hashPassword(PASSWORD);
  assert.notEqual(first, second);
  assert.equal(await crypto.verifyPassword(PASSWORD, first), true);
  assert.equal(await crypto.verifyPassword('different long password', first), false);
  assert.equal(await crypto.verifyPassword(PASSWORD, 'corrupt'), false);
});
test('SQL migration is repeatable; unique emails, token purposes and ownership foreign keys are enforced', async () => {
  await withAccounts(async ({ db }) => {
    await migrate(db);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM account_schema_migrations')).rows[0].count, 1);
    const id = randomUUID();
    await db.query('INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3)', [id, 'one@example.test', 'fixture']);
    await assert.rejects(db.query('INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3)', [randomUUID(), 'one@example.test', 'fixture']));
    await assert.rejects(db.query('INSERT INTO account_tokens(token_hash,account_id,purpose,expires_at) VALUES($1,$2,$3,now())', ['a'.repeat(64), id, 'admin']));
    await assert.rejects(db.query('INSERT INTO account_sessions(session_hash,account_id,expires_at) VALUES($1,$2,now())', ['b'.repeat(64), randomUUID()]));
    await db.query("UPDATE account_schema_migrations SET checksum=$1", ['0'.repeat(64)]);
    await assert.rejects(migrate(db), /Applied migration has changed/);
  });
});
test('registration, verification, session security, profile ownership, recovery and logout work together', async () => {
  await withAccounts(async ({ db, request, register, login, messages, latestToken }) => {
    const verification = await register('Alice@Example.test');
    const row = (await db.query('SELECT * FROM customer_accounts')).rows[0];
    assert.equal(row.email, 'alice@example.test');
    assert.notEqual(row.password_hash, PASSWORD);
    assert.equal((await db.query('SELECT token_hash FROM account_tokens')).rows[0].token_hash, crypto.tokenHash(verification));
    assert.equal((await request('login', { email: row.email, password: PASSWORD })).status, 401);
    assert.equal((await request('register', { email: row.email, password: PASSWORD })).status, 200);
    assert.equal(messages.length, 1);
    assert.equal((await request('verify-email', { token: verification })).status, 200);
    assert.equal((await request('verify-email', { token: verification })).status, 400);
    const alice = await login(row.email);
    assert.match(alice.header, /Secure/); assert.match(alice.header, /HttpOnly/); assert.match(alice.header, /SameSite=Lax/); assert.match(alice.header, /Path=\//);
    assert.doesNotMatch(alice.header, /Domain=/);
    const auth = { Cookie: alice.cookie, 'X-CSRF-Token': alice.csrf };
    const session = await request('session', undefined, { headers: auth });
    assert.equal(session.status, 200); assert.equal(session.headers.get('cache-control'), 'private, no-store');
    assert.equal((await session.json()).csrfToken, alice.csrf);
    assert.equal((await request('profile', { name: 'Alice' }, { method: 'PATCH', headers: { Cookie: alice.cookie } })).status, 403);
    assert.equal((await request('profile', { name: 'Alice' }, { method: 'PATCH', headers: { Cookie: alice.cookie, 'X-CSRF-Token': '0'.repeat(64) } })).status, 403);
    assert.equal((await request('session', undefined, { headers: { Cookie: alice.cookie + '; ' + alice.cookie } })).status, 401);
    assert.equal((await request('profile', { name: 'Alice', account_id: randomUUID() }, { method: 'PATCH', headers: auth })).status, 400);
    assert.equal((await request('profile', { name: 'Alice', phone: '202-555-0100' }, { method: 'PATCH', headers: auth })).status, 200);
    const added = await request('addresses', { line1: 'Test address', city: 'Test town', region: 'NJ', postal_code: '00000' }, { headers: auth });
    assert.equal(added.status, 201);
    const addressId = (await added.json()).address.id;
    const bobToken = await register('bob@example.test');
    await request('verify-email', { token: bobToken });
    const bob = await login('bob@example.test');
    assert.deepEqual((await (await request('addresses', undefined, { headers: { Cookie: bob.cookie } })).json()).addresses, []);
    assert.equal((await request('addresses/' + addressId, undefined, { headers: { Cookie: bob.cookie } })).status, 404);
    assert.equal((await request('session', undefined, { headers: { Cookie: 'bad=cookie' } })).status, 401);
    assert.equal((await request('forgot-password', { email: row.email })).status, 200);
    const reset = latestToken();
    const nextPassword = 'a completely new test password';
    assert.equal((await request('reset-password', { token: reset, password: nextPassword })).status, 200);
    assert.equal((await request('session', undefined, { headers: auth })).status, 401);
    assert.equal((await request('reset-password', { token: reset, password: nextPassword })).status, 400);
    assert.equal((await request('login', { email: row.email, password: PASSWORD })).status, 401);
    assert.equal((await request('login', { email: row.email, password: nextPassword })).status, 200);
    assert.equal((await request('logout', {}, { headers: { Cookie: bob.cookie, 'X-CSRF-Token': bob.csrf } })).status, 200);
    assert.equal((await request('session', undefined, { headers: { Cookie: bob.cookie } })).status, 401);
  });
});
test('replacement verification links revoke older links and recovery rejects verification tokens', async () => {
  await withAccounts(async ({ request, register, latestToken }) => {
    const oldToken = await register('replace@example.test');
    assert.equal((await request('resend-verification', { email: 'replace@example.test' })).status, 200);
    const replacement = latestToken();
    assert.notEqual(oldToken, replacement);
    assert.equal((await request('verify-email', { token: oldToken })).status, 400);
    assert.equal((await request('reset-password', { token: replacement, password: PASSWORD })).status, 400);
    assert.equal((await request('verify-email', { token: replacement })).status, 200);
  });
});
test('expired links/sessions, suspended accounts, hostile requests and persisted limits fail safely', async () => {
  await withAccounts(async ({ db, request, register, login, base }) => {
    const verify = await register('expiry@example.test');
    await db.query("UPDATE account_tokens SET expires_at=now()-interval '1 second'");
    assert.equal((await request('verify-email', { token: verify })).status, 400);
    await db.query('UPDATE customer_accounts SET verified_at=now()');
    const session = await login('expiry@example.test');
    await db.query("UPDATE account_sessions SET last_seen_at=now()-interval '31 minutes'");
    assert.equal((await request('session', undefined, { headers: { Cookie: session.cookie } })).status, 401);
    await db.query("UPDATE customer_accounts SET state='suspended'");
    assert.equal((await request('login', { email: 'expiry@example.test', password: PASSWORD })).status, 401);
    assert.equal((await request('register', { email: 'valid@example.test', password: PASSWORD, role: 'admin' })).status, 400);
    assert.equal((await request('register', { email: ['bad'], password: PASSWORD })).status, 400);
    assert.equal((await request('register', {}, { headers: { Origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await request('register', {}, { headers: { 'X-Forwarded-Proto': 'http' } })).status, 403);
    assert.equal((await request('register', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 403);
    assert.equal((await request('register', { email: 'valid@example.test', password: 'a'.repeat(9000) })).status, 413);
    const malformed = await fetch(base + '/api/account/register', { method: 'POST', headers: { Origin: ORIGIN, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /SyntaxError|stack|position/);
    for (let i = 0; i < 5; i++) assert.equal((await request('forgot-password', { email: 'unknown@example.test' })).status, 200);
    assert.equal((await request('forgot-password', { email: 'unknown@example.test' })).status, 429);
    assert((await db.query('SELECT * FROM account_rate_limits')).rows.length > 0);
    await db.query("UPDATE account_rate_limits SET expires_at=now()-interval '1 second'");
    await cleanup(db);
    assert.equal((await db.query('SELECT * FROM account_rate_limits')).rows.length, 0);
    assert.equal((await request('forgot-password', { email: 'unknown@example.test' })).status, 200);
  });
});
test('SMTP failures keep accounts recoverable and database failures disclose no diagnostics', async () => {
  await withAccounts(async ({ db, request, messages, setMailFailure }) => {
    setMailFailure(true);
    assert.equal((await request('register', { email: 'mail@example.test', password: PASSWORD })).status, 200);
    assert.equal((await db.query('SELECT * FROM customer_accounts')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM account_tokens')).rows.length, 0);
    setMailFailure(false);
    assert.equal((await request('resend-verification', { email: 'mail@example.test' })).status, 200);
    assert.equal(messages.length, 1);
    await db.query('DROP TABLE account_rate_limits');
    const response = await request('forgot-password', { email: 'mail@example.test' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: 'Unable to process your request.' });
  });
});
