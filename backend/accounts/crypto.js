'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
let hashing = false;
// One memory-heavy operation at a time. Reject bursts instead of queueing secrets.
async function derive(password, salt) {
  if (hashing) { const err = new Error('Password processing busy'); err.status = 503; throw err; }
  hashing = true;
  try { return await scrypt(password, salt, 64, options); }
  finally { hashing = false; }
}
function validPassword(value) {
  return typeof value === 'string' && [...value].length >= 15 && [...value].length <= 128 && Buffer.byteLength(value) <= 512;
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt:131072:8:1:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const match = /^scrypt:131072:8:1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded || '');
  // Missing accounts still incur the same password work.
  const actual = await derive(password, match ? match[1] : '0'.repeat(32));
  const expected = Buffer.from(match ? match[2] : '0'.repeat(128), 'hex');
  return crypto.timingSafeEqual(actual, expected) && !!match;
}
const randomToken = () => crypto.randomBytes(32).toString('hex');
const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
const keyedHash = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
function equalToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
    crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
module.exports = { validPassword, hashPassword, verifyPassword, randomToken, tokenHash, keyedHash, equalToken };
