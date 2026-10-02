'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { createApp } = require('../backend/server');
const { migrate, cleanup } = require('../backend/accounts/migrate');
const { checkDatabase } = require('../backend/accounts/check');
const { accountConfig, databaseConfig } = require('../backend/accounts/config');
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
test('separate database fields preserve special password characters and reject missing/ambiguous configuration', () => {
  // A synthetic fixture, not a real credential.
  const fixture = { PGHOST: 'database-container', PGPORT: '5432', PGDATABASE: 'ccs_business', PGUSER: 'ccs_app', PGPASSWORD: ' test:@/?#%[]+$ password ' };
  const config = databaseConfig(fixture);
  assert.equal(config.password, fixture.PGPASSWORD);
  assert.equal(config.user, 'ccs_app');
  assert.equal(config.port, 5432);
  for (const key of Object.keys(fixture)) assert.throws(() => databaseConfig({ ...fixture, [key]: undefined }));
  for (const port of ['0', '65536', '-1', '5432oops']) assert.throws(() => databaseConfig({ ...fixture, PGPORT: port }));
  assert.throws(() => databaseConfig({ ...fixture, PGHOST: 'https://wrong-host' }));
  assert.throws(() => databaseConfig({ ...fixture, DATABASE_URL: 'postgres://test:test@localhost/business' }));
  const enabled = accountConfig({ ...fixture, AUTH_ENABLED: 'true', AUTH_PUBLIC_URL: ORIGIN, AUTH_SECRET: randomBytes(32).toString('base64') });
  assert.deepEqual(enabled.database, config);
  assert.equal(accountConfig({ ...fixture, AUTH_ENABLED: 'false' }), null);
  assert.deepEqual(databaseConfig({ DATABASE_URL: 'postgres://test:test@localhost/business' }), { connectionString: 'postgres://test:test@localhost/business' });
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
    assert.equal((await db.query('SELECT count(*)::int AS count FROM account_schema_migrations')).rows[0].count, 3);
    const id = randomUUID();
    await db.query('INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3)', [id, 'one@example.test', 'fixture']);
    await assert.rejects(db.query('INSERT INTO customer_accounts(id,email,password_hash) VALUES($1,$2,$3)', [randomUUID(), 'one@example.test', 'fixture']));
    await assert.rejects(db.query('INSERT INTO account_tokens(token_hash,account_id,purpose,expires_at) VALUES($1,$2,$3,now())', ['a'.repeat(64), id, 'admin']));
    await assert.rejects(db.query('INSERT INTO account_sessions(session_hash,account_id,expires_at) VALUES($1,$2,now())', ['b'.repeat(64), randomUUID()]));
    await db.query("UPDATE account_schema_migrations SET checksum=$1", ['0'.repeat(64)]);
    await assert.rejects(migrate(db), /Applied migration has changed/);
  });
});
test('read-only connection check accepts the runtime role and rejects administrator/migration access', async () => {
  await withAccounts(async ({ db }) => {
    await assert.rejects(checkDatabase(db), /restricted runtime/);
    await db.query('CREATE ROLE ccs_app; GRANT USAGE ON SCHEMA public TO ccs_app; GRANT SELECT ON customer_accounts,customer_addresses,account_tokens,account_sessions,account_rate_limits,customer_equipment,service_requests,service_request_emails TO ccs_app');
    await db.query('SET ROLE ccs_app');
    const result = await checkDatabase(db);
    assert.equal(result.user, 'ccs_app');
    await db.query('RESET ROLE');
    await db.query('GRANT CREATE ON SCHEMA public TO ccs_app');
    await db.query('SET ROLE ccs_app');
    await assert.rejects(checkDatabase(db), /restricted runtime/);
    await db.query('RESET ROLE');
  });
});
test('registration, verification, session security, profile ownership, recovery and logout work together', async () => {
  await withAccounts(async ({ db, request, register, login, messages, latestToken }) => {
    const verification = await register('Alice@Example.test');
    assert.match(messages.at(-1).html, /Welcome! Verify your email/);
    assert.match(messages.at(-1).html, /expires in 24 hours/);
    assert.match(messages.at(-1).html, new RegExp(verification));

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
test('portal roles enforce customer ownership and keep admin notes and credentials private', async()=>{
 await withAccounts(async({db,request,base,messages,setMailFailure})=>{
  const users={};
  for(const role of ['customer','admin','contractor']){
   const id=randomUUID(), raw=crypto.randomToken();
   await db.query('INSERT INTO customer_accounts(id,email,password_hash,verified_at,role,name) VALUES($1,$2,$3,now(),$4,$5)',[id,role+'@example.test','unused-fixture',role,role]);
   await db.query("INSERT INTO account_sessions(session_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.tokenHash(raw),id]);
   const cookie='__Host-ccs_session='+raw;
   const response=await request('session',undefined,{headers:{Cookie:cookie}});const session=await response.json();
   assert.equal(session.account.role,role);users[role]={id,headers:{Cookie:cookie,'X-CSRF-Token':session.csrfToken}};
  }
  const customer=users.customer,admin=users.admin,contractor=users.contractor;
  const addressResponse=await request('addresses',{line1:'123 Test St',city:'Old Bridge',region:'NJ',postal_code:'08857'},{headers:customer.headers});
  const address=(await addressResponse.json()).address;
  assert.equal((await request('equipment',{address_id:address.id,name:'Downstairs',type:'Furnace'},{headers:customer.headers})).status,201);
  assert.equal((await request('equipment',undefined,{headers:contractor.headers})).status,403);
  assert.equal((await request('admin/accounts',undefined,{headers:customer.headers})).status,403);
  assert.equal((await request('admin/accounts',undefined,{headers:contractor.headers})).status,403);
  assert.equal((await request('profile',{name:'New',role:'admin'},{method:'PATCH',headers:customer.headers})).status,400);
  assert.equal((await request('register',{email:'attack@example.test',password:PASSWORD,role:'admin'})).status,400);
  const foreignId=randomUUID();
  await db.query('INSERT INTO customer_accounts(id,email,password_hash,verified_at) VALUES($1,$2,$3,now())',[foreignId,'other@example.test','unused']);
  const foreignAddress=randomUUID();await db.query('INSERT INTO customer_addresses(id,account_id,line1,city,region,postal_code) VALUES($1,$2,$3,$4,$5,$6)',[foreignAddress,foreignId,'Other home','Other town','NJ','08857']);
  assert.equal((await request('requests',{address_id:foreignAddress,service:'Diagnosis',description:'Attempt cross-account'},{headers:customer.headers})).status,404);
  const created=await request('requests',{address_id:address.id,service:'Diagnosis',description:'No heat'},{headers:customer.headers});assert.equal(created.status,201);const id=(await created.json()).id;
  assert.equal(messages.at(-1).to,'customer@example.test');
  assert.match(messages.at(-1).text,/within 24 hours/);
  assert.match(messages.at(-1).text,new RegExp(id));
  assert.match(messages.at(-1).html,/View your requests/);
  assert.doesNotMatch(messages.at(-1).text,/internal_notes|Private staff/);
  setMailFailure(true);
  const accepted = await request('requests',{address_id:address.id,service:'Diagnosis',description:'Receipt delivery failure fixture'},{headers:customer.headers});
  assert.equal(accepted.status,201);
  const failedReceiptId=(await accepted.json()).id;
  assert.equal((await db.query('SELECT id FROM service_requests WHERE id=$1',[failedReceiptId])).rows.length,1);
  await db.query('DELETE FROM service_requests WHERE id=$1',[failedReceiptId]);
  setMailFailure(false);

  assert.equal((await request('admin/requests/'+id,{status:'reviewing',customer_update:'We will contact you.',internal_notes:'Private staff details'},{method:'PATCH',headers:customer.headers})).status,403);
  assert.equal((await request('admin/requests/'+id,{status:'reviewing',customer_update:'We will contact you.',internal_notes:'Private staff details'},{method:'PATCH',headers:admin.headers})).status,200);
  assert.equal(messages.at(-1).to,'customer@example.test');
  assert.match(messages.at(-1).text,/We will contact you/);
  assert.doesNotMatch(messages.at(-1).text,/Private staff/);
  const before=messages.length;
  const same={status:'reviewing',customer_update:'We will contact you.',internal_notes:'Private staff details'};
  assert.equal((await request('admin/requests/'+id,same,{method:'PATCH',headers:admin.headers})).status,200);
  assert.equal(messages.length,before,'unchanged public content should not send another email');
  setMailFailure(true);
  const changed={...same,status:'completed',customer_update:'Repair finished.',priority:'urgent',appointment_at:'2026-10-01T14:00:00.000Z',follow_up_on:'2026-10-02'};
  const queued=await (await request('admin/requests/'+id,changed,{method:'PATCH',headers:admin.headers})).json();
  assert.equal(queued.email,'queued');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM service_request_emails WHERE sent_at IS NULL')).rows[0].count,1);
  const resolved=await (await request('admin/requests?status=resolved',undefined,{headers:admin.headers})).json();
  assert.equal(resolved.total,1);assert.equal(resolved.requests[0].priority,'urgent');
  assert.equal((await (await request('admin/requests?status=active',undefined,{headers:admin.headers})).json()).total,0);
  setMailFailure(false);
  await db.query('UPDATE service_request_emails SET next_attempt_at=now() WHERE sent_at IS NULL');
  const worker=require('../backend/accounts/notifications').createRequestNotifications({db,from:'service@example.test',mailTransport:{sendMail:async msg=>messages.push(msg)}});
  await worker.drain();await worker.drain();
  assert.equal(messages.length,before+1,'queued message delivered once');
  assert.match(messages.at(-1).text,/Eastern time/);assert.doesNotMatch(messages.at(-1).text,/Private staff|follow_up|priority/);
  assert.equal((await request('admin/requests/'+id,{...same,priority:'bad'},{method:'PATCH',headers:admin.headers})).status,400);
  assert.equal((await request('admin/requests/'+id,{...same,follow_up_on:'2026-02-30'},{method:'PATCH',headers:admin.headers})).status,400);
  assert.equal((await request('admin/requests/'+id,same,{method:'PATCH',headers:admin.headers})).status,200);
  const own=await (await request('requests',undefined,{headers:customer.headers})).json();assert.equal(own.requests.length,1);assert.equal(own.requests[0].status,'reviewing');assert.equal(own.requests[0].internal_notes,undefined);
  const directory=await (await request('admin/accounts?role=contractor',undefined,{headers:admin.headers})).json();assert.equal(directory.total,1);assert.equal(directory.accounts[0].id,contractor.id);assert.equal(directory.accounts[0].password_hash,undefined);
  const detail=await (await request('admin/accounts/'+customer.id,undefined,{headers:admin.headers})).json();assert.equal(detail.addresses.length,1);assert.equal(detail.equipment.length,1);assert.equal(detail.requests[0].internal_notes,'Private staff details');assert.equal(detail.account.password_hash,undefined);
  assert.equal((await request('admin/requests/'+id,{status:'scheduled'},{method:'PATCH',headers:{Cookie:admin.headers.Cookie}})).status,403);
  assert.equal((await request('admin/accounts?role=admin',undefined,{headers:admin.headers})).status,400);
  const anonymous=await fetch(base+'/account/admin',{redirect:'manual',headers:{'X-Forwarded-Proto':'https'}});assert.equal(anonymous.status,302);assert.equal(anonymous.headers.get('location'),'/account/login');
  const denied=await fetch(base+'/account/admin',{redirect:'manual',headers:{'X-Forwarded-Proto':'https',Cookie:customer.headers.Cookie}});assert.equal(denied.status,302);assert.equal(denied.headers.get('location'),'/account/dashboard');
  const page=await fetch(base+'/account/admin',{headers:{'X-Forwarded-Proto':'https',Cookie:admin.headers.Cookie}});assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'private, no-store');
  await db.query("UPDATE customer_accounts SET state='suspended' WHERE id=$1",[admin.id]);assert.equal((await request('admin/accounts',undefined,{headers:admin.headers})).status,401);
 });
});
