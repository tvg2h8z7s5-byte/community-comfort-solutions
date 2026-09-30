# Customer account backend — local foundation

This phase adds PostgreSQL-backed account APIs. It does **not** provision a live
database or add signup/login screens or a customer portal. Account endpoints
remain unavailable by default. Existing public forms still send through the
existing SMTP transport and do not write customer records.

## Configuration (do not enable in production yet)

| Variable | Meaning |
| --- | --- |
| `AUTH_ENABLED` | Omit or set `false` to keep accounts disabled. Only literal `true` enables them; invalid values fail startup. |
| `AUTH_PUBLIC_URL` | Exact HTTPS origin of the future account UI, for example `https://communitycomfortsolutions.org`. No path, credentials, query or fragment. |
| `PGHOST` | Internal Docker hostname of the separate business database, not localhost or the VPS IP. |
| `PGPORT` | Internal PostgreSQL port, `5432`. |
| `PGDATABASE` | Business database name, `ccs_business`. |
| `PGUSER` | Restricted website user, `ccs_app`; use `ccs_migrator` only for explicit migrations. |
| `PGPASSWORD` | That user's password, entered directly without URL encoding. Supply only through the deployment environment, never Git or chat. |
| `DATABASE_URL` | Alternative connection string. Use either this or the five separate PG fields; mixing them fails validation. |
| `AUTH_SECRET` | Base64 encoding of 32 cryptographically random bytes. Supply through deployment environment; do not commit or share it. |

Existing SMTP variables remain unchanged. Account links are based on the fixed
configured origin, not the request Host header. Links use URL fragments so tokens
are not sent to HTTP/proxy access logs. Reserved paths `/account/verify` and
`/account/reset` require the frontend from the next phase before accounts are
enabled. The frontend must read and clear the fragment, then POST the token;
loading a link alone must never consume a token.

The pool uses at most three connections per Node process, a five-second
connection/query timeout, and no additional Redis service. Native `pg` handles
production connections. Tests use development-only PGlite's embedded PostgreSQL
engine in disposable memory, with fake accounts and a fake mail transport.
PGlite is omitted by the existing Docker `npm ci --omit=dev` command.

After configuring the runtime PG fields, verify the native driver connection
inside the website container with `node /app/backend/accounts/check.js` (or
`npm run accounts:check --prefix backend` from a checkout). This read-only command
checks the restricted role and table access without printing passwords,
connection URLs or customer records. It works while `AUTH_ENABLED=false`; a
successful redeploy alone does not test connectivity while accounts are disabled.

## Schema and explicit migrations

The owner approved PostgreSQL and public signup with verification. Live service
provisioning, credentials, storage and backups still require separate approval.
Do not reuse the `coolify-db` or `coolify-redis` containers.

Use a disposable development/test database first. Supply the five PG fields
(using the migration user) or `DATABASE_URL` securely in that environment, then
run from the repository:

```sh
npm run accounts:migrate --prefix backend
```

Migrations run in one transaction with an advisory lock and a checksum ledger.
Re-running unchanged migrations is safe. Never edit an applied migration; add a
new version. Startup only checks schema availability and never applies migrations.
There is no automated down migration: future production rollback must consider
customer data, backup restore and compatibility rather than dropping tables.

The CLI does not read `.env` files. When `NODE_ENV=production`, it also requires
an explicit `--allow-production` argument. This flag is a guard, not permission
to select a live database; verify the target and backup first. Use a separate
migration role with schema privileges and a limited runtime role with only the
required table/sequence access. No role provisioning SQL is run automatically.

Expired sessions, expired/consumed tokens and expired abuse counters need routine
cleanup after launch. The cleanup command affects those temporary records only:

```sh
npm run accounts:cleanup --prefix backend
```

Its production flag requirement is the same. Schedule it only after agreeing on
the deployment configuration. Unverified account retention/deletion remains an
owner policy decision; cleanup does not delete customer accounts or addresses.

## API contract

Every account response has `Cache-Control: private, no-store` and `noindex`.
HTTPS is required. All writes require an exact configured Origin and JSON body
(8 KiB maximum). No cross-origin CORS access is enabled.

