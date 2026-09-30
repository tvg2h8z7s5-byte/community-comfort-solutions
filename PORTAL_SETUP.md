# Community Comfort Solutions account portals

This update extends the existing Express + PostgreSQL application. It retains the
public website, email forms, verification links, password recovery, and cookie
sessions. It is a source update, not a live deployment.

## What is included

- Responsive login, customer registration, verification, resend verification,
  forgotten password, and password-reset pages.
- Customer overview, service-request creation/history, saved service addresses,
  equipment records, profile updates, and sign-out.
- Admin overview with real counts, searchable/paginated customer and contractor
  directories, account details (contact, addresses, equipment, requests), and
  a request queue with status, customer-visible updates, and private staff notes.
- Contractor roles and their own profile/holding page. Full contractor tools are
  deferred. No contractor or admin role selection is exposed during signup.
- A My Account link in the shared public navigation.

## Permission model

| Role | Access |
| --- | --- |
| Customer | Own profile, own addresses/equipment, own requests and team updates |
| Admin | Own profile; all customer/contractor records exposed by the directory; all portal service requests and private staff notes |
| Contractor | Own profile and a dashboard-coming-later page |

The server obtains roles and ownership from the database on every authenticated
request. Public registration always creates a customer. Private pages require a
session and redirect to the correct role's page. Password hashes, token hashes,
session identifiers, and abuse counters are not exposed in admin responses.
Public assets contain no records. Service requests are saved in PostgreSQL, not
localStorage; session cookies remain Secure and HttpOnly. Seven-day idle and
thirty-day absolute expiry, exact-origin checks, CSRF headers, and authentication abuse
limits remain in force.

## Upload and deployment order

1. Review `changes.patch`, or copy the update ZIP's `files/` contents over the
   existing repository root, preserving the paths. Commit those changes to your
   GitHub main branch when ready. Do not replace the repository with only the
   files in the update: this ZIP contains changed/new files only.
2. Apply `002_portals.sql` using the existing migration tool and migration role
   against **ccs_business**, after confirming your recent backup. Never change
   the already-applied `001_accounts.sql`. The migration creates equipment and
   request tables and defaults every existing account's role to customer.
3. Grant the website runtime role access to the new tables. With your migration
   / database administrator credentials, run:

   ```sql
   GRANT SELECT, INSERT, UPDATE ON customer_equipment, service_requests TO ccs_app;
   ```

   Existing table/sequence grants from the account foundation remain necessary.
   The runtime role must not receive schema CREATE or migration privileges.
4. Redeploy the website in Coolify. If accounts are already enabled, apply the
   migration **before** starting the new backend because startup checks the new
   schema. If accounts are disabled, deploy with `AUTH_ENABLED=false`, migrate,
   check grants, and then enable. Set `AUTH_PUBLIC_URL` to your exact HTTPS
   origin; preserve the existing PG, SMTP, and AUTH_SECRET values.
5. From the deployed website container, run the read-only check:

   ```sh
   node /app/backend/accounts/check.js
   ```

   Use `node /app/backend/accounts/migrate.js --apply --allow-production` only
   in a process configured with the migration role's credentials. Do not switch
   the permanent website runtime credentials to the migration user.
6. Create your own customer account, verify its email, then provision it as the
   first admin from the website container (substitute your email):

   ```sh
   node /app/backend/accounts/set-role.js YOUR_EMAIL admin --allow-production
   ```

   This revokes existing sessions. Sign in again to reach the admin dashboard.
   To provision a contractor later, have them register and verify, then run the
   same operator command with `contractor` instead of `admin`. No default admin
   password or auto-admin based on signup order is included.

## Routes

- `/account/login`, `/account/register`, `/account/forgot`, `/account/resend`
- `/account/verify#token=...`, `/account/reset#token=...` (sent by email)
- `/account/dashboard` (customer), `/account/admin`, `/account/contractor`

Keep Cloudflare caching bypassed for `/account/*` and `/api/account/*`. The server
sets no-store headers; existing proxy HTTPS behavior and cookies must also be
verified on the deployed origin. Do not deploy these private HTML views as static
files: they live inside `backend/accounts/views/` and use the server's routes.

## What the first release deliberately leaves for later

No payments, invoices, contractor assignments, maintenance-plan enrollment,
account deletion/suspension UI, role-editing UI, calendar availability, or file
uploads are included. Addresses/equipment can be added and viewed; editing and
removal are deferred so referenced service information is retained. Admins can
view the contractor information currently stored: name, email, phone, role,
verification state, joined date, and any saved records. Credentials are excluded.

Public contact/schedule forms still email the company and do not import into the
portal request queue. A portal request is a request, not a booked visit. Staff
arrange the appointment directly; the portal records status and the customer
update. Admin updates do not send notifications by email. Request lists cap at
200 per account; admin lists paginate in groups of 25.

Native PostgreSQL deployment behavior, live email delivery, HTTPS/proxy routing,
and actual backup restoration still need deployment verification. Embedded SQL
and browser fixtures validate local logic/layout, not those production services.
The current authentication foundation has no MFA or breached-password service;
those can be added in a subsequent hardening phase.

## Local checks

```sh
npm ci --prefix backend
npm test --prefix backend
python3 tests/check-public-site.py
node scripts/sync-layout.js --check
# With Playwright installed and Chromium available:
node tests/portal-browser.js
node tests/browser-smoke.js
```

Browser fixtures use fake names and records only inside the test; production pages
load actual session/API data and display empty states for missing records.
