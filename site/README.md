# Community Comfort Solutions website

Static site (`site/`) plus a small form-to-email backend (`backend/`) for your VPS.

## Deploy on your VPS (Ubuntu/Debian + nginx)

1. **Site files**: copy the contents of `site/` to `/var/www/communitycomfortsolutions.org/`.
2. **Backend**: copy `backend/` to `/opt/ccs-forms/`, then:
   ```
   cd /opt/ccs-forms
   npm install --omit=dev
   cp .env.example .env && nano .env      # fill in your SMTP details
   chmod 600 .env && chown -R www-data:www-data /opt/ccs-forms
   ```
3. **Run it as a service**:
   ```
   sudo cp ccs-forms.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now ccs-forms
   ```
4. **nginx**: use `backend/nginx-site.conf` as your site config (it serves the site and proxies `/api/` to the backend), then
   `sudo nginx -t && sudo systemctl reload nginx` and `sudo certbot --nginx -d communitycomfortsolutions.org -d www.communitycomfortsolutions.org` for HTTPS.
5. **Test**: `curl https://communitycomfortsolutions.org/api/health` should return `{"ok":true}`, then submit the contact form.

Forms on `contact.html`, `schedule.html` and `do-not-share.html` post to `/api/contact`; messages are emailed to `contact@communitycomfortsolutions.org`.

## Email sending notes

Use authenticated SMTP (port 587) from a real mailbox or a transactional provider (Brevo, Resend, Mailgun, Postmark). Many VPS hosts block port 25, and sending straight from the VPS usually lands in spam unless SPF, DKIM, DMARC and reverse DNS are all set up. Make sure your domain's SPF/DKIM records include whichever provider you use.

## Content to finish

- Confirm service days and hours on `contact.html`, replace photo placeholders, and have the privacy/terms/cookie text reviewed.
- Domain is set to `https://communitycomfortsolutions.org/` in `index.html`, `sitemap.xml` and `robots.txt`.
