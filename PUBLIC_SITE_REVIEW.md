# Public website foundation review

Reviewed against repository baseline `9bb3b74`. Work is isolated on
`fix/public-site-foundation`; no push, deployment, infrastructure changes, real
email submissions, database changes, or authentication work were performed.

## Changes

- Standardized the logo, header, footer, navigation, phone, Schedule Service
  links, and mobile call bar across all 16 public pages. The supplied SVG is
  preserved. Explicit proportional dimensions fix its unbounded display;
  the existing text wordmark remains alongside it.
- Added shared source partials and a small Node synchronization script. Committed
  HTML stays static and requires no runtime framework or JavaScript to render
  its header/footer. Current-page links receive `aria-current`.
- Converted local links/assets to root-relative paths, including the 404 page,
  so nested missing URLs can render the correct navigation and assets.
- Fixed intermediate-width header crowding, narrow-screen field/grid sizing,
  long contact links, and mobile safe-area spacing. Added skip links, focus
  styling, Escape-to-close behavior and reduced-motion support.
- Added form length limits, a request timeout, safe DOM construction for the
  email fallback, useful validation/rate-limit errors and reliable submit-button
  recovery. Preserved `/api/contact`, all three forms, SMTP delivery, honeypot,
  subject conventions and the six-per-15-minute rate limit.
- Added canonical URLs and Open Graph text metadata, completed missing meta
  descriptions, standardized favicon references, and added business identity
  and logo references to the existing HVACBusiness JSON-LD. The sitemap and
  robots.txt were already consistent and were retained. The 404 is noindex.
- Return the branded page with HTTP 404 for unknown public paths; unknown API
  paths receive JSON 404 responses.
- Added security headers/CSP to static and API responses; retained existing
  inline cookie/GPC behavior using script hashes. Added multipart field limits,
  strict field type/length checks, bounded JSON/urlencoded input, parameter
  limits, SMTP timeouts, safe reply-to construction and generic parser/SMTP
  errors. SMTP diagnostics are no longer returned to visitors or logged.
- Prevented local environment files from Git/Docker inclusion and committed a
  dependency lockfile; Docker now installs deterministically using `npm ci`.
- Added regression checks and documentation for maintenance and release.

## Files changed

- All 16 `site/*.html` files; `site/styles.css`; `site/script.js`.
- `partials/header.html`, `partials/footer.html`, `partials/call-bar.html`;
  `scripts/sync-layout.js`.
- `backend/server.js`, `backend/package.json`, `backend/package-lock.json`;
  `Dockerfile`, `.gitignore`, `.dockerignore`.
- `tests/check-public-site.py`, `tests/public-backend.test.js`,
  `tests/browser-smoke.js`; `README.md`; `PUBLIC_SITE_REVIEW.md`.

## Verification

- Shared layout synchronization and all internal file/anchor links pass.
- All 16 pages have titles/descriptions; canonical/Open Graph URLs, sitemap
  coverage, robots sitemap reference and JSON-LD parsing pass.
- Six backend regression groups pass: static/API headers and 404s, form email
  behavior and hostile input, three request encodings and parser limits, safe
  SMTP failure responses, rate limiting, and authenticated delivery through a
  local SMTP test server using the actual upgraded Nodemailer transport.
- Browser checks pass on all 16 pages at 320, 375, 768, 1024, 1280 and 1440 px:
  loaded logo and no document horizontal overflow. Additional checks cover menu
  interaction, all three forms, delivery-error fallback, cookie preferences,
  CSP console errors and nested 404 assets. Desktop home and mobile contact
  screenshots were visually inspected.
- Browser/backend checks used local listeners and mock SMTP. Live email
  deliverability, Cloudflare-injected scripts, Docker image build, actual proxy
  IP behavior and production configuration remain unverified.
- After the approved upgrade to Nodemailer 10.0.12, `npm audit --omit=dev`
  reports zero known vulnerabilities. This is an advisory scan, not a guarantee
  that the application has no security flaws. The package minimum Node version
  is now 20; the existing Dockerfile already uses Node 22.

## Decisions and remaining findings

1. **Nodemailer upgrade completed locally:** the user approved updating the
   existing mail software. Nodemailer is pinned to 10.0.12 and its lockfile is
   updated. Local SMTP authentication/message-delivery and browser form checks
   pass. No SMTP provider, account or deployment settings were changed. Real
   staging SMTP verification remains a release check. Release notes:
   https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md .
