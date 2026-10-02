# Dashboard and service workflow update

This is a targeted source update for the existing Community Comfort Solutions website, based on the supplied September 30 source archive. It has not been deployed to the live server.

## Included

- Customer and admin summary cards navigate to their corresponding pages and filters.
- Active requests are the default queue. Resolved contains completed and cancelled requests. “Mark completed and move to Resolved” retains the request history. Reopening is possible by changing status. Permanent deletion is not included.
- Admins can set normal/urgent priority, a confirmed appointment, and a private follow-up date. Urgent active requests sort first, then oldest requests. Follow-ups due use the Eastern calendar date.
- Customer replies, status changes, and appointment changes create a customer email in the same database transaction as the saved request. Unchanged public content and changes to internal notes, priority, and follow-up dates do not email the customer.
- Successful SMTP handoff is shown as sent. Failure is shown as queued; the running backend checks pending mail every minute and failed attempts become eligible again after five minutes. Pending emails survive backend restarts. The admin overview displays their count.
- Customers see confirmed appointments in their portal and emails in Eastern time. Admin appointment entry uses the device time zone shown by the form. Internal notes, priority, and follow-up dates are never included in customer responses or email.
- Portal CSS/JS URLs have a version suffix to refresh cached dashboard assets.

## Apply to your existing repository and server

1. Copy the contents of `files/` over the existing repository root, retaining paths. This ZIP contains changed/new files only. Do not replace the whole repository with it. It contains no public home/services pages or photos.
2. Before redeploying, run `SERVICE_WORKFLOW_DATABASE.sql` against **ccs_business** using the database administrator or migration role. It applies migration 003, records the exact checksum for the existing migration runner, and grants the existing `ccs_app` runtime role access to the mail outbox. It runs in a transaction and is safe to repeat. If you normally use the Node migration runner, run it instead from the updated source with migration credentials and then run the GRANT shown in this SQL file. Do not run both simultaneously.
3. Redeploy the updated repository through Coolify, retaining the current PG, SMTP, AUTH_PUBLIC_URL, and AUTH_SECRET settings. Use the restricted runtime database role as before. The new backend deliberately checks that the new schema is present at startup.
4. Run `node /app/backend/accounts/check.js` in the website container and verify the site starts.
5. With a test customer request, send an admin reply, check the customer inbox and portal, mark the request completed, and verify it appears under Resolved. Check the appointment time matches what you agreed with the customer. A normal SMTP acceptance cannot guarantee final inbox placement; inspect spam/provider delivery logs if needed.

## Verification

- All 23 automated backend tests passed, including authorization, CSRF, private-note isolation, additive migrations, resolved/active filtering, notification deduplication, failed-mail persistence, retry, and invalid input.
- DOM interaction checks passed for customer/admin card navigation, matching queue filters, workflow fields, the Resolve action, and email feedback.
- A full browser visual check could not run because the Chromium download was unavailable. Mobile CSS retains the existing layout and stacks summary cards on narrow screens; verify the deployed dashboard on your phone.
- Live server database permissions, SMTP inbox delivery, and real browser layout require the deployment checks above.

## Operational notes

Email delivery is at least once: a process interruption after SMTP accepts a message but before its sent state is recorded can cause a retry. Retries retain the same Message-ID. Pending messages retain the customer-facing update as it was when saved. Resolving requests preserves customer history. No real customer records or emails were modified during local validation.
