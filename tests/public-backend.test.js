'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../backend/server');
async function withApp(transport, run) {
  const server = createApp(transport).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, body, headers = {}) => fetch(`${base}/api/contact`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
test('pages, 404 status and headers cover static and API responses', async () => {
  await withApp({ sendMail: async () => {} }, async base => {
    for (const route of ['/', '/contact.html', '/api/health', '/assets/logo-mark.svg']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    }
    for (const route of ['/missing/nested', '/404.html']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404);
      assert.match(await response.text(), /href="\/services.html"/);
    }
    const response = await fetch(base + '/api/missing');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: 'Not found.' });
  });
});
test('form email contract, honeypot and hostile input', async () => {
  const sent = [];
  await withApp({ sendMail: async message => sent.push(message) }, async base => {
    assert.equal((await post(base, {name:'Test <visitor>',email:'visitor@example.com',message:'<script>bad</script>'})).status, 200);
    assert.equal(sent.length, 1);
    assert.match(sent[0].html, /&lt;script&gt;/);
    assert.equal(sent[0].replyTo.address, 'visitor@example.com');
    assert.equal((await post(base, { _gotcha:'bot' })).status, 200);
    assert.equal(sent.length, 1);
    assert.equal((await post(base, {name: ['duplicate'], phone:'123'})).status, 400);
    assert.equal((await post(base, {name:'Test',email:'bad\r\nBcc: bad@example.com'})).status, 400);
    assert.equal((await post(base, {name:'Test',phone:'123'}, {Origin:'https://untrusted.example'})).status, 403);
    assert.equal((await post(base, {name:'Test',phone:'123',message:'a'.repeat(4001)})).status, 400);
  });
});
test('urlencoded and multipart forms remain supported; body limits and safe parser errors', async () => {
  await withApp({ sendMail: async () => {} }, async base => {
    let response = await fetch(base+'/api/contact', {method:'POST',body:new URLSearchParams({name:'Test',phone:'123'})});
    assert.equal(response.status,200);
    const form = new FormData();form.set('name','Test');form.set('phone','123');
    assert.equal((await fetch(base+'/api/contact',{method:'POST',body:form})).status,200);
    response = await post(base,{message:'a'.repeat(34000)});
    assert.equal(response.status,413);
    assert.deepEqual(await response.json(),{ok:false,error:'Request is too large.'});
    response = await fetch(base+'/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'});
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{ok:false,error:'Invalid form data.'});
    const oversized = new FormData();oversized.set('message','a'.repeat(17000));
    assert.equal((await fetch(base+'/api/contact',{method:'POST',body:oversized})).status,413);
  });
});
test('mail failures never disclose SMTP diagnostics', async () => {
  await withApp({sendMail:async()=>{throw new Error('sensitive SMTP response');}}, async base => {
    const response=await post(base,{name:'Test',phone:'123'});
    assert.equal(response.status,502);
    const body=await response.text();assert.doesNotMatch(body,/sensitive|diagnostic|stack/);
  });
});
test('contact rate limit preserves the existing six requests per window', async () => {
  await withApp({sendMail:async()=>{}},async base=>{
    for(let i=0;i<6;i++)assert.equal((await post(base,{_gotcha:'bot'})).status,200);
    const response=await post(base,{_gotcha:'bot'});assert.equal(response.status,429);
    assert.equal((await response.json()).ok,false);
  });
});

test('upgraded Nodemailer delivers the form through a local SMTP test server', async () => {
  const net = require('node:net');
  const { createRequire } = require('node:module');
  const nodemailer = createRequire(require.resolve('../backend/server'))('nodemailer');
  const messages = [];
  const commands = [];
  const smtp = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '', inData = false, message = '';
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { messages.push(message); inData = false; socket.write('250 Accepted\r\n'); }
          else message += line + '\r\n';
          continue;
        }
        const command = line.split(' ')[0].toUpperCase(); commands.push(command);
        if (command === 'EHLO') socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (command === 'AUTH') socket.write('235 Authenticated\r\n');
        else if (command === 'DATA') { inData = true; message = ''; socket.write('354 Send message\r\n'); }
        else if (command === 'QUIT') socket.end('221 Goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => smtp.once('listening', resolve));
  // Synthetic credentials and a loopback SMTP server only; no external mail.
  const transport = nodemailer.createTransport({host:'127.0.0.1', port:smtp.address().port,
    secure:false, ignoreTLS:true, auth:{user:'local-test',pass:'local-test'},
    connectionTimeout:3000, socketTimeout:3000});
  try {
    await withApp(transport, async base => {
      const response = await post(base, {name:'SMTP Test', email:'visitor@example.com',
        message:'Local delivery check', _subject:'New SERVICE REQUEST'});
      assert.equal(response.status, 200);
      assert.equal(messages.length, 1);
      assert(commands.includes('AUTH'));
      assert.match(messages[0], /Reply-To: SMTP Test <visitor@example.com>/);
      assert.match(messages[0], /Subject: New SERVICE REQUEST \(SMTP Test\)/);
      assert.match(messages[0], /Local delivery check/);
    });
  } finally {
    transport.close();
    await new Promise(resolve => smtp.close(resolve));
  }
});
