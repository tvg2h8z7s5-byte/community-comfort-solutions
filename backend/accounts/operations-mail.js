'use strict';
const {randomUUID}=require('node:crypto');
const {invoicePDF}=require('./billing-pdf');
const date=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
function createOperationsMail({db,mailTransport,from,origin}) {
 async function schedule(){
  // One reminder per plan/date/type. Scheduling locks each plan against updates.
  return db.transaction(async c=>{
   const plans=(await c.query(`SELECT p.*,a.name AS customer_name,a.email,e.name AS equipment_name FROM maintenance_plans p JOIN customer_accounts a ON a.id=p.account_id JOIN customer_equipment e ON e.id=p.equipment_id
    WHERE p.status='active' AND p.email_reminders AND a.state='active' AND a.verified_at IS NOT NULL AND
    ((p.next_service_on <= (now() AT TIME ZONE 'America/New_York')::date+p.reminder_days AND NOT EXISTS(SELECT 1 FROM operations_emails m WHERE m.dedupe_key=p.id::text||':service:'||p.next_service_on::text)) OR (p.renew_on <= (now() AT TIME ZONE 'America/New_York')::date+p.reminder_days AND NOT EXISTS(SELECT 1 FROM operations_emails m WHERE m.dedupe_key=p.id::text||':renewal:'||p.renew_on::text)))
    ORDER BY p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED`)).rows;
   for(const p of plans){for(const [category,due] of [['service',p.next_service_on],['renewal',p.renew_on]]){
    if(!due)continue;
    const eligible=(await c.query("SELECT $1::date <= (now() AT TIME ZONE 'America/New_York')::date+$2::integer AS eligible",[date(due),p.reminder_days])).rows[0].eligible;
    if(!eligible)continue;
    const payload={due_on:date(due),subject:(category==='service'?'Maintenance service reminder':'Maintenance renewal reminder')+' | Community Comfort Solutions',text:`Hello ${p.customer_name||'there'},\n\n${category==='service'?'Your next maintenance service is due':'Your maintenance plan renewal is due'} on ${date(due)}.\n\nPlan: ${p.name}\nEquipment: ${p.equipment_name}\n\nContact us at 917-608-3201 to discuss your ${category==='service'?'visit':'renewal'}. This reminder does not book a visit or charge a payment.\n\nView your plan: ${origin}/account/dashboard#maintenance\n\nCommunity Comfort Solutions`};
    await c.query('INSERT INTO operations_emails(id,plan_id,category,dedupe_key,recipient,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING',[randomUUID(),p.id,category,`${p.id}:${category}:${date(due)}`,p.email,JSON.stringify(payload)]);
   }}
  });
 }
 async function deliver(id){
  const row=await db.transaction(async c=>{
   const r=(await c.query("SELECT * FROM operations_emails WHERE id=$1 AND state='queued' AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",[id])).rows[0];if(!r)return null;
   if(r.plan_id){
    const p=(await c.query('SELECT p.*,a.email,a.state,a.verified_at FROM maintenance_plans p JOIN customer_accounts a ON a.id=p.account_id WHERE p.id=$1',[r.plan_id])).rows[0];
    const due=p&&(r.category==='service'?p.next_service_on:p.renew_on);
    if(!p||p.status!=='active'||!p.email_reminders||p.state!=='active'||!p.verified_at||!due||date(due)!==r.payload.due_on||p.email!==r.recipient){await c.query("UPDATE operations_emails SET state='cancelled' WHERE id=$1",[id]);return {cancelled:true};}
   }
   if(r.document_id){const d=(await c.query('SELECT status,issued_at FROM billing_documents WHERE id=$1',[r.document_id])).rows[0];if(!d||!d.issued_at||!['issued','accepted'].includes(d.status)){await c.query("UPDATE operations_emails SET state='cancelled' WHERE id=$1",[id]);return {cancelled:true};}}
   await c.query("UPDATE operations_emails SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",[id]);return {...r,attempts:r.attempts+1};
  });
  if(!row)return 'queued';if(row.cancelled)return 'cancelled';
  try{
   const {document,...message}=row.payload;
   if(document){const current=(await db.query("SELECT d.status,coalesce(sum(p.amount_cents) FILTER(WHERE p.voided_at IS NULL),0)::int AS paid_cents FROM billing_documents d LEFT JOIN billing_payments p ON p.document_id=d.id WHERE d.id=$1 GROUP BY d.id",[row.document_id])).rows[0];if(current){document.status=current.status;document.paid_cents=current.paid_cents;document.balance_cents=document.total_cents-current.paid_cents;}}
   delete message.due_on;
   const attachments=document?[{filename:document.number+'.pdf',content:await invoicePDF(document),contentType:'application/pdf'}]:undefined;
   const result=await mailTransport.sendMail({from,to:row.recipient,replyTo:from,messageId:`<${row.id}@communitycomfortsolutions.org>`,...message,attachments});
   if(result?.rejected?.length)throw Error('Rejected');
   await db.query("UPDATE operations_emails SET state='sent',sent_at=now() WHERE id=$1",[row.id]);return 'sent';
  }catch(_){if(row.attempts>=8)await db.query("UPDATE operations_emails SET state='failed' WHERE id=$1",[row.id]);console.error('Operations email pending retry or review.');return row.attempts>=8?'failed':'queued';}
 }
 async function drain(){await schedule();const rows=(await db.query("SELECT id FROM operations_emails WHERE state='queued' AND next_attempt_at<=now() ORDER BY created_at LIMIT 10")).rows;for(const r of rows)await deliver(r.id);}
 return {schedule,deliver,drain};
}
module.exports={createOperationsMail};
