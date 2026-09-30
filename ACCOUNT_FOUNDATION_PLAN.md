# Customer account foundation — proposal for review

## Confirmed scope

The owner approved moving beyond the public website foundation and selected
public customer signup with email verification. The existing public website,
contact/scheduling email delivery and SMTP provider stay in place.

Current VPS snapshot: 2 CPU cores, approximately 2 GB RAM with 1.1 GiB available,
2 GB swap (297 MiB used), and 29 GB disk available. This supports starting a
small portal, subject to measured database and login load. It is not a benchmark
or a guarantee of 100 simultaneous users.

## Approved database direction

Recommend one separate PostgreSQL business database on the existing VPS, with
a small connection pool. Use it for customer records, persistent sessions and
account abuse counters, avoiding another Redis service initially. Do not reuse
Coolify's own PostgreSQL or Redis containers. Do not publish a database port to
the Internet. Version, resource settings, backup destination and deployment
configuration must be reviewed before creating the live service.

The owner approved PostgreSQL on September 29, 2026 (America/New_York).
A local account backend and disposable test database are now implemented; see
`backend/accounts/README.md`. No production database has been created, no live
settings have changed, and accounts remain disabled by default. Account UI and
portal pages are still pending.

## Proposed initial data structure

| Record | Purpose and constraints |
| --- | --- |
| Customer account | Random ID, unique normalized email, password hash, verification timestamp, account state, created/updated timestamps. Public signup can only create a customer; it cannot select privileged roles. |
| Customer profile | Name and optional phone are stored on the account row initially. Ask for these when completing the profile rather than collecting addresses at signup. |
| Service address | Random ID, owning customer, address fields and timestamps. Every read/write must enforce ownership on the server. |
| Account token | Owner, purpose (verification or recovery), token hash, expiry and consumed timestamp. Store only hashes, use random single-use tokens, and consume them atomically. |
| Login session | Hashed random session identifier, owner, creation/expiry and revocation state. Invalidate sessions on password recovery and account suspension. |
| Abuse counter | Purpose, keyed account/IP identifier, window and count. Shared database counters survive app restarts; updates must be atomic, with bounded retention. |

Service requests and their status workflow are a proposed portal feature, not
yet an approved business workflow. Existing public form emails will not
automatically become customer records, and matching email addresses will not
automatically attach historical requests to new accounts.

## Account behavior to implement after database approval

1. Register with email and password; send verification using existing SMTP.
   Unverified accounts cannot access customer data. Registration/recovery replies
   should avoid revealing whether an account exists.
2. Use a supported password hashing implementation with current OWASP settings.
   Measure CPU/memory cost on this VPS and bound concurrent hashing operations;
   do not reduce hashing strength merely to accommodate an abusive traffic burst.
3. Verify and recover through expiring single-use links. Build links from a
   configured, validated public URL rather than incoming Host headers. Token
   pages must avoid third-party assets and referrer leakage. Do not log secrets,
   passwords, tokens, database connection strings or form bodies.
4. Issue host-only Secure/HttpOnly/SameSite cookies, rotate sessions on login,
   enforce idle/absolute expiry, support logout, and add CSRF protection for
   state-changing cookie-authenticated requests.
5. Enforce customer ownership on every private route. Serve private pages through
   authenticated routes, outside the publicly served `site` directory. Add
   `Cache-Control: private, no-store`; verify Cloudflare does not cache customer
   responses. Do not rely on hidden buttons or client-side checks for permissions.
6. Add explicit account/body field limits, account/IP rate limits and bounded
   verification/recovery email delivery. A temporary SMTP failure must leave a
   recoverable unverified account rather than falsely reporting delivery.

## Implementation and release sequence

1. Approve the separate PostgreSQL approach. Develop schema/migrations and account
   services against a disposable local/test database with fake customer data.
2. Keep account functionality disabled by default until configuration is valid.
   Mount account routes before existing catch-all handlers without changing the
   public form contract. Do not run schema migrations automatically at web startup.
3. Test duplicate signup races, verification/recovery expiry and reuse, session
   revocation, CSRF, brute-force controls, email failure, and cross-customer access
   including guessed record IDs. Re-run the existing public website/backend tests.
4. Agree on the first portal features, data retention/deletion and relevant policy
   updates with the owner. Privileged/admin/technician roles remain outside this
   first customer registration phase.
5. Approve live database provisioning and backup storage separately. Verify a
   backup restore, proxy header sanitization, HTTPS cookies, cache behavior, and
   resource usage during login and deployment before enabling public accounts.

## Sources

- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
- OWASP password storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP recovery: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- OWASP session management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP authorization: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
