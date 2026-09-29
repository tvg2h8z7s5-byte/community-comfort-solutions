# Community Comfort Solutions

The public website uses static HTML/CSS/JavaScript in `site/` and Express in
`backend/`. The existing Docker image serves both the website and `/api/contact`.
Forms email requests using SMTP; they do not create customer database records.

## Edit shared navigation

Edit `partials/header.html`, `partials/footer.html`, or `partials/call-bar.html`,
then run:

```sh
node scripts/sync-layout.js
node scripts/sync-layout.js --check
```

Commit both the partials and generated HTML. Pages remain ordinary static files,
with working navigation before JavaScript loads. There is no new framework or
runtime template dependency. Each page retains its own content and metadata.

## Local checks

```sh
npm ci --prefix backend
node scripts/sync-layout.js --check
python3 tests/check-public-site.py
npm test --prefix backend
npm audit --prefix backend --omit=dev
```

The optional browser check requires Playwright and its Chromium browser:

```sh
node tests/browser-smoke.js
```

It tests all pages at six widths and uses a mock mail transport. No real email
is sent by the tests. Install Playwright separately for development; it is not
a production dependency.

## Configuration and release

Keep SMTP credentials in the deployment environment. Required names are
`SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`; existing options include `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_FROM`, `CONTACT_TO`, `PORT`, and `ALLOWED_ORIGINS`.
Never commit real values. Environment values take precedence over the optional
local `backend/.env` file. Git and Docker ignore environment files.

The Dockerfile uses `npm ci` and the committed lockfile. Do not push these changes
to an auto-deploy branch or deploy until the changes have been approved. Verify
the image in a staging deployment, including one real contact and scheduling
email, then confirm public response headers and the actual client IP used by the
limiter through Cloudflare/Coolify. The local tests do not validate that network
path or the live SMTP service.

`site/README.md`, `backend/nginx-site.conf`, and `backend/ccs-forms.service` are
legacy direct nginx/systemd deployment guidance. They are retained, but are not
the documented GitHub → Coolify → Docker deployment path.

See `PUBLIC_SITE_REVIEW.md` for findings and decisions before authentication.
