'use strict';
function databaseConfig(env = process.env) {
  const keys = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  if (env.DATABASE_URL) {
    if (keys.some(key => env[key] !== undefined)) throw new Error('Use DATABASE_URL or separate PG fields, not both.');
    let db;
    try { db = new URL(env.DATABASE_URL); }
    catch (_) { throw new Error('Invalid database connection configuration.'); }
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname || !db.pathname.slice(1)) {
      throw new Error('DATABASE_URL must specify the separate business PostgreSQL database.');
    }
    return { connectionString: env.DATABASE_URL };
  }
  if (typeof env.PGHOST !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(env.PGHOST) ||
    !/^\d+$/.test(env.PGPORT || '') || Number(env.PGPORT) < 1 || Number(env.PGPORT) > 65535 ||
    !['PGDATABASE', 'PGUSER', 'PGPASSWORD'].every(key => typeof env[key] === 'string' && env[key].length > 0)) {
    throw new Error('Configure PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD.');
  }
  return { host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE, user: env.PGUSER, password: env.PGPASSWORD };
}
function accountConfig(env = process.env) {
  if (env.AUTH_ENABLED === undefined || env.AUTH_ENABLED === 'false') return null;
  if (env.AUTH_ENABLED !== 'true') throw new Error('AUTH_ENABLED must be true or false.');
  const url = new URL(env.AUTH_PUBLIC_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('AUTH_PUBLIC_URL must be an HTTPS origin without a path.');
  }
  const database = databaseConfig(env);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(env.AUTH_SECRET || '')) throw new Error('AUTH_SECRET must encode 32 random bytes in base64.');
  const secret = Buffer.from(env.AUTH_SECRET, 'base64');
  if (secret.length !== 32 || secret.toString('base64') !== env.AUTH_SECRET) throw new Error('Invalid AUTH_SECRET.');
  return { origin: url.origin, secret, database };
}
module.exports = { accountConfig, databaseConfig };
