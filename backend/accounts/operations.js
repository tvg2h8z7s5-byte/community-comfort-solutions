'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {plain,uuid,day,integer}=require('./billing');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function installOperations(router,{db,authenticated,fields,fail,operationsMail,notifications,origin}) {
 async function permitted(req,role='admin'){const {account}=await authenticated(req);if(account.role!==role)fail(403,'You do not have access to this area.');return account;}
 function page(req){return integer(Number(req.query.page||1),1,100000,'page');}
 async function equipment(c,id){const row=(await c.query(`SELECT e.*,a.name AS customer_name,a.email,a.phone,a.verified_at,d.line1,d.line2,d.city,d.region,d.postal_code FROM customer_equipment e JOIN customer_accounts a ON a.id=e.account_id JOIN customer_addresses d ON d.id=e.address_id WHERE e.id=$1`,[uuid(id)])).rows[0];if(!row)fail(404,'Equipment not found.');return row;}
 function checkRevision(row,v){if(integer(v,1,2147483647,'revision')!==row.revision)fail(409,'This record changed. Reload it before saving.');}
 const base='/admin/operations';
 router.get(base+'/overview',wrap(async(req,res)=>{
  await permitted(req);const t=(await db.query(`SELECT (SELECT count(*)::int FROM customer_equipment) AS equipment,
   (SELECT count(*)::int FROM equipment_service_history WHERE archived_at IS NULL) AS history,
   (SELECT count(*)::int FROM maintenance_plans WHERE status='active') AS plans,
   (SELECT count(*)::int FROM maintenance_plans WHERE status='active' AND (next_service_on <= (now() AT TIME ZONE 'America/New_York')::date+14 OR renew_on <= (now() AT TIME ZONE 'America/New_York')::date+14)) AS due,
   (SELECT count(*)::int FROM operations_emails WHERE state='queued') AS queued,
   (SELECT count(*)::int FROM operations_emails WHERE state='failed') AS failed`)).rows[0];res.json({ok:true,totals:t});
 }));
 router.get(base+'/equipment',wrap(async(req,res)=>{
  await permitted(req);const search=plain(req.query.search,100),p=page(req),filter="($1='' OR position(lower($1) in lower(e.name||' '||e.manufacturer||' '||e.model||' '||e.serial_number||' '||a.name||' '||coalesce(a.email,'')))>0)";
  const records=(await db.query(`SELECT e.*,a.name AS customer_name,a.email,d.line1,d.city,(SELECT max(serviced_on) FROM equipment_service_history h WHERE h.equipment_id=e.id AND h.archived_at IS NULL) AS last_service_on FROM customer_equipment e JOIN customer_accounts a ON a.id=e.account_id JOIN customer_addresses d ON d.id=e.address_id WHERE ${filter} ORDER BY e.created_at DESC,e.id LIMIT 25 OFFSET $2`,[search,(p-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM customer_equipment e JOIN customer_accounts a ON a.id=e.account_id WHERE ${filter}`,[search])).rows[0].count;res.json({ok:true,equipment:records,total,page:p});
 }));
 router.post(base+'/equipment',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['account_id','address_id','name','type','manufacturer','model','serial_number']);const b=req.body;
  if(!['Air conditioner','Furnace','Heat pump','Boiler','Other'].includes(b.type))fail(400,'Choose an equipment type.');
  const id=randomUUID();await db.transaction(async c=>{const owner=(await c.query("SELECT id FROM customer_accounts WHERE id=$1 AND role='customer' FOR UPDATE",[uuid(b.account_id)])).rows[0];if(!owner)fail(404,'Customer not found.');if(!(await c.query('SELECT id FROM customer_addresses WHERE id=$1 AND account_id=$2',[uuid(b.address_id),owner.id])).rows.length)fail(404,'Customer address not found.');if((await c.query('SELECT count(*)::int AS count FROM customer_equipment WHERE account_id=$1',[owner.id])).rows[0].count>=50)fail(400,'Equipment limit reached.');await c.query('INSERT INTO customer_equipment(id,account_id,address_id,name,type,manufacturer,model,serial_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,owner.id,b.address_id,plain(b.name,100,true),b.type,plain(b.manufacturer,100),plain(b.model,100),plain(b.serial_number,100)]);});res.status(201).json({ok:true,id});
 }));
 router.get(base+'/equipment/:id/links',wrap(async(req,res)=>{await permitted(req);const e=await equipment(db,req.params.id);const requests=(await db.query('SELECT id,service,created_at FROM service_requests WHERE account_id=$1 AND address_id=$2 ORDER BY created_at DESC LIMIT 200',[e.account_id,e.address_id])).rows;const invoices=(await db.query("SELECT id,number FROM billing_documents WHERE account_id=$1 AND kind='invoice' AND issued_at IS NOT NULL ORDER BY created_at DESC LIMIT 200",[e.account_id])).rows;res.json({ok:true,requests,invoices});}));
 router.get(base+'/equipment/:id',wrap(async(req,res)=>{await permitted(req);const e=await equipment(db,req.params.id);const history=(await db.query('SELECT h.*,d.number AS invoice_number FROM equipment_service_history h LEFT JOIN billing_documents d ON d.id=h.document_id WHERE h.equipment_id=$1 ORDER BY h.serviced_on DESC,h.created_at DESC LIMIT 200',[e.id])).rows;res.json({ok:true,equipment:e,history});}));
 async function historyData(c,b,e){
  const request_id=b.request_id?uuid(b.request_id):null,document_id=b.document_id?uuid(b.document_id):null;
  if(request_id&&!(await c.query('SELECT id FROM service_requests WHERE id=$1 AND account_id=$2 AND address_id=$3',[request_id,e.account_id,e.address_id])).rows.length)fail(400,'Choose a service request for this customer and equipment address.');
  if(document_id&&!(await c.query("SELECT id FROM billing_documents WHERE id=$1 AND account_id=$2 AND kind='invoice' AND issued_at IS NOT NULL",[document_id,e.account_id])).rows.length)fail(400,'Choose an issued invoice for this customer.');
  const serviced_on=day(b.serviced_on,true);const future=(await c.query("SELECT $1::date > (now() AT TIME ZONE 'America/New_York')::date AS future",[serviced_on])).rows[0].future;if(future)fail(400,'A completed service date cannot be in the future.');
  return {request_id,document_id,serviced_on,service:plain(b.service,150,true),findings:plain(b.findings,3000),work_performed:plain(b.work_performed,3000),recommendations:plain(b.recommendations,2000),internal_notes:plain(b.internal_notes,3000),technician:plain(b.technician,100)};
 }
 const historyFields=['request_id','document_id','serviced_on','service','findings','work_performed','recommendations','internal_notes','technician'];
 router.post(base+'/equipment/:id/history',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['id',...historyFields]);const id=uuid(req.body.id);
  await db.transaction(async c=>{const e=await equipment(c,req.params.id);await c.query('SELECT id FROM customer_equipment WHERE id=$1 FOR UPDATE',[e.id]);const v=await historyData(c,req.body,e),checksum=hash(v),existing=(await c.query('SELECT * FROM equipment_service_history WHERE id=$1',[id])).rows[0];if(existing){if(existing.equipment_id!==e.id||existing.creation_hash!==checksum||existing.created_by!==actor.id)fail(409,'This service entry was already saved with different details.');return;}
   await c.query(`INSERT INTO equipment_service_history(id,equipment_id,account_id,request_id,document_id,serviced_on,service,findings,work_performed,recommendations,internal_notes,technician,created_by,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,e.id,e.account_id,v.request_id,v.document_id,v.serviced_on,v.service,v.findings,v.work_performed,v.recommendations,v.internal_notes,v.technician,actor.id,checksum]);});res.status(201).json({ok:true,id});
 }));
 router.patch(base+'/history/:id',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,[...historyFields,'revision']);await db.transaction(async c=>{const old=(await c.query('SELECT * FROM equipment_service_history WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];if(!old)fail(404,'Service entry not found.');checkRevision(old,req.body.revision);const e=await equipment(c,old.equipment_id),v=await historyData(c,req.body,e);await c.query('UPDATE equipment_service_history SET request_id=$1,document_id=$2,serviced_on=$3,service=$4,findings=$5,work_performed=$6,recommendations=$7,internal_notes=$8,technician=$9,revision=revision+1,updated_at=now() WHERE id=$10',[v.request_id,v.document_id,v.serviced_on,v.service,v.findings,v.work_performed,v.recommendations,v.internal_notes,v.technician,old.id]);});res.json({ok:true});
 }));
 router.post(base+'/history/:id/archive',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['archived','revision']);if(typeof req.body.archived!=='boolean')fail(400,'Choose archive or restore.');await db.transaction(async c=>{const old=(await c.query('SELECT * FROM equipment_service_history WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];if(!old)fail(404,'Service entry not found.');checkRevision(old,req.body.revision);await c.query('UPDATE equipment_service_history SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=$2',[req.body.archived,old.id]);});res.json({ok:true});
 }));
 const planFields=['equipment_id','name','annual_cents','status','next_service_on','renew_on','reminder_days','email_reminders','notes'];
 async function planData(c,b){const e=await equipment(c,b.equipment_id);if(!['active','paused','cancelled'].includes(b.status)||typeof b.email_reminders!=='boolean')fail(400,'Choose valid maintenance-plan settings.');return {equipment_id:e.id,account_id:e.account_id,name:plain(b.name,150,true),annual_cents:integer(b.annual_cents,0,100000000,'annual price'),status:b.status,next_service_on:day(b.next_service_on),renew_on:day(b.renew_on),reminder_days:integer(b.reminder_days,0,60,'reminder lead time'),email_reminders:b.email_reminders,notes:plain(b.notes,2000)};}
 async function availablePlan(c,v,id){await c.query('SELECT id FROM customer_equipment WHERE id=$1 FOR UPDATE',[v.equipment_id]);if(v.status==='active'&&(await c.query("SELECT id FROM maintenance_plans WHERE equipment_id=$1 AND status='active' AND id<>$2",[v.equipment_id,id])).rows.length)fail(409,'This system already has an active maintenance plan. Pause or cancel it first.');}
 const planJoins=`maintenance_plans p JOIN customer_equipment e ON e.id=p.equipment_id
  JOIN customer_accounts a ON a.id=p.account_id JOIN customer_addresses d ON d.id=e.address_id
  LEFT JOIN LATERAL (SELECT id,status,appointment_at FROM service_requests WHERE maintenance_plan_id=p.id AND status!='cancelled' AND NOT EXISTS (SELECT 1 FROM equipment_service_history h WHERE h.request_id=service_requests.id AND h.equipment_id=p.equipment_id) ORDER BY CASE WHEN status='completed' THEN 1 ELSE 0 END,created_at DESC LIMIT 1) v ON true`;
 const planSelect=`p.*,e.name AS equipment_name,e.type,e.address_id,a.name AS customer_name,a.email,a.phone,a.verified_at,d.line1,d.city,d.region,d.postal_code,
  v.id AS visit_id,v.status AS visit_status,v.appointment_at AS visit_appointment,
  (SELECT max(serviced_on) FROM equipment_service_history h WHERE h.equipment_id=e.id AND h.archived_at IS NULL) AS last_service_on`;
 const soon="(now() AT TIME ZONE 'America/New_York')::date+14";
 router.get(base+'/plans',wrap(async(req,res)=>{
  await permitted(req);const p=page(req),search=plain(req.query.search,100),status=req.query.status??'active',due=req.query.due==='true',view=req.query.view||'all';
  if(!['','active','paused','cancelled'].includes(status)||!['all','service','scheduled','renewal','missing'].includes(view))fail(400,'Choose a plan filter.');
  const filter=`($1='' OR p.status=$1) AND ($2='' OR position(lower($2) in lower(p.name||' '||e.name||' '||a.name||' '||coalesce(a.email,'')||' '||a.phone))>0)
   AND (NOT $3 OR p.next_service_on <= ${soon} OR p.renew_on <= ${soon})
   AND ($4='all' OR ($4='service' AND p.status='active' AND p.next_service_on <= ${soon} AND coalesce(v.status,'')!='scheduled')
    OR ($4='scheduled' AND v.status='scheduled') OR ($4='renewal' AND p.status='active' AND p.renew_on <= ${soon})
    OR ($4='missing' AND p.status='active' AND (p.next_service_on IS NULL OR p.renew_on IS NULL)))`;
  const values=[status,search,due,view];
  const plans=(await db.query(`SELECT ${planSelect} FROM ${planJoins} WHERE ${filter} ORDER BY p.next_service_on NULLS LAST,p.renew_on NULLS LAST,p.id LIMIT 25 OFFSET $5`,[...values,(p-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM ${planJoins} WHERE ${filter}`,values)).rows[0].count;
  const summary=(await db.query(`SELECT count(*) FILTER(WHERE p.status='active')::int AS active,
   count(*) FILTER(WHERE p.status='active' AND p.next_service_on <= ${soon} AND coalesce(v.status,'')!='scheduled')::int AS service,
   count(*) FILTER(WHERE p.status='active' AND v.status='scheduled')::int AS scheduled,
   count(*) FILTER(WHERE p.status='active' AND p.renew_on <= ${soon})::int AS renewal,
   count(*) FILTER(WHERE p.status='active' AND (p.next_service_on IS NULL OR p.renew_on IS NULL))::int AS missing FROM ${planJoins}`)).rows[0];
  res.json({ok:true,plans,total,page:p,summary});
 }));
 router.get(base+'/plans/:id',wrap(async(req,res)=>{
  await permitted(req);const plan=(await db.query(`SELECT ${planSelect} FROM ${planJoins} WHERE p.id=$1`,[uuid(req.params.id)])).rows[0];
  if(!plan)fail(404,'Plan not found.');res.json({ok:true,plan});
 }));
 router.post(base+'/plans/:id/visit',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,[]);
  const result=await db.transaction(async c=>{
   const plan=(await c.query('SELECT * FROM maintenance_plans WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];
   if(!plan)fail(404,'Plan not found.');if(plan.status!=='active')fail(400,'Activate this plan before creating a visit.');
   const existing=(await c.query("SELECT r.id FROM service_requests r WHERE maintenance_plan_id=$1 AND status!='cancelled' AND NOT EXISTS (SELECT 1 FROM equipment_service_history h WHERE h.request_id=r.id AND h.equipment_id=$2) ORDER BY CASE WHEN r.status='completed' THEN 1 ELSE 0 END,r.created_at DESC LIMIT 1",[plan.id,plan.equipment_id])).rows[0];
   if(existing)return {id:existing.id,existing:true};
   const e=await equipment(c,plan.equipment_id);const id=randomUUID();
   await c.query(`INSERT INTO service_requests(id,account_id,address_id,service,description,preferred_day,maintenance_plan_id)
    VALUES($1,$2,$3,'Seasonal tune-up',$4,$5,$6)`,[id,plan.account_id,e.address_id,('Maintenance visit: '+plan.name+' — '+e.name+'\n'+plan.notes).slice(0,3000),plan.next_service_on,plan.id]);
   return {id,existing:false};
  });res.json({ok:true,...result});
 }));
 router.post(base+'/plans/:id/complete-visit',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['revision','request_id','serviced_on','next_service_on','technician','findings','work_performed','recommendations','internal_notes','document_id']);
  const result=await db.transaction(async c=>{
   const plan=(await c.query('SELECT * FROM maintenance_plans WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];if(!plan)fail(404,'Plan not found.');
   checkRevision(plan,req.body.revision);if(plan.status!=='active')fail(400,'Activate this plan before recording a visit.');
   const request=(await c.query('SELECT * FROM service_requests WHERE id=$1 AND maintenance_plan_id=$2 FOR UPDATE',[uuid(req.body.request_id),plan.id])).rows[0];
   if(!request||request.status==='cancelled'||(await c.query('SELECT id FROM equipment_service_history WHERE request_id=$1 AND equipment_id=$2',[request.id,plan.equipment_id])).rows.length)fail(409,'This visit is no longer open. Refresh the plan.');
   const e=await equipment(c,plan.equipment_id),v=await historyData(c,{...req.body,request_id:request.id,service:('Maintenance: '+plan.name).slice(0,150)},e),next=day(req.body.next_service_on,true);
   if(next<=v.serviced_on)fail(400,'The next service date must follow the completed visit.');
   if(!v.work_performed)fail(400,'Record the work performed before completing this visit.');
   const historyId=randomUUID();
   await c.query(`INSERT INTO equipment_service_history(id,equipment_id,account_id,request_id,document_id,serviced_on,service,findings,work_performed,recommendations,internal_notes,technician,created_by,creation_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[historyId,e.id,e.account_id,request.id,v.document_id,v.serviced_on,v.service,v.findings,v.work_performed,v.recommendations,v.internal_notes,v.technician,actor.id,hash(v)]);
   await c.query("UPDATE service_requests SET status='completed',updated_at=now() WHERE id=$1",[request.id]);
   await c.query('UPDATE maintenance_plans SET next_service_on=$1,revision=revision+1,updated_at=now() WHERE id=$2',[next,plan.id]);
   let emailId=null;
   if(e.email&&request.status!=='completed'){emailId=randomUUID();const payload=require('../emails').serviceUpdateEmail({...request,status:'completed',name:e.customer_name,portalUrl:e.verified_at?origin+'/account/dashboard#requests':null});
    await c.query('INSERT INTO service_request_emails(id,request_id,recipient,payload) VALUES($1,$2,$3,$4)',[emailId,request.id,e.email,JSON.stringify(payload)]);}
   return {history_id:historyId,emailId,no_email:!e.email};
  });let email=result.no_email?'unavailable':'not_needed';if(result.emailId){email='queued';try{email=await notifications.deliver(result.emailId);}catch(_){}}
  res.json({ok:true,history_id:result.history_id,email});
 }));
 router.post(base+'/plans',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['id',...planFields]);const id=uuid(req.body.id);
  await db.transaction(async c=>{const v=await planData(c,req.body);await c.query('SELECT id FROM customer_equipment WHERE id=$1 FOR UPDATE',[v.equipment_id]);const checksum=hash(v),old=(await c.query('SELECT * FROM maintenance_plans WHERE id=$1',[id])).rows[0];if(old){if(old.creation_hash!==checksum||old.created_by!==actor.id)fail(409,'This plan was already saved with different details.');return;}await availablePlan(c,v,id);await c.query('INSERT INTO maintenance_plans(id,account_id,equipment_id,name,annual_cents,status,next_service_on,renew_on,reminder_days,email_reminders,notes,created_by,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,v.account_id,v.equipment_id,v.name,v.annual_cents,v.status,v.next_service_on,v.renew_on,v.reminder_days,v.email_reminders,v.notes,actor.id,checksum]);});res.status(201).json({ok:true,id});
 }));
 router.patch(base+'/plans/:id',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,[...planFields,'revision']);await db.transaction(async c=>{const old=(await c.query('SELECT * FROM maintenance_plans WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];if(!old)fail(404,'Plan not found.');checkRevision(old,req.body.revision);const v=await planData(c,req.body);if(v.equipment_id!==old.equipment_id)fail(400,'A plan stays attached to its original system. Create a new plan to change equipment.');await availablePlan(c,v,old.id);await c.query('UPDATE maintenance_plans SET name=$1,annual_cents=$2,status=$3,next_service_on=$4,renew_on=$5,reminder_days=$6,email_reminders=$7,notes=$8,revision=revision+1,updated_at=now() WHERE id=$9',[v.name,v.annual_cents,v.status,v.next_service_on,v.renew_on,v.reminder_days,v.email_reminders,v.notes,old.id]);});res.json({ok:true});
 }));
 router.get(base+'/emails',wrap(async(req,res)=>{await permitted(req);const p=page(req),state=req.query.state||'';if(!['','queued','sent','failed','cancelled'].includes(state))fail(400,'Invalid delivery filter.');const emails=(await db.query("SELECT m.id,m.recipient,m.category,m.state,m.attempts,m.sent_at,m.created_at,m.document_id,m.plan_id,d.number,p.name AS plan_name FROM operations_emails m LEFT JOIN billing_documents d ON d.id=m.document_id LEFT JOIN maintenance_plans p ON p.id=m.plan_id WHERE ($1='' OR m.state=$1) ORDER BY m.created_at DESC,m.id LIMIT 25 OFFSET $2",[state,(p-1)*25])).rows;const total=(await db.query("SELECT count(*)::int AS count FROM operations_emails WHERE ($1='' OR state=$1)",[state])).rows[0].count;res.json({ok:true,emails,total,page:p});}));
 router.post(base+'/emails/:id/retry',wrap(async(req,res)=>{await permitted(req);fields(req.body,[]);const r=await db.query("UPDATE operations_emails SET state='queued',attempts=0,next_attempt_at=now() WHERE id=$1 AND state IN ('failed','cancelled') RETURNING id",[uuid(req.params.id)]);if(!r.rows.length)fail(409,'Only failed or cancelled deliveries can be retried.');let email='queued';try{email=await operationsMail.deliver(r.rows[0].id);}catch(_){}res.json({ok:true,email});}));
 router.get('/service-history',wrap(async(req,res)=>{const a=await permitted(req,'customer');res.json({ok:true,history:(await db.query(`SELECT h.id,h.equipment_id,h.serviced_on,h.service,h.findings,h.work_performed,h.recommendations,h.technician,h.updated_at,e.name AS equipment_name,d.number AS invoice_number,CASE WHEN d.issued_at IS NOT NULL THEN d.id END AS document_id FROM equipment_service_history h JOIN customer_equipment e ON e.id=h.equipment_id LEFT JOIN billing_documents d ON d.id=h.document_id WHERE h.account_id=$1 AND h.archived_at IS NULL ORDER BY h.serviced_on DESC,h.created_at DESC LIMIT 200`,[a.id])).rows});}));
 router.get('/maintenance',wrap(async(req,res)=>{const a=await permitted(req,'customer');res.json({ok:true,plans:(await db.query('SELECT p.id,p.name,p.annual_cents,p.status,p.next_service_on,p.renew_on,p.email_reminders,p.notes,e.name AS equipment_name FROM maintenance_plans p JOIN customer_equipment e ON e.id=p.equipment_id WHERE p.account_id=$1 ORDER BY p.created_at DESC LIMIT 100',[a.id])).rows});}));
 router.patch('/maintenance/:id/reminders',wrap(async(req,res)=>{const a=await permitted(req,'customer');fields(req.body,['enabled']);if(typeof req.body.enabled!=='boolean')fail(400,'Choose your reminder preference.');const r=await db.query('UPDATE maintenance_plans SET email_reminders=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND account_id=$3 RETURNING id',[req.body.enabled,uuid(req.params.id),a.id]);if(!r.rows.length)fail(404,'Plan not found.');res.json({ok:true});}));
}
module.exports={installOperations};
