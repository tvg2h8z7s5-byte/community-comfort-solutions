'use strict';
function accountConfig(env = process.env) {
  if (env.AUTH_ENABLED === undefined || env.AUTH_ENABLED === 'false') return null;
  if (env.AUTH_ENABLED !== 'true') throw new Error('AUTH_ENABLED must be true or false.');
  const url = new URL(env.AUTH_PUBLIC_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('AUTH_PUBLIC_URL must be an HTTPS origin without a path.');
  }
  const db = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || !db.pathname.slice(1)) {
    throw new Error('DATABASE_URL must specify the separate business PostgreSQL database.');
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(env.AUTH_SECRET || '')) throw new Error('AUTH_SECRET must encode 32 random bytes in base64.');
  const secret = Buffer.from(env.AUTH_SECRET, 'base64');
  if (secret.length !== 32 || secret.toString('base64') !== env.AUTH_SECRET) throw new Error('Invalid AUTH_SECRET.');
  return { origin: url.origin, secret, connectionString: env.DATABASE_URL };
}
module.exports = { accountConfig };
