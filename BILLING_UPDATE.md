# Community Comfort Solutions billing update

For the current invoice archive/delete/duplicate/email tools, equipment service history, and maintenance reminders, see OPERATIONS_UPDATE.md. The setup below documents the original billing release.

Built against GitHub main commit 34bc790. This adds billing to the existing Express/PostgreSQL portals. It does not deploy itself or change account credentials.

## Included

- Admin Pricebook, Estimates, Invoices & Payments, and Invoice Settings tabs.
- One editable starter price: the $109 standard heating tune-up. No invented repair prices.
- Registered customer lookup and saved-address selection, or direct customer entry without a login. Direct-entry invoices are admin-only until a registered customer is linked while the invoice is still a draft.
- Up to 30 service/part lines, fractional quantities (three decimal places), prices, per-line taxable flags, percentage tax (two decimal places), a document discount, service notes, technician name, and due/expiry date.
- Integer-cent server calculations; a discount is allocated proportionally between taxable and non-taxable items. The server does not infer legal tax treatment or rates.
- Draft saving, version checks against overwriting another admin's changes, issue/void actions, manual estimate acceptance/decline recording, and accepted-estimate conversion to one invoice. Conversion retries return the existing invoice.
- PDF downloads with the real CCS logo, blue palette, customer information, service lines, totals, payments, notes, and business terms. Fonts are bundled for consistent rendering inside Docker.
- Manual payment recording with partial balances, paid/unpaid/overdue filters, and summary totals. Payment retries use the same identifier. Overpayments are rejected. Payment-entry reversals retain the original entry and reason.
- Customer dashboard Estimates & Invoices tab: only documents issued to that account, their active recorded payments, and PDF downloads. Drafts and unissued voided drafts remain private.
- Build estimate/invoice links from the admin service-request review dialog.

Issued documents are locked and retain snapshots of customer details, prices, and business settings. There is no hard-delete action. To correct an issued invoice, reverse any incorrect payment entries, void the invoice, and issue a replacement. Voiding an entry does not refund money. For payments that were actually refunded, use your payment provider and keep the appropriate external records.

## Deployment order

1. Confirm a recent database backup. The supplied migration is additive and does not remove existing account/service data.
2. Extract this update ZIP. Copy the contents of `files/` over your repository root, preserving paths. Do not replace the repository with only these files. Commit/upload to GitHub but do not redeploy yet if you want billing ready immediately.
3. Copy `apply-billing.sql` to the VPS and run it from its directory in your SSH session:

   ```sh
   docker exec -i 6dgna4wavz1rddwt8mwnrskz sh -c 'psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d ccs_business' < apply-billing.sql
   ```

   This script checks `ccs_business`, checks migration 003's checksum, acquires the existing migration lock, applies 004 once, records its checksum, and grants the existing `ccs_app` runtime role SELECT/INSERT/UPDATE on the five new billing tables. It is safe to repeat after a successful COMMIT. It must run as the database administrator/migration role; retain restricted `ccs_app` credentials on the website.

   Alternative: use the existing `accounts/migrate.js --apply --allow-production` tool in a process configured with migration-role credentials, then grant the five tables as above. Use one migration route, not both for the initial deployment.

4. Redeploy the website in Coolify. Docker installs the new PDF dependency from the committed lockfile. Preserve all current PG, SMTP, AUTH_SECRET, and AUTH_PUBLIC_URL values.
5. Run the read-only database check inside the new website container:

   ```sh
   node /app/backend/accounts/check.js
   ```

6. Sign into the admin dashboard and open Invoice Settings. Confirm company/contact details, add a business address if appropriate, and enter your own payment/service terms. These are captured when a draft is saved. Confirm the $109 item and set any applicable tax treatment yourself.
7. Create a test draft. Review its draft PDF, issue it, check the linked customer's dashboard, record a small test payment, reverse the test entry with a reason, and void the test document. This keeps a traceable test history. Hard-refresh the dashboard if cached assets appear stale.

`apply-billing.sql` is also in `files/scripts/` for future operator use. Never edit migrations 001-003 or the checksum of an applied migration. Keep caching bypassed for `/account/*` and `/api/account/*`.

## Current boundaries

Payments are recorded manually; this version does not charge cards, collect bank details, or connect to Stripe. Issuing makes a document available to the linked account; it does not automatically email an invoice. Download the PDF and send it through your normal email workflow. Existing service-request email notifications remain unchanged.

The recording's customer-signature capture, dispatch board, full technician assignments, reports, maintenance-plan reminders, equipment service-history entries, and installable mobile application are future additions. Manual estimate acceptance is an admin record of a customer's response, not an electronic signature.

The current release was validated with 27 passing automated tests, including backend account/service regression tests, billing calculations, role/ownership/CSRF checks, PDF downloads, invoice conversion and payment retries/reversal, the standalone migration and repeat-run grants, and a DOM-level dashboard interaction test. PDFs were rendered and inspected for single-page and long-document layouts. Public-site structure and layout-sync checks passed. Full browser layout checks, live PostgreSQL/Coolify behavior, and customer-device downloads should be checked after deployment.
