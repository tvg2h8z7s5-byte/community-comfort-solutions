'use strict';
const { Pool } = require('pg');
function createDatabase(connection) {
  const options = typeof connection === 'string' ? { connectionString: connection } : connection;
  const pool = new Pool({ ...options, max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, statement_timeout: 5000, application_name: 'ccs-accounts' });
  pool.on('error', () => console.error('Account database connection failed.'));
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
module.exports = { createDatabase };
