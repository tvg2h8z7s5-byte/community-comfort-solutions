'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createDatabase } = require('./database');
const { databaseConfig } = require('./config');
const { IDLE_SECONDS } = require('./session-policy');
const directory = path.join(__dirname, 'migrations');
async function migrate(db) {
  return db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(7349012)");
    await client.query(`CREATE TABLE IF NOT EXISTS account_schema_migrations (
      version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const version of fs.readdirSync(directory).filter(file => /^\d+_[a-z_]+\.sql$/.test(file)).sort()) {
      const sql = fs.readFileSync(path.join(directory, version), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM account_schema_migrations WHERE version=$1', [version]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Applied migration has changed.');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO account_schema_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
    }
  });
}
async function cleanup(db) {
  return db.transaction(async client => {
    await client.query('DELETE FROM account_rate_limits WHERE expires_at<=now()');
    await client.query("DELETE FROM account_sessions WHERE expires_at<=now() OR last_seen_at<=now()-$1 * interval '1 second'", [IDLE_SECONDS]);
    await client.query('DELETE FROM account_tokens WHERE expires_at<=now() OR consumed_at IS NOT NULL');
  });
}
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--apply', '--cleanup', '--allow-production'].includes(arg)) ||
      (args.includes('--apply') === args.includes('--cleanup'))) throw new Error('Choose --apply or --cleanup.');
    if (process.env.NODE_ENV === 'production' && !args.includes('--allow-production')) throw new Error('Production requires explicit --allow-production.');
    const db = createDatabase(databaseConfig());
    try {
      await (args.includes('--cleanup') ? cleanup(db) : migrate(db));
      console.log('Account database operation completed.');
    } finally { await db.close(); }
  })().catch(() => {
    console.error('Account database operation failed. Check the selected database, flags and migration state.');
    process.exitCode = 1;
  });
}
module.exports = { migrate, cleanup };
