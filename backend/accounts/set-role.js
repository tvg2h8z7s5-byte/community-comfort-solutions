'use strict';
// Explicit operator-only provisioning. Public requests cannot assign roles.
const { createDatabase } = require('./database');
const { databaseConfig } = require('./config');
(async () => {
 const [address, role, ...flags] = process.argv.slice(2);
 if (!address || !['customer','admin','contractor'].includes(role) || flags.some(f => f !== '--allow-production')) throw Error('Usage: node accounts/set-role.js EMAIL ROLE [--allow-production]');
 if (process.env.NODE_ENV === 'production' && !flags.includes('--allow-production')) throw Error('Production requires --allow-production.');
 const db = createDatabase(databaseConfig());
 try {
  await db.transaction(async client => {
   const result = await client.query('UPDATE customer_accounts SET role=$1,updated_at=now() WHERE email=$2 AND verified_at IS NOT NULL RETURNING id', [role,address.trim().toLowerCase()]);
   if (result.rows.length !== 1) throw Error('Register and verify this account first.');
   await client.query('DELETE FROM account_sessions WHERE account_id=$1',[result.rows[0].id]);
  });
  console.log('Account role updated; existing sessions revoked.');
 } finally { await db.close(); }
})().catch(() => { console.error('Role update failed. Check arguments, verified account and database permissions.'); process.exitCode=1; });
