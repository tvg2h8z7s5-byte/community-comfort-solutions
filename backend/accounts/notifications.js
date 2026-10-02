'use strict';
// Durable outbox: an SMTP failure never loses a saved customer update.
function createRequestNotifications({db, mailTransport, from}) {
 async function deliver(id) {
  const message = await db.transaction(async client => {
   const row = (await client.query(`SELECT * FROM service_request_emails WHERE id=$1 AND sent_at IS NULL AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED`,[id])).rows[0];
   if (!row) return null;
   await client.query(`UPDATE service_request_emails SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,[id]);
   return row;
  });
  if (!message) return 'queued';
  try {
   const result = await mailTransport.sendMail({from, to:message.recipient, replyTo:from, messageId:`<${message.id}@communitycomfortsolutions.org>`, ...message.payload});
   if (result?.rejected?.length) throw Error('Recipient rejected');
   await db.query('UPDATE service_request_emails SET sent_at=now() WHERE id=$1',[id]);
   return 'sent';
  } catch (_) {
   console.error('Service request update email pending retry.');
   return 'queued';
  }
 }
 async function drain() {
  const rows=(await db.query(`SELECT id FROM service_request_emails WHERE sent_at IS NULL AND next_attempt_at<=now() ORDER BY created_at LIMIT 10`)).rows;
  for (const row of rows) await deliver(row.id);
 }
 return {deliver, drain};
}
module.exports={createRequestNotifications};
