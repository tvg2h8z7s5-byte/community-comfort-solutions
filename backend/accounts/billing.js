'use strict';
const { randomUUID, createHash } = require('node:crypto');
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
const MAX = 100000000;
const pricebookCatalog = require('./pricebook-catalog.json');
function invalid(message) { const e=new Error(message); e.status=400; throw e; }
function integer(v,min,max,label) { if(!Number.isSafeInteger(v)||v<min||v>max) invalid('Enter a valid '+label+'.'); return v; }
function plain(v,max,required=false) { if(v===undefined&&!required)return ''; if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||(required&&!v.trim()))invalid('Enter valid document details.'); return v.trim(); }
function uuid(v) { if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))invalid('Invalid record.'); return v.toLowerCase(); }
function day(v,required=false) { if(!v&&!required)return null; if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)invalid('Choose a valid date.');return v; }
function round(n,d) {return Number((n+d/2n)/d);}
function calculate(items,discount=0,taxBps=0) {
 if(!Array.isArray(items)||!items.length||items.length>30)invalid('Add between 1 and 30 line items.');
 let subtotal=0,taxable=0;
 const lines=items.map(item=>{
  if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['description','quantity_milli','unit_cents','taxable','unit'].includes(k)))invalid('Invalid line item.');
  const quantity_milli=integer(item.quantity_milli,1,1000000,'quantity'),unit_cents=integer(item.unit_cents,0,MAX,'unit price');
  if(typeof item.taxable!=='boolean')invalid('Choose whether each item is taxable.');
  const line_cents=round(BigInt(quantity_milli)*BigInt(unit_cents),1000n);
  if(line_cents>MAX)invalid('Line item exceeds the invoice limit.');
  subtotal+=line_cents;if(item.taxable)taxable+=line_cents;
  return {description:plain(item.description,300,true),quantity_milli,unit_cents,taxable:item.taxable,unit:plain(item.unit,30)||'each',line_cents};
 });
 integer(subtotal,0,MAX,'subtotal');integer(discount,0,subtotal,'discount');integer(taxBps,0,2000,'tax rate');
 const tax=subtotal?round(BigInt(taxable)*BigInt(subtotal-discount)*BigInt(taxBps),BigInt(subtotal)*10000n):0;
 const total=subtotal-discount+tax;integer(total,0,MAX,'total');
 return {items:lines,subtotal_cents:subtotal,discount_cents:discount,tax_bps:taxBps,tax_cents:tax,total_cents:total};
}
function installBilling(router,{db,authenticated,fields,fail,operationsMail}) {
 async function permitted(req,role='admin') {const {account}=await authenticated(req);if(account.role!==role)fail(403,'You do not have access to this area.');return account;}
 const base='/admin/billing';
 const paidSQL="coalesce((SELECT sum(p.amount_cents)::int FROM billing_payments p WHERE p.document_id=d.id AND p.voided_at IS NULL),0)";
 async function detail(c,id,customer=false) {
  const d=(await c.query(`SELECT d.*,${paidSQL} AS paid_cents FROM billing_documents d WHERE d.id=$1`,[id])).rows[0];
  if(!d)fail(404,'Document not found.');
  d.balance_cents=d.total_cents-d.paid_cents;
  d.payments=(await c.query('SELECT id,amount_cents,method,paid_on,reference,voided_at,void_reason,created_at FROM billing_payments WHERE document_id=$1 ORDER BY created_at,id',[id])).rows;
  if(!customer)d.emails=(await c.query("SELECT id,recipient,state,attempts,sent_at,created_at FROM operations_emails WHERE document_id=$1 ORDER BY created_at DESC LIMIT 20",[id])).rows;
  if(customer){delete d.archived_at;delete d.duplicated_from_id;delete d.created_by;delete d.creation_hash;d.payments=d.payments.filter(p=>!p.voided_at).map(({amount_cents,method,paid_on})=>({amount_cents,method,paid_on}));}
  return d;
 }
 async function lock(c,id,revision) {
  const d=(await c.query('SELECT * FROM billing_documents WHERE id=$1 FOR UPDATE',[uuid(id)])).rows[0];
  if(!d)fail(404,'Document not found.');
  if(revision!==undefined&&integer(revision,1,2147483647,'revision')!==d.revision)fail(409,'This document changed. Reload it before saving.');
  return d;
 }
 async function documentData(c,body) {
  const account_id=body.account_id?uuid(body.account_id):null,request_id=body.request_id?uuid(body.request_id):null;
  if(account_id && !(await c.query("SELECT id FROM customer_accounts WHERE id=$1 AND role='customer'",[account_id])).rows.length)fail(404,'Customer not found.');
  if(request_id && (!account_id || !(await c.query('SELECT id FROM service_requests WHERE id=$1 AND account_id=$2',[request_id,account_id])).rows.length))invalid('Select a service request belonging to this customer.');
  fields(body.customer,['name','email','phone','address']);
  const customer={name:plain(body.customer.name,150,true),email:plain(body.customer.email,254),phone:plain(body.customer.phone,40),address:plain(body.customer.address,500)};
  if(customer.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))invalid('Enter a valid customer email.');
  if(!['estimate','invoice'].includes(body.kind))invalid('Choose estimate or invoice.');
  return {kind:body.kind,account_id,request_id,customer,...calculate(body.items,body.discount_cents,body.tax_bps),due_on:day(body.due_on),notes:plain(body.notes,3000),technician:plain(body.technician,100)};
 }
 async function insert(c,values,actor,id=randomUUID(),source=null) {
  const n=(await c.query('INSERT INTO billing_counters(kind,value) VALUES($1,1) ON CONFLICT(kind) DO UPDATE SET value=billing_counters.value+1 RETURNING value',[values.kind])).rows[0].value;
  const business=(await c.query('SELECT company,phone,email,address,website,terms FROM billing_settings WHERE id=1')).rows[0];
  const hash=createHash('sha256').update(JSON.stringify(values)).digest('hex');
  await c.query(`INSERT INTO billing_documents(id,number,kind,account_id,request_id,source_estimate_id,customer,business,items,subtotal_cents,discount_cents,tax_bps,tax_cents,total_cents,due_on,notes,technician,created_by,creation_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,[id,(values.kind==='invoice'?'INV-':'EST-')+String(n).padStart(6,'0'),values.kind,values.account_id,values.request_id,source,JSON.stringify(values.customer),JSON.stringify(business),JSON.stringify(values.items),values.subtotal_cents,values.discount_cents,values.tax_bps,values.tax_cents,values.total_cents,values.due_on,values.notes,values.technician,actor.id,hash]);
  return detail(c,id);
 }
 router.get(base+'/settings',wrap(async(req,res)=>{await permitted(req);res.json({ok:true,settings:(await db.query('SELECT company,phone,email,address,website,terms FROM billing_settings WHERE id=1')).rows[0]});}));
 router.patch(base+'/settings',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['company','phone','email','address','website','terms']);const b=req.body;
  const email=plain(b.email,254);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid('Enter a valid business email.');
  await db.query('UPDATE billing_settings SET company=$1,phone=$2,email=$3,address=$4,website=$5,terms=$6,updated_at=now() WHERE id=1',[plain(b.company,150,true),plain(b.phone,40),email,plain(b.address,500),plain(b.website,200),plain(b.terms,2000)]);res.json({ok:true});
 }));
 router.get(base+'/customers',wrap(async(req,res)=>{
  await permitted(req);const search=plain(req.query.search,100);
  const customers=(await db.query(`SELECT id,name,email,phone FROM customer_accounts WHERE role='customer' AND ($1='' OR position(lower($1) in lower(name||' '||coalesce(email,'')||' '||phone))>0) ORDER BY name,email LIMIT 50`,[search])).rows;
  res.json({ok:true,customers});
 }));
 router.get(base+'/pricebook-catalog',wrap(async(req,res)=>{
  await permitted(req);
  const existing=(await db.query('SELECT id,name,unit_cents,active FROM billing_pricebook')).rows;
  res.json({ok:true,catalog:{...pricebookCatalog,items:pricebookCatalog.items.map(item=>({...item,existing:existing.find(p=>p.id===item.id||p.name.trim().toLowerCase()===item.name.toLowerCase())||null}))}});
 }));
 router.post(base+'/pricebook-catalog/import',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['ids','parts_taxable']);
  const ids=req.body.ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'||!pricebookCatalog.items.some(item=>item.id===id))||new Set(ids).size!==ids.length||typeof req.body.parts_taxable!=='boolean')invalid('Select valid catalog items.');
  const imported=await db.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(7349014)');
   let imported=0;
   for(const id of ids){const item=pricebookCatalog.items.find(item=>item.id===id);
    const row=await c.query(`INSERT INTO billing_pricebook(id,name,category,description,unit,unit_cents,taxable,active)
     SELECT $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::integer,$7::boolean,true WHERE NOT EXISTS(SELECT 1 FROM billing_pricebook WHERE lower(trim(name))=lower($2)) ON CONFLICT(id) DO NOTHING RETURNING id`,[item.id,item.name,item.category,item.description,item.unit,item.unit_cents,item.category==='Parts'?req.body.parts_taxable:item.taxable]);
    imported+=row.rows.length;
   }
   return imported;
  });
  res.json({ok:true,imported,skipped:ids.length-imported});
 }));
 router.get(base+'/pricebook',wrap(async(req,res)=>{
  await permitted(req);const search=plain(req.query.search,100);
  res.json({ok:true,items:(await db.query("SELECT * FROM billing_pricebook WHERE ($1='' OR position(lower($1) in lower(name||' '||description))>0) AND ($2 OR active) ORDER BY category,name LIMIT 200",[search,req.query.archived==='true'])).rows});
 }));
 function priceData(body){fields(body,['name','category','description','unit','unit_cents','taxable','active']);if(!['Heating','Cooling','Maintenance','Diagnosis','Parts','Other'].includes(body.category)||typeof body.taxable!=='boolean'||typeof body.active!=='boolean')invalid('Choose valid pricebook details.');return [plain(body.name,150,true),body.category,plain(body.description,1000),plain(body.unit,30,true),integer(body.unit_cents,0,MAX,'unit price'),body.taxable,body.active];}
 router.post(base+'/pricebook',wrap(async(req,res)=>{await permitted(req);const id=randomUUID();await db.query('INSERT INTO billing_pricebook(id,name,category,description,unit,unit_cents,taxable,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,...priceData(req.body)]);res.status(201).json({ok:true,id});}));
 router.patch(base+'/pricebook/:id',wrap(async(req,res)=>{await permitted(req);const r=await db.query('UPDATE billing_pricebook SET name=$1,category=$2,description=$3,unit=$4,unit_cents=$5,taxable=$6,active=$7,updated_at=now() WHERE id=$8 RETURNING id',[...priceData(req.body),uuid(req.params.id)]);if(!r.rows.length)fail(404,'Pricebook item not found.');res.json({ok:true});}));
 router.get(base+'/summary',wrap(async(req,res)=>{
  await permitted(req);const totals=(await db.query(`SELECT coalesce(sum(total_cents) FILTER(WHERE kind='estimate' AND status='issued'),0)::bigint AS estimates_cents,
   coalesce(sum(total_cents-${paidSQL}) FILTER(WHERE kind='invoice' AND status='issued'),0)::bigint AS outstanding_cents,
   coalesce(sum(total_cents-${paidSQL}) FILTER(WHERE kind='invoice' AND status='issued' AND due_on<(now() AT TIME ZONE 'America/New_York')::date),0)::bigint AS overdue_cents,
   coalesce(sum(${paidSQL}) FILTER(WHERE kind='invoice'),0)::bigint AS collected_cents FROM billing_documents d`)).rows[0];res.json({ok:true,totals});
 }));
 router.get(base+'/documents',wrap(async(req,res)=>{
  await permitted(req);const kind=req.query.kind||'invoice',status=req.query.status||'',search=plain(req.query.search,100),page=Number(req.query.page||1),archive=req.query.archive||'current';
  if(!['current','archived','all'].includes(archive)||!['estimate','invoice'].includes(kind)||!['','draft','issued','accepted','declined','void','paid','unpaid','overdue'].includes(status)||!Number.isInteger(page)||page<1||page>100000)invalid('Invalid document filter.');
  const where=`($4='all' OR ($4='current' AND d.archived_at IS NULL) OR ($4='archived' AND d.archived_at IS NOT NULL)) AND d.kind=$1 AND ($2='' OR d.status=$2 OR ($2='paid' AND d.status='issued' AND ${paidSQL}=d.total_cents) OR ($2='unpaid' AND d.status='issued' AND ${paidSQL}<d.total_cents) OR ($2='overdue' AND d.status='issued' AND ${paidSQL}<d.total_cents AND due_on<(now() AT TIME ZONE 'America/New_York')::date)) AND ($3='' OR position(lower($3) in lower(d.number||' '||(d.customer->>'name')))>0)`;
  const docs=(await db.query(`SELECT d.id,d.number,d.kind,d.status,d.customer,d.total_cents,d.due_on,d.created_at,d.archived_at,${paidSQL} AS paid_cents FROM billing_documents d WHERE ${where} ORDER BY d.created_at DESC,d.id LIMIT 25 OFFSET $5`,[kind,status,search,archive,(page-1)*25])).rows;
  const total=(await db.query(`SELECT count(*)::int AS count FROM billing_documents d WHERE ${where}`,[kind,status,search,archive])).rows[0].count;
  res.json({ok:true,documents:docs,total,page});
 }));
 const allowed=['id','kind','account_id','request_id','customer','items','discount_cents','tax_bps','due_on','notes','technician'];
 router.post(base+'/documents',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,allowed);const id=uuid(req.body.id);
  const doc=await db.transaction(async c=>{
   // Serialize retries of the same client-generated document ID.
   await c.query('SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE',[actor.id]);
   const v=await documentData(c,req.body),hash=createHash('sha256').update(JSON.stringify(v)).digest('hex');
   const old=(await c.query('SELECT id,creation_hash,created_by FROM billing_documents WHERE id=$1',[id])).rows[0];
   if(old){if(old.creation_hash!==hash||old.created_by!==actor.id)fail(409,'This draft was already saved with different details.');return detail(c,id);}
   return insert(c,v,actor,id);
  });res.status(201).json({ok:true,document:doc});
 }));
 router.get(base+'/documents/:id',wrap(async(req,res)=>{await permitted(req);res.json({ok:true,document:await detail(db,uuid(req.params.id))});}));
 router.patch(base+'/documents/:id',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,[...allowed.filter(x=>x!=='id'),'revision']);
  const doc=await db.transaction(async c=>{const old=await lock(c,req.params.id,integer(req.body.revision,1,2147483647,'revision'));if(old.status!=='draft')fail(409,'Only drafts can be edited.');const v=await documentData(c,req.body);if(v.kind!==old.kind)invalid('Document type cannot change.');if(old.source_estimate_id&&(v.account_id!==old.account_id||v.request_id!==old.request_id))invalid('Converted invoices must keep their original customer and request.');
   const business=(await c.query('SELECT company,phone,email,address,website,terms FROM billing_settings WHERE id=1')).rows[0];
   await c.query(`UPDATE billing_documents SET account_id=$1,request_id=$2,customer=$3,business=$4,items=$5,subtotal_cents=$6,discount_cents=$7,tax_bps=$8,tax_cents=$9,total_cents=$10,due_on=$11,notes=$12,technician=$13,revision=revision+1,updated_at=now() WHERE id=$14`,[v.account_id,v.request_id,JSON.stringify(v.customer),JSON.stringify(business),JSON.stringify(v.items),v.subtotal_cents,v.discount_cents,v.tax_bps,v.tax_cents,v.total_cents,v.due_on,v.notes,v.technician,old.id]);return detail(c,old.id);});res.json({ok:true,document:doc});
 }));
 router.post(base+'/documents/:id/status',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['status','revision']);
  const doc=await db.transaction(async c=>{const old=await lock(c,req.params.id,integer(req.body.revision,1,2147483647,'revision')),next=req.body.status;
   if(next===old.status)return detail(c,old.id);
   const valid=(old.status==='draft'&&['issued','void'].includes(next))||(old.kind==='estimate'&&old.status==='issued'&&['accepted','declined','void'].includes(next))||(old.kind==='invoice'&&old.status==='issued'&&next==='void');
   if(!valid)fail(409,'This status change is unavailable.');
   if(next==='void'&&(await c.query('SELECT id FROM billing_payments WHERE document_id=$1 AND voided_at IS NULL LIMIT 1',[old.id])).rows.length)fail(409,'Reverse recorded payments before voiding an invoice.');
   await c.query("UPDATE billing_documents SET status=$1,issued_at=CASE WHEN $1='issued' THEN now() ELSE issued_at END,revision=revision+1,updated_at=now() WHERE id=$2",[next,old.id]);return detail(c,old.id);});res.json({ok:true,document:doc});
 }));
 router.post(base+'/documents/:id/convert',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,[]);
  const doc=await db.transaction(async c=>{const old=await lock(c,req.params.id);if(old.kind!=='estimate'||old.status!=='accepted')fail(409,'Mark an issued estimate accepted before converting it.');
   const prior=(await c.query('SELECT id FROM billing_documents WHERE source_estimate_id=$1',[old.id])).rows[0];if(prior)return detail(c,prior.id);
   return insert(c,{...old,kind:'invoice',due_on:null},actor,randomUUID(),old.id);});res.status(201).json({ok:true,document:doc});
 }));
 router.post(base+'/documents/:id/payments',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['id','amount_cents','method','paid_on','reference']);const b=req.body,id=uuid(b.id),amount=integer(b.amount_cents,1,MAX,'payment amount'),paid_on=day(b.paid_on,true),reference=plain(b.reference,200);
  if(!['cash','check','card','bank','other'].includes(b.method))invalid('Choose a payment method.');
  if(paid_on>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))invalid('Payment date cannot be in the future.');
  const doc=await db.transaction(async c=>{const old=await lock(c,req.params.id);if(old.kind!=='invoice'||old.status!=='issued')fail(409,'Issue the invoice before recording a payment.');
   const previous=(await c.query('SELECT * FROM billing_payments WHERE id=$1',[id])).rows[0];
   if(previous){if(previous.document_id!==old.id||previous.amount_cents!==amount||previous.method!==b.method||(previous.paid_on instanceof Date?previous.paid_on.toISOString().slice(0,10):String(previous.paid_on).slice(0,10))!==paid_on||previous.reference!==reference)fail(409,'This payment was already recorded with different details.');return detail(c,old.id);}
   const paid=(await c.query('SELECT coalesce(sum(amount_cents),0)::int AS total FROM billing_payments WHERE document_id=$1 AND voided_at IS NULL',[old.id])).rows[0].total;
   if(amount>old.total_cents-paid)invalid('Payment exceeds the remaining balance.');
   await c.query('INSERT INTO billing_payments(id,document_id,amount_cents,method,paid_on,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,old.id,amount,b.method,paid_on,reference,actor.id]);
   await c.query('UPDATE billing_documents SET revision=revision+1,updated_at=now() WHERE id=$1',[old.id]);return detail(c,old.id);});res.status(201).json({ok:true,document:doc});
 }));
 router.post(base+'/documents/:id/payments/:payment/void',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['reason']);const reason=plain(req.body.reason,500,true);
  await db.transaction(async c=>{const d=await lock(c,req.params.id);const p=(await c.query('SELECT id,voided_at FROM billing_payments WHERE id=$1 AND document_id=$2',[uuid(req.params.payment),d.id])).rows[0];if(!p)fail(404,'Payment not found.');if(!p.voided_at){await c.query('UPDATE billing_payments SET voided_at=now(),void_reason=$1,voided_by=$2 WHERE id=$3',[reason,actor.id,p.id]);await c.query('UPDATE billing_documents SET revision=revision+1,updated_at=now() WHERE id=$1',[d.id]);}});res.json({ok:true});
 }));

 router.post(base+'/documents/:id/archive',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['archived','revision']);if(typeof req.body.archived!=='boolean')invalid('Choose archive or restore.');
  const doc=await db.transaction(async c=>{const old=await lock(c,req.params.id,integer(req.body.revision,1,2147483647,'revision'));await c.query('UPDATE billing_documents SET archived_at=CASE WHEN $1 THEN now() ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=$2',[req.body.archived,old.id]);return detail(c,old.id);});res.json({ok:true,document:doc});
 }));
 router.delete(base+'/documents/:id',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['revision']);
  await db.transaction(async c=>{const old=await lock(c,req.params.id,integer(req.body.revision,1,2147483647,'revision'));
   if(old.status!=='draft'||old.issued_at)fail(409,'Only unissued drafts can be deleted. Archive issued documents instead.');
   if((await c.query(`SELECT 1 FROM billing_payments WHERE document_id=$1 UNION ALL SELECT 1 FROM operations_emails WHERE document_id=$1 UNION ALL SELECT 1 FROM equipment_service_history WHERE document_id=$1 UNION ALL SELECT 1 FROM billing_documents WHERE source_estimate_id=$1 OR duplicated_from_id=$1 LIMIT 1`,[old.id])).rows.length)fail(409,'This draft has linked records. Void or archive it instead.');
   await c.query('DELETE FROM billing_documents WHERE id=$1',[old.id]);});res.json({ok:true});
 }));
 router.post(base+'/documents/:id/duplicate',wrap(async(req,res)=>{
  const actor=await permitted(req);fields(req.body,['id']);const id=uuid(req.body.id);
  const doc=await db.transaction(async c=>{const source=await lock(c,req.params.id),existing=(await c.query('SELECT id,duplicated_from_id,created_by FROM billing_documents WHERE id=$1',[id])).rows[0];
   if(existing){if(existing.duplicated_from_id!==source.id||existing.created_by!==actor.id)fail(409,'This duplicate identifier is already in use.');return detail(c,id);}
   const draft=await insert(c,{kind:source.kind,account_id:source.account_id,request_id:null,customer:source.customer,items:source.items,subtotal_cents:source.subtotal_cents,discount_cents:source.discount_cents,tax_bps:source.tax_bps,tax_cents:source.tax_cents,total_cents:source.total_cents,due_on:null,notes:'',technician:source.technician},actor,id);
   await c.query('UPDATE billing_documents SET duplicated_from_id=$1 WHERE id=$2',[source.id,draft.id]);return detail(c,draft.id);});res.status(201).json({ok:true,document:doc});
 }));
 router.post(base+'/documents/:id/email',wrap(async(req,res)=>{
  await permitted(req);fields(req.body,['id']);const id=uuid(req.body.id);
  const queued=await db.transaction(async c=>{const old=await lock(c,req.params.id);if(!old.issued_at||!['issued','accepted'].includes(old.status))fail(409,'Issue an active document before emailing it.');
   const recipient=old.customer.email;if(!recipient||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))invalid('This document needs a valid customer email.');
   const key='document:'+id,existing=(await c.query('SELECT id,document_id,state FROM operations_emails WHERE dedupe_key=$1',[key])).rows[0];
   if(existing){if(existing.document_id!==old.id)fail(409,'Email identifier is already in use.');return existing;}
   const recent=(await c.query("SELECT count(*)::int AS count FROM operations_emails WHERE document_id=$1 AND created_at>now()-interval '1 hour'",[old.id])).rows[0].count;if(recent>=5)fail(429,'Too many document emails. Try again later.');
   const document=await detail(c,old.id);delete document.emails;delete document.creation_hash;delete document.created_by;
   const payload={subject:old.number+' | Community Comfort Solutions',text:`Hello ${old.customer.name},\n\nYour ${old.kind} ${old.number} is attached as a PDF. Please contact us at 917-608-3201 with any questions.\n\nCommunity Comfort Solutions`,document};
   await c.query('INSERT INTO operations_emails(id,document_id,category,dedupe_key,recipient,payload) VALUES($1,$2,$3,$4,$5,$6)',[id,old.id,'document',key,recipient,JSON.stringify(payload)]);return {id,state:'queued'};
  });let email=queued.state;if(email==='queued'){try{email=await operationsMail.deliver(queued.id);}catch(_){email='queued';}}res.json({ok:true,email,id:queued.id});
 }));
 router.get('/billing/documents',wrap(async(req,res)=>{const a=await permitted(req,'customer');res.json({ok:true,documents:(await db.query(`SELECT d.id,d.number,d.kind,d.status,d.customer,d.total_cents,d.due_on,d.created_at,${paidSQL} AS paid_cents FROM billing_documents d WHERE d.account_id=$1 AND d.issued_at IS NOT NULL ORDER BY created_at DESC LIMIT 200`,[a.id])).rows});}));
 async function accessible(req,id) {const {account}=await authenticated(req);if(!['admin','customer'].includes(account.role))fail(403,'You do not have access to this area.');const d=await detail(db,uuid(id),account.role==='customer');if(account.role==='customer'&&(d.account_id!==account.id||!d.issued_at))fail(404,'Document not found.');return d;}
 router.get('/billing/documents/:id',wrap(async(req,res)=>res.json({ok:true,document:await accessible(req,req.params.id)})));
 router.get('/billing/documents/:id/pdf',wrap(async(req,res)=>{const d=await accessible(req,req.params.id);const buffer=await require('./billing-pdf').invoicePDF(d);res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${d.number}.pdf"`});res.send(buffer);}));
}
module.exports={installBilling,calculate,plain,uuid,day,integer};
