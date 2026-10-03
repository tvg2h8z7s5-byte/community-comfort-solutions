'use strict';
const {randomUUID}=require('node:crypto');
const services=['Heating repair','Cooling repair','Diagnosis','Seasonal tune-up'];
async function saveInquiry(db,data,kind){
 const id=randomUUID();
 await db.query('INSERT INTO website_inquiries(id,kind,data) VALUES($1,$2,$3)',[id,kind,JSON.stringify(data)]);
 return id;
}
function installInquiries(router,{db,authenticated,fields,text,fail}){
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))fail(400,'Invalid record.');return v;};
 const admin=async req=>{if((await authenticated(req)).account.role!=='admin')fail(403,'You do not have access to this area.');};
 const email=v=>{const e=text(v,200).toLowerCase();if(e&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))fail(400,'Enter a valid email.');return e;};
 const notes=v=>{if(typeof v!=='string'||v.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))fail(400,'Invalid notes.');return v.trim();};
 router.get('/admin/inquiries',wrap(async(req,res)=>{
  await admin(req);const status=text(req.query.status,20)||'new',search=text(req.query.search,100),page=Number(req.query.page||1);
  if(!['new','contacted','archived','converted','active','all'].includes(status)||!Number.isInteger(page)||page<1||page>100000)fail(400,'Invalid filter.');
  const filter="($1='all' OR status=$1 OR ($1='active' AND status IN ('new','contacted'))) AND ($2='' OR position(lower($2) in lower(data->>'name'||' '||coalesce(data->>'email','')||' '||coalesce(data->>'phone','')||' '||coalesce(data->>'town','')))>0)";
  const inquiries=(await db.query(`SELECT * FROM website_inquiries WHERE ${filter} ORDER BY created_at,id LIMIT 25 OFFSET $3`,[status,search,(page-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM website_inquiries WHERE ${filter}`,[status,search])).rows[0].count;
  res.json({ok:true,inquiries,total,page});
 }));
 router.post('/admin/inquiries',wrap(async(req,res)=>{
  await admin(req);fields(req.body,['name','email','phone','address','town','system','message']);
  const data={name:text(req.body.name,100,true),email:email(req.body.email),phone:text(req.body.phone,40),address:text(req.body.address,200),town:text(req.body.town,100),system:text(req.body.system,40),message:notes(req.body.message||'')};
  if(!data.email&&!data.phone)fail(400,'Enter a phone number or email.');
  res.status(201).json({ok:true,id:await saveInquiry(db,data,'manual')});
 }));
 router.patch('/admin/inquiries/:id',wrap(async(req,res)=>{
  await admin(req);fields(req.body,['status','internal_notes']);const id=uuid(req.params.id);
  if(!['new','contacted','archived'].includes(req.body.status))fail(400,'Select an inquiry status.');
  const result=await db.query("UPDATE website_inquiries SET status=$1,internal_notes=coalesce($2,internal_notes),updated_at=now() WHERE id=$3 AND request_id IS NULL RETURNING id",[req.body.status,req.body.internal_notes===undefined?null:notes(req.body.internal_notes),id]);
  if(!result.rows.length)fail(409,'Inquiry was converted or is unavailable. Refresh the list.');
  res.json({ok:true});
 }));
 router.post('/admin/inquiries/:id/convert',wrap(async(req,res)=>{
  await admin(req);fields(req.body,['account_id','name','email','phone','line1','city','region','postal_code','service','description']);
  const id=uuid(req.params.id),owner=req.body.account_id?uuid(req.body.account_id):null;
  if(!services.includes(req.body.service))fail(400,'Select a service.');
  const name=text(req.body.name,100,true),address=text(req.body.line1,200,true),city=text(req.body.city,100,true),region=text(req.body.region,100,true),zip=text(req.body.postal_code,20,true),description=notes(req.body.description);
  if(!description)fail(400,'Enter a work description.');
  const contactEmail=email(req.body.email),phone=text(req.body.phone,40);
  if(!owner&&!contactEmail&&!phone)fail(400,'Enter a phone number or email.');
  const result=await db.transaction(async c=>{
   const lead=(await c.query('SELECT * FROM website_inquiries WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!lead)fail(404,'Inquiry not found.');
   if(lead.request_id)return {id:lead.request_id,already_converted:true};
   if(lead.status==='archived')fail(409,'Restore this inquiry before converting it.');
   let accountId=owner;
   if(owner){
    if(!(await c.query("SELECT id FROM customer_accounts WHERE id=$1 AND role='customer' AND state='active' FOR UPDATE",[owner])).rows.length)fail(400,'Select an active customer.');
   }else{
    accountId=randomUUID();
    const created=await c.query("INSERT INTO customer_accounts(id,email,password_hash,name,phone) VALUES($1,$2,'!guest',$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",[accountId,contactEmail||null,name,phone]);
    if(!created.rows.length)fail(409,'This email already belongs to a customer. Search and select that customer before converting.');
   }
   let addressId=(await c.query("SELECT id FROM customer_addresses WHERE account_id=$1 AND line1=$2 AND city=$3 AND region=$4 AND postal_code=$5 AND line2='' LIMIT 1",[accountId,address,city,region,zip])).rows[0]?.id;
   if(!addressId){addressId=randomUUID();await c.query('INSERT INTO customer_addresses(id,account_id,line1,city,region,postal_code) VALUES($1,$2,$3,$4,$5,$6)',[addressId,accountId,address,city,region,zip]);}
   const requestId=randomUUID();
   const day=lead.data.preferred_day,preferred=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day?day:null;
   await c.query('INSERT INTO service_requests(id,account_id,address_id,service,description,preferred_day,internal_notes) VALUES($1,$2,$3,$4,$5,$6,$7)',[requestId,accountId,addressId,req.body.service,description,preferred,lead.internal_notes]);
   await c.query("UPDATE website_inquiries SET status='converted',request_id=$1,updated_at=now() WHERE id=$2",[requestId,id]);
   return {id:requestId,account_id:accountId};
  });
  res.json({ok:true,...result});
 }));
}
module.exports={saveInquiry,installInquiries};
