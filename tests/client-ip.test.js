'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contactClientIP } = require('../backend/client-ip');
const request = (peer, ip, visitor, ipv6) => ({socket:{remoteAddress:peer}, ip,
  get: name => name === 'CF-Connecting-IP' ? visitor : ipv6});

test('verified Cloudflare behind the private proxy resolves individual visitors', () => {
  assert.equal(contactClientIP(request('172.18.0.2','172.64.0.1','192.0.2.1')), '192.0.2.1');
  assert.equal(contactClientIP(request('172.18.0.2','172.64.0.1','192.0.2.2')), '192.0.2.2');
  assert.equal(contactClientIP(request('::ffff:172.18.0.2','::ffff:172.64.0.1','::ffff:192.0.2.1')), '192.0.2.1');
  assert.equal(contactClientIP(request('::1','2606:4700::1','2001:db8:0:0:0:0:0:1')), '2001:db8::1');
});
test('direct non-Cloudflare callers cannot use forged Cloudflare headers', () => {
  assert.equal(contactClientIP(request('198.51.100.1','172.64.0.1','192.0.2.1')), '172.64.0.1');
  assert.equal(contactClientIP(request('172.18.0.2','198.51.100.1','192.0.2.1')), '198.51.100.1');
  assert.equal(contactClientIP(request('172.18.0.2','172.72.0.1','192.0.2.1')), '172.72.0.1');
});
test('missing, malformed, duplicate and scoped headers fall back conservatively', () => {
  for (const value of [undefined, '', 'invalid', '192.0.2.1,192.0.2.2', 'fe80::1%eth0']) {
    assert.equal(contactClientIP(request('172.18.0.2','172.64.0.1',value)), '172.64.0.1');
  }
});
test('direct Cloudflare and its pseudo IPv4 mode remain supported', () => {
  assert.equal(contactClientIP(request('172.64.0.1','198.51.100.1','192.0.2.1')), '192.0.2.1');
  assert.equal(contactClientIP(request('172.18.0.2','172.64.0.1','240.0.0.1','2001:db8::1')), '2001:db8::1');
  assert.equal(contactClientIP(request('172.18.0.2','172.64.0.1','192.0.2.1','2001:db8::2')), '192.0.2.1');
});