2. **Proxy trust:** existing `trust proxy = 1` is preserved. Confirm the actual
   Cloudflare → Coolify → Express forwarding chain and header sanitization
   before changing it. Incorrect settings can either group visitors under a
   proxy IP or allow forged client IPs. Express documentation:
   https://expressjs.com/en/guide/behind-proxies/ . The in-memory limiter is
   process-local and resets on restart; it is not a future login abuse defense.
3. **Hours and policies:** contact/scheduling pages and existing structured data
   say seven days, 7 AM–1 PM. These are preserved for your confirmation, as are
   prices, phone, email, service claims, security/privacy/legal text and business
   policies. Policy pages already request review; review them before accounts
   collect or retain more personal data.
4. **Social previews:** text metadata is present. No `og:image` is invented.
   Supply/approve a suitable raster social image separately; the current SVG
   embeds raster artwork and is retained as provided.
5. **Production release:** approve deployment separately. Stage the Docker
   image, check allowed origins/SMTP configuration without sharing secret
   values, submit one real contact and appointment request, and confirm HTTPS,
   headers, nested 404s and per-visitor rate limiting through the real proxy.
   Verify any Cloudflare features that inject scripts against the new CSP.
   Keep a rollback image/commit. Do not merge into auto-deployed main as a test.

## Before database/authentication work

- Verify staging SMTP delivery and proxy behavior first.
- Agree on customer data fields, retention/deletion, role permissions, account
  recovery and email verification, and the boundary between public requests
  and authenticated application routes.
- Choose the database and session approach with explicit approval. Plan
  migrations, backups and restore checks in staging before production records.
- Design server-enforced authorization, secure cookies, CSRF protection and
  account-specific abuse limits; public form Origin checks are not sufficient
  authentication infrastructure.
- Consider a non-root container and appropriate health/readiness checks after
  reviewing deployment expectations. No container user, firewall, DNS, email,
  proxy, SSH or hosting configuration was changed in this work.

The current public forms remain email requests requiring confirmation; they do
not reserve calendar appointments or persist customer records.

## Live verification and Cloudflare follow-up

On September 29, 2026, after the owner deployed the initial changes, both public
forms returned success and the owner confirmed both test emails arrived. Docker
output subsequently showed the website and `coolify-proxy` running, with the
proxy healthy; the Coolify UI's Exited badge did not match that output. The
displayed duplicate-router log predated the deployment and was not evidence of
a continuing conflict. The browser-based administrative terminal had a separate
WebSocket failure; no changes were made to repair it.

The live response contains Cloudflare headers. Read-only checks did not find
explicit forwarded-header/proxy-protocol settings in container command flags,
selected environment variables, or YAML/TOML under the standard proxy directory.
Those checks do not prove that every possible configuration source was examined
or that live requests were previously grouped incorrectly.

A follow-up backend-only patch prepares Cloudflare-aware rate-limit keys without
changing the proxy, hosting settings, SMTP, form contract or rate threshold.
It checks Cloudflare address ranges, requires a private immediate peer before
considering Traefik's upstream result, validates and normalizes visitor IPs,
and conservatively falls back when those checks fail. It retains `trust proxy=1`.
The design assumes Traefik's normal sanitization and the operator-controlled
private Docker network shown in the deployment. Cloudflare Workers, header
transforms, additional proxies and direct application exposure need separate
review if present.

All 12 local backend tests pass, including synthetic visitors sharing an edge,
the same visitor moving between edges, invalid or spoofed Cloudflare headers,
IPv4/IPv6 normalization, and SMTP compatibility. The patch has not been uploaded
or deployed by the assistant. Its live visitor-key selection remains unverified;
successful form delivery alone does not prove which limiter key was selected.

Follow-up files: `backend/server.js`, `backend/package.json`,
`backend/client-ip.js`, `backend/cloudflare-networks.json`,
`tests/public-backend.test.js`, `tests/client-ip.test.js`, `README.md`, and this
review. The Cloudflare networks are from https://www.cloudflare.com/ips-v4/ and
https://www.cloudflare.com/ips-v6/ . Header behavior is documented at
https://developers.cloudflare.com/fundamentals/reference/http-headers/ .
