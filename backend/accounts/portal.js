'use strict';
const { randomUUID } = require('node:crypto');
const {serviceUpdateEmail}=require('../emails');
function installPortal(router, { db, authenticated, fields, text, fail, count, notifyRequest, origin, notifications }) {
 const uuid = value => { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '')) fail(400,'Invalid record.'); return value; };
 const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
 async function permitted(req,role) { const {account}=await authenticated(req); if(account.role!==role) fail(403,'You do not have access to this area.'); return account; }
 function multiline(value,max) { if(value===undefined)return ''; if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(400,'Invalid text.'); return value.trim(); }
 const equipmentFields = ['address_id','name','type','manufacturer','model','serial_number'];
 const types = ['Air conditioner','Furnace','Heat pump','Boiler','Other'];
 const services = ['Heating repair','Cooling repair','Diagnosis','Seasonal tune-up'];
 const statuses = ['requested','reviewing','scheduled','completed','cancelled'];
 async function ownedAddress(id,owner) { const result=await db.query('SELECT id FROM customer_addresses WHERE id=$1 AND account_id=$2',[uuid(id),owner]); if(!result.rows.length) fail(404,'Address not found.'); return id; }
 router.get('/equipment',wrap(async(req,res)=>{
  const a=await permitted(req,'customer');
  res.json({ok:true,equipment:(await db.query('SELECT id,address_id,name,type,manufacturer,model,serial_number FROM customer_equipment WHERE account_id=$1 ORDER BY created_at DESC,id',[a.id])).rows});
 }));
 router.post('/equipment',wrap(async(req,res)=>{
  const a=await permitted(req,'customer'); fields(req.body,equipmentFields);
  if(!types.includes(req.body.type)) fail(400,'Select an equipment type.');
  await ownedAddress(req.body.address_id,a.id);
  const values=[randomUUID(),a.id,req.body.address_id,text(req.body.name,100,true),req.body.type,text(req.body.manufacturer,100),text(req.body.model,100),text(req.body.serial_number,100)];
  const result=await db.transaction(async c=>{
   await c.query('SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE',[a.id]);
   if((await c.query('SELECT count(*)::int AS count FROM customer_equipment WHERE account_id=$1',[a.id])).rows[0].count>=50) fail(400,'Equipment limit reached.');
   return c.query('INSERT INTO customer_equipment(id,account_id,address_id,name,type,manufacturer,model,serial_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[...values]);
  });
  res.status(201).json({ok:true,id:result.rows[0].id});
 }));
 router.get('/requests',wrap(async(req,res)=>{
  const a=await permitted(req,'customer');
  res.json({ok:true,requests:(await db.query(`SELECT r.id,r.address_id,r.service,r.description,r.preferred_day,r.status,r.customer_update,r.appointment_at,r.created_at,r.updated_at,a.line1,a.city
   FROM service_requests r JOIN customer_addresses a ON a.id=r.address_id WHERE r.account_id=$1 ORDER BY r.created_at DESC,r.id LIMIT 200`,[a.id])).rows});
 }));
 router.post('/requests',wrap(async(req,res)=>{
  const a=await permitted(req,'customer'); fields(req.body,['address_id','service','description','preferred_day']);
  if(!services.includes(req.body.service)) fail(400,'Select a service.');
  await count('service-request',a.id,10,86400);
  await ownedAddress(req.body.address_id,a.id);
  const day=text(req.body.preferred_day,10);
  if(day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day || day < new Date().toISOString().slice(0,10))) fail(400,'Choose a valid future date.');
  const result=await db.query(`INSERT INTO service_requests(id,account_id,address_id,service,description,preferred_day) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[randomUUID(),a.id,req.body.address_id,req.body.service,text(multiline(req.body.description,3000).replace(/\r?\n/g,' '),3000,true),day||null]);
  await notifyRequest(a, {id: result.rows[0].id, service: req.body.service, preferred_day: day, description: req.body.description.trim()});
  res.status(201).json({ok:true,id:result.rows[0].id});
 }));
 router.get('/admin/accounts',wrap(async(req,res)=>{
  await permitted(req,'admin');
  const search=text(req.query.search,100), role=text(req.query.role,20);
  if(role && !['customer','contractor'].includes(role)) fail(400,'Invalid role filter.');
  const page=Number(req.query.page||1); if(!Number.isInteger(page)||page<1||page>100000) fail(400,'Invalid page.');
  const filter=`role IN ('customer','contractor') AND ($1='' OR position(lower($1) in lower(email||' '||name||' '||phone))>0) AND ($2='' OR role=$2)`;
  const result=await db.query(`SELECT id,email,name,phone,role,state,verified_at,created_at FROM customer_accounts WHERE ${filter} ORDER BY created_at DESC,id LIMIT 25 OFFSET $3`,[search,role,(page-1)*25]);
  const total=(await db.query(`SELECT count(*)::int AS count FROM customer_accounts WHERE ${filter}`,[search,role])).rows[0].count;
  res.json({ok:true,accounts:result.rows,total,page});
 }));
 router.get('/admin/accounts/:id',wrap(async(req,res)=>{
  await permitted(req,'admin'); const id=uuid(req.params.id);
  const account=(await db.query("SELECT id,email,name,phone,role,state,verified_at,created_at FROM customer_accounts WHERE id=$1 AND role IN ('customer','contractor')",[id])).rows[0];
  if(!account) fail(404,'Account not found.');
  const addresses=(await db.query('SELECT id,label,line1,line2,city,region,postal_code,country FROM customer_addresses WHERE account_id=$1 ORDER BY created_at,id',[id])).rows;
  const equipment=(await db.query('SELECT id,address_id,name,type,manufacturer,model,serial_number FROM customer_equipment WHERE account_id=$1 ORDER BY created_at,id',[id])).rows;
  const requests=(await db.query('SELECT id,service,description,preferred_day,status,customer_update,internal_notes,created_at FROM service_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 200',[id])).rows;
  res.json({ok:true,account,addresses,equipment,requests});
 }));
 router.get('/admin/overview',wrap(async(req,res)=>{
  await permitted(req,'admin');
  const totals=(await db.query(`SELECT count(*) FILTER(WHERE role='customer')::int AS customers,count(*) FILTER(WHERE role='contractor')::int AS contractors,count(*) FILTER(WHERE verified_at IS NULL AND role!='admin')::int AS unverified FROM customer_accounts`)).rows[0];
  const queue=(await db.query(`SELECT count(*) FILTER(WHERE status='requested')::int AS requested,count(*) FILTER(WHERE status='scheduled')::int AS scheduled,count(*) FILTER(WHERE status IN ('completed','cancelled'))::int AS resolved,count(*) FILTER(WHERE status NOT IN ('completed','cancelled') AND follow_up_on <= (now() AT TIME ZONE 'America/New_York')::date)::int AS followups FROM service_requests`)).rows[0];
  const pending=(await db.query('SELECT count(*)::int AS count FROM service_request_emails WHERE sent_at IS NULL')).rows[0].count;
  res.json({ok:true,totals:{...totals,...queue,pending}});
 }));
 router.post('/admin/requests',wrap(async(req,res)=>{
  await permitted(req,'admin');fields(req.body,['account_id','address_id','service','description']);
  const owner=uuid(req.body.account_id);const account=(await db.query("SELECT id,name,email FROM customer_accounts WHERE id=$1 AND role='customer'",[owner])).rows[0];
  if(!account)fail(404,'Customer not found.');
  await ownedAddress(req.body.address_id,owner);
  if(!services.includes(req.body.service))fail(400,'Select a service.');
  const description=text(multiline(req.body.description,3000).replace(/\r?\n/g,' '),3000,true),id=randomUUID();
  await db.query('INSERT INTO service_requests(id,account_id,address_id,service,description) VALUES($1,$2,$3,$4,$5)',[id,owner,req.body.address_id,req.body.service,description]);
  res.status(201).json({ok:true,id});
 }));
 router.get('/admin/schedule',wrap(async(req,res)=>{
  await permitted(req,'admin');
  const start=text(req.query.start,10),end=text(req.query.end,10),page=Number(req.query.page||1);
  for(const day of [start,end])if(day && (!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day))fail(400,'Choose valid schedule dates.');
  if(start && end && start>end)fail(400,'The end date must follow the start date.');
  if(!Number.isInteger(page)||page<1||page>100000)fail(400,'Invalid page.');
  const filter="r.status='scheduled' AND r.appointment_at IS NOT NULL AND ($1::date IS NULL OR (r.appointment_at AT TIME ZONE 'America/New_York')::date >= $1::date) AND ($2::date IS NULL OR (r.appointment_at AT TIME ZONE 'America/New_York')::date <= $2::date)";
  const requests=(await db.query(`SELECT r.*,a.name,a.email,a.phone,d.line1,d.line2,d.city,d.region,d.postal_code FROM service_requests r JOIN customer_accounts a ON a.id=r.account_id JOIN customer_addresses d ON d.id=r.address_id WHERE ${filter} ORDER BY r.appointment_at,r.id LIMIT 25 OFFSET $3`,[start||null,end||null,(page-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM service_requests r WHERE ${filter}`,[start||null,end||null])).rows[0].count;
  const summary=(await db.query(`SELECT count(*) FILTER(WHERE status='scheduled' AND appointment_at IS NOT NULL AND (appointment_at AT TIME ZONE 'America/New_York')::date=(now() AT TIME ZONE 'America/New_York')::date)::int AS today,count(*) FILTER(WHERE status='scheduled' AND appointment_at<now())::int AS overdue,count(*) FILTER(WHERE status IN ('requested','reviewing') OR (status='scheduled' AND appointment_at IS NULL))::int AS needs_booking FROM service_requests`)).rows[0];
  res.json({ok:true,requests,total,page,summary});
 }));
 router.get('/admin/requests',wrap(async(req,res)=>{
  await permitted(req,'admin'); const status=text(req.query.status,20);
  if(status && ![...statuses,'active','resolved','followup','needs-booking'].includes(status)) fail(400,'Invalid status.');
  const page=Number(req.query.page||1); if(!Number.isInteger(page)||page<1||page>100000) fail(400,'Invalid page.');
  const filter="($1='' OR r.status=$1 OR ($1='needs-booking' AND (r.status IN ('requested','reviewing') OR (r.status='scheduled' AND r.appointment_at IS NULL))) OR ($1='active' AND r.status NOT IN ('completed','cancelled')) OR ($1='resolved' AND r.status IN ('completed','cancelled')) OR ($1='followup' AND r.status NOT IN ('completed','cancelled') AND r.follow_up_on <= (now() AT TIME ZONE 'America/New_York')::date))";
  const requests=(await db.query(`SELECT r.*,a.name,a.email,a.phone,d.line1,d.city FROM service_requests r JOIN customer_accounts a ON a.id=r.account_id JOIN customer_addresses d ON d.id=r.address_id WHERE ${filter} ORDER BY CASE WHEN r.status IN ('completed','cancelled') THEN 2 WHEN r.priority='urgent' THEN 0 ELSE 1 END,r.created_at,r.id LIMIT 25 OFFSET $2`,[status,(page-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM service_requests r WHERE ${filter}`,[status])).rows[0].count;
  res.json({ok:true,requests,total,page});
 }));
 router.patch('/admin/requests/:id',wrap(async(req,res)=>{
  await permitted(req,'admin'); fields(req.body,['status','customer_update','internal_notes','priority','appointment_at','follow_up_on']);
  if(!statuses.includes(req.body.status)) fail(400,'Select a status.');
  const id=uuid(req.params.id);
  const body=req.body;
  if(body.priority!==undefined && !['normal','urgent'].includes(body.priority))fail(400,'Select a priority.');
  if(body.appointment_at && (typeof body.appointment_at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.appointment_at) || !Number.isFinite(Date.parse(body.appointment_at)) || new Date(body.appointment_at).toISOString().slice(0,19)!==body.appointment_at.slice(0,19)))fail(400,'Choose a valid appointment time.');
  if(body.follow_up_on && (typeof body.follow_up_on!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.follow_up_on) || !Number.isFinite(Date.parse(body.follow_up_on)) || new Date(body.follow_up_on).toISOString().slice(0,10)!==body.follow_up_on))fail(400,'Choose a valid follow-up date.');
  const customerUpdate=multiline(body.customer_update,1500), notes=multiline(body.internal_notes,3000);
  const emailId=await db.transaction(async client=>{
   const old=(await client.query('SELECT * FROM service_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!old)fail(404,'Request not found.');
   const appointment=body.appointment_at===undefined?old.appointment_at:body.appointment_at||null;
   const row=(await client.query('UPDATE service_requests SET status=$1,customer_update=$2,internal_notes=$3,priority=$4,appointment_at=$5,follow_up_on=$6,updated_at=now() WHERE id=$7 RETURNING *',
    [body.status,body.customer_update===undefined?old.customer_update:customerUpdate,body.internal_notes===undefined?old.internal_notes:notes,body.priority||old.priority,appointment,body.follow_up_on===undefined?old.follow_up_on:body.follow_up_on||null,id])).rows[0];
   const changed=old.status!==row.status || (row.customer_update && old.customer_update!==row.customer_update) || String(old.appointment_at||'')!==String(row.appointment_at||'');
   if(!changed)return null;
   const account=(await client.query('SELECT name,email FROM customer_accounts WHERE id=$1',[row.account_id])).rows[0];
   const emailId=randomUUID();
   await client.query('INSERT INTO service_request_emails(id,request_id,recipient,payload) VALUES($1,$2,$3,$4)',[emailId,id,account.email,JSON.stringify(serviceUpdateEmail({...row,name:account.name,portalUrl:origin+'/account/dashboard#requests'}))]);
   return emailId;
  });
  let email='not_needed';
  if(emailId){try{email=await notifications.deliver(emailId);}catch(_){email='queued';}}
  res.json({ok:true,email});
 }));
}
module.exports={installPortal};
