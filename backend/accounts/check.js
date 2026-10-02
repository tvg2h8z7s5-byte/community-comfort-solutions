'use strict';
const { databaseConfig } = require('./config');
const { createDatabase } = require('./database');
async function checkDatabase(db) {
  const result = await db.query(`SELECT current_user AS db_user, current_database() AS database,
    r.rolsuper AS superuser, r.rolcreatedb AS create_database, r.rolcreaterole AS create_role,
    has_schema_privilege(current_user,'public','CREATE') AS change_structure,
    has_table_privilege(current_user,'public.account_schema_migrations','UPDATE') AS edit_migrations
    FROM pg_roles r WHERE r.rolname=current_user`);
  const row = result.rows[0];
  if (!row || row.superuser || row.create_database || row.create_role || row.change_structure || row.edit_migrations) {
    throw new Error('Use the restricted runtime database role.');
  }
  // Parse/select every runtime table without reading customer data.
  for (const table of ['customer_accounts', 'customer_addresses', 'account_tokens', 'account_sessions', 'account_rate_limits', 'customer_equipment', 'service_requests', 'service_request_emails', 'billing_pricebook', 'billing_settings', 'billing_counters', 'billing_documents', 'billing_payments']) {
    await db.query(`SELECT 1 FROM public.${table} LIMIT 0`);
  }
  return { user: row.db_user, database: row.database };
}
if (require.main === module) {
  (async () => {
    const db = createDatabase(databaseConfig());
    try {
      const result = await checkDatabase(db);
      console.log(`Account database connection verified: user=${result.user}, database=${result.database}.`);
    } finally { await db.close(); }
  })().catch(() => {
    console.error('Account database check failed. Check internal connectivity, configuration and runtime permissions.');
    process.exitCode = 1;
  });
}
module.exports = { checkDatabase };
