# Community Comfort Solutions invoice management and HVAC operations update

Built against GitHub main commit 04a8d7e (the deployed invoice builder). This is an additive source update, not a live deployment. Migrations 001-004 are unchanged.

## Included

### Invoice and estimate management

- Archive/restore on invoices and estimates. Lists offer Current, Archived, and All records. Archiving does not erase payments, change balances, or hide issued documents from the customer. Financial summary links include archived records.
- Permanent deletion of unissued drafts, with an explicit confirmation. The server rejects issued documents and drafts with payment, email, service-history, or dependent-document records. Numbers are never reused after deletion.
- Duplicate as draft, with a new number and zero payments. It retains customer details and prices but clears the linked request, due date, and previous service notes. Retry of the same duplication action returns the existing duplicate.
- Archive/restore controls for pricebook items. Archived items remain on saved documents and disappear from the builder.
- Email PDF to customer button on issued invoices and issued/accepted estimates. It displays the saved recipient before confirming and uses the existing SMTP configuration. Issuing itself does not send an email. The PDF includes current recorded payment totals at the delivery attempt.
- Durable delivery log with queued/sent/failed/cancelled states, automatic retries, and manual retry for failed or cancelled messages. Sent means the mail server accepted it, not that the customer received/read it. Retries stop after eight attempts and can be restarted manually. The database/SMTP handoff is at-least-once: a crash after SMTP acceptance but before saving the result can cause a duplicate email. Stable Message-ID values help mail systems identify retries but do not guarantee deduplication.

### Equipment service history

- Admin searchable equipment directory (customer, manufacturer, model, serial), last service date, and equipment detail pages.
- Admin equipment creation for an existing registered customer and their saved address. Customers can still add their own equipment as before.
- Completed service records: date, service, findings, work performed, recommendations, technician, linked request, and linked issued invoice.
- Request links must belong to the equipment's customer and service address. Invoice links must belong to that customer and have been issued.
- Customer-visible service reports; private internal notes stay in admin responses only.
- Edit/archive/restore on service entries, with version checks to prevent overwriting a newer edit. Archiving a mistaken report removes it from customer history while retaining it for staff.

### Maintenance plans and reminders

- One active plan per saved system. Track plan name, annual price, active/paused/cancelled status, next service date, renewal date, and customer-visible notes.
- New plan editor suggests $189 annually per system, based on the business's base maintenance plan. No existing customer is enrolled by the migration. Confirm the price and coverage for each enrollment.
- Due-within-14-days and overdue admin filter. Service and renewal dates are due dates, not booked appointments.
- Per-plan automatic email reminders, off by default. Enable them when the customer agrees; customers can also enable/disable reminders in their own dashboard. Choose 0-60 days of lead time.
- One reminder per plan/date/type. Update the next service date after a completed visit to start the next cycle. Paused/cancelled plans, disabled reminders, changed dates, and inactive/unverified accounts cancel stale queued reminders before delivery.
- Customer maintenance-plan view with due dates, annual price, status, notes, and reminder preference controls.

No automatic payment collection, renewal billing, appointment booking, or customer enrollment is performed. Existing manual invoice/payment tools and service-request email notifications remain in place. Maintenance-plan reminders are email only; SMS and push notifications are not included.

## Deployment order

1. Confirm a recent business database backup.
2. Extract the update ZIP and upload/copy the contents of `files/` over the corresponding paths in your GitHub repository. Preserve the full repository; this contains changed/new files only. Do not redeploy until the migration below completes.
3. Open `apply-operations.sql` in Notepad on Windows and copy its entire contents. In your root SSH session run:

   ```sh
   cat > /root/apply-operations.sql
   ```

   Paste the SQL contents (not the Windows filename). Press Enter and Ctrl+D to finish saving. The first lines should be `\set ON_ERROR_STOP on` and `BEGIN;`.

4. Run:

   ```sh
   docker exec -i 6dgna4wavz1rddwt8mwnrskz sh -c 'psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d ccs_business' < /root/apply-operations.sql
   ```

   Expected final output: `DO`, two `GRANT` results, and `COMMIT`. If an error appears, stop and resolve it before redeploying. The script validates the database and migration 004 checksum, applies 005 once, records its checksum, and grants required runtime permissions. It is safe to repeat after success. It does not delete or archive any existing invoices.

   Alternative: use `accounts/migrate.js --apply --allow-production` configured with the migration role, then grant SELECT/INSERT/UPDATE on equipment_service_history, maintenance_plans, operations_emails and DELETE on billing_documents to ccs_app. Do not give the permanent website runtime role schema CREATE or migration access.

5. Redeploy in Coolify. Preserve current database, SMTP, AUTH_SECRET, and public-origin configuration. No new environment variables or npm dependencies are needed.
6. Inside the new website container, run the read-only check:

   ```sh
   node /app/backend/accounts/check.js
   ```

7. Hard-refresh the admin dashboard. New tabs: Equipment & History, Maintenance Plans, Email Delivery. Invoice/estimate details have Archive/Restore, Duplicate, Email PDF, and eligible draft deletion.
8. Verify with a test draft and test customer before emailing actual invoices. Check archive/restore, duplicate, eligible draft deletion, a service report, customer history, and plan preferences. Verify a PDF email reaches your test inbox and its delivery log is updated. Confirm paused/disabled test plans do not send reminders. The delivery worker checks once per minute while the backend is running.

Keep caching bypassed for `/account/*` and `/api/account/*` as before. The script is included both at the ZIP root and under `files/scripts/`.

## Validation and limitations

30 automated tests pass, including account/service/public-form regressions, invoice/payment workflow tests, archive/restore, draft deletion, duplicate retry, queued PDF email, bounded email retry, service-history ownership and internal-note privacy, plan reminders and preference changes, both standalone migration scripts, and DOM-level billing/operations interactions. Public-site resource and layout-sync checks also pass.

Mail tests use fixture transports and embedded PostgreSQL. Live SMTP inbox delivery, native PostgreSQL/Coolify permissions, responsive rendering in customer browsers, and recovery from a real server failure need deployment verification. No production messages were sent during development.

This update covers the earlier equipment history, invoice/payment tracking, and maintenance-reminder requests. Contractor assignment/dispatch, SMS, payment-provider integration, customer e-signatures, and a downloadable application remain future work.