| Method/path under `/api/account` | Input | Behavior |
| --- | --- | --- |
| `POST /register` | `email`, `password` | Creates an unverified customer; generic reply for duplicate email. No role field accepted. |
| `POST /resend-verification` | `email` | Generic reply; sends only for eligible unverified accounts. |
| `POST /verify-email` | `token` | Atomically consumes verification links and verifies the account. |
| `POST /forgot-password` | `email` | Generic reply; sends only for eligible verified accounts. |
| `POST /reset-password` | `token`, `password` | Atomically changes password, consumes recovery links and revokes all login sessions. |
| `POST /login` | `email`, `password` | Verified active accounts only; new cookie plus account and CSRF token. |
| `GET /session` | Cookie | Current profile and CSRF token. |
| `POST /logout` | `{}`, cookie, CSRF header | Revokes session and clears cookie. |
| `PATCH /profile` | `name`, optional `phone`, cookie, CSRF header | Updates only the signed-in customer's profile. |
| `GET /addresses` | Cookie | Lists only the signed-in customer's addresses. |
| `POST /addresses` | `line1`, `city`, `region`, `postal_code`; optional `label`, `line2`, `country` | Cookie and CSRF header required. Creates an owned address, capped at 20 per customer. Default country is US. |

For signed-in writes, send `X-CSRF-Token` from login or `/session`. The frontend
must not store the session identifier in localStorage: the host-only
`__Host-ccs_session` cookie is Secure, HttpOnly, SameSite=Lax and Path=/.
Sessions have an eight-hour absolute lifetime and thirty-minute idle timeout.
Passwords are not trimmed or silently truncated; 15–128 Unicode characters are
accepted, with a 512-byte ceiling. Scrypt uses N=131072, r=8, p=1, random salts
and constant-time comparison. One password operation per process is permitted;
overlap returns 503 with a retry header instead of queueing unbounded work.

Tokens/session identifiers are random 256-bit values stored only as SHA-256
hashes. CSRF tokens and rate-limit keys are HMAC-derived from the secret.
Verification links expire after 24 hours; recovery links after 30 minutes.
Successful replacement email delivery invalidates older links. SMTP failures
leave the account recoverable and retain a generic response; staff should monitor
the generic failure logs. These generic bodies are not a guarantee against
timing-based email/account inference; review asynchronous email delivery before
launch if stronger enumeration resistance is required.

Each authentication action permits 20 attempts per IP per 15 minutes and five
per email per 15 minutes where applicable. Outbound account email is capped at
six per email per day. Limits are atomic, database-backed and independent of the
existing public form limiter. The current Cloudflare/client-IP helper is reused;
live header sanitization and `trust proxy` behavior still need verification.

## Verification completed locally

Run `npm ci --prefix backend` (with development dependencies), then
`npm test --prefix backend`. Coverage includes real password hashing, SQL
constraints and migrations, registration/verification, secure session cookies,
CSRF, cross-customer isolation, recovery/revocation, expired links/sessions,
suspension, input limits, persisted counters and safe database/SMTP failures.
Public-site/backend regressions remain part of the same suite.

## Required before enabling public accounts

- Build and test the signup/login/verification/recovery screens and private
  customer pages. Do not put private HTML or customer files in public `site`.
- Test the native PostgreSQL driver, migrations, runtime grants, concurrent
  transactions and backup restore against the chosen staging PostgreSQL version.
  Embedded tests do not exercise TCP/TLS, real pool behavior or live contention.
- Verify the actual Cloudflare → Traefik → Express chain, HTTPS cookie behavior
  and cache bypass for account/API/private routes. Do not change proxy settings
  without the owner's approval.
- Measure hashing memory/latency and simultaneous login/recovery traffic on the
  VPS, including deployment overlap. Add compromised/common-password screening
  before public signup; review input and enumeration behavior with the UI.
- Agree on retention/deletion, first portal features and policy text. No email
  matching/import of historical customers or service requests is implemented.
- Approve live database provisioning, backups and final account activation.

No admin/technician roles, payments, appointments, service history, address
deletion or business workflow changes are implemented in this phase.
