'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('../backend/node_modules/jsdom');
const {calculate}=require('../backend/accounts/billing');
const {randomUUID}=require('node:crypto');
const root=require('node:path').join(__dirname,'..');
async function settled(window,condition){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI did not settle: '+window.document.querySelector('#notice').textContent);}
test('billing UI builds a linked estimate, saves and issues, converts, records payment, and shows customer PDF link',async()=>{
 const accountId=randomUUID(),reqId=randomUUID();let role='admin';const docs=new Map(),calls=[];
 const customer={id:accountId,name:'Alex Example',email:'alex@example.test',phone:'202-555-0100'};
 const settings={company:'Community Comfort Solutions',phone:'917-608-3201',email:'contact@communitycomfortsolutions.org',address:'',website:'communitycomfortsolutions.org',terms:''};
 const tune={id:randomUUID(),name:'Standard heating tune-up',category:'Maintenance',description:'Electrical checks and system health report',unit:'system',unit_cents:10900,taxable:false,active:true};
 const dom=new JSDOM(fs.readFileSync(root+'/backend/accounts/views/dashboard.html','utf8'),{url:'https://fixture.example/account/admin#new-document?kind=estimate&account='+accountId+'&request='+reqId,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,$=s=>w.document.querySelector(s);
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;w.prompt=()=> 'Correction';
 w.fetch=async(url,opts)=>{
  const route=new URL(url,'https://fixture.example').pathname.replace('/api/account/',''),body=opts.body?JSON.parse(opts.body):undefined;calls.push({route,body});let result={ok:true};
  if(route==='session')result={...result,account:{...customer,role},csrfToken:'fixture'};
  else if(route==='admin/accounts/'+accountId)result={...result,account:customer,addresses:[{id:randomUUID(),line1:'100 Example St',city:'Old Bridge',region:'NJ',postal_code:'08857'}],requests:[{id:reqId,service:'Seasonal tune-up',status:'requested',created_at:'2026-10-01'}]};
  else if(route==='admin/billing/pricebook')result.items=[tune];
  else if(route==='admin/billing/summary')result.totals={outstanding_cents:0,overdue_cents:0,collected_cents:0};
  else if(route==='admin/billing/settings')result.settings=settings;
  else if(route==='admin/billing/documents'&&body){const d={...body,...calculate(body.items,body.discount_cents,body.tax_bps),business:settings,number:'EST-000001',status:'draft',revision:1,paid_cents:0,balance_cents:10900,payments:[],created_at:'2026-10-02'};docs.set(d.id,d);result.document=d;}
  else if(route==='admin/billing/documents'){result={...result,documents:[...docs.values()],page:1,total:docs.size};}
  else if(/^admin\/billing\/documents\/[^/]+$/.test(route)){const id=route.split('/').at(-1);result.document=docs.get(id);}
  else if(route.endsWith('/status')){const d=docs.get(route.split('/').at(-2));d.status=body.status;d.revision++;result.document=d;}
  else if(route.endsWith('/convert')){const d=docs.get(route.split('/').at(-2));const converted={...d,id:randomUUID(),kind:'invoice',number:'INV-000001',status:'draft',revision:1};docs.set(converted.id,converted);result.document=converted;}
  else if(route.endsWith('/payments')){const d=docs.get(route.split('/').at(-2));d.paid_cents+=body.amount_cents;d.balance_cents=d.total_cents-d.paid_cents;d.payments.push({...body});result.document=d;}
  else if(route==='billing/documents')result.documents=[...docs.values()].filter(d=>d.status!=='draft');
  else if(route.startsWith('billing/documents/'))result.document=docs.get(route.split('/').at(-1));
  else if(route==='admin/billing/customers')result.customers=[customer];
  else throw Error('Unexpected fixture route '+route);
  return {status:200,ok:true,json:async()=>result};
 };
 w.eval(fs.readFileSync(root+'/site/maintenance.js','utf8'));w.eval(fs.readFileSync(root+'/site/operations.js','utf8'));w.eval(fs.readFileSync(root+'/site/billing.js','utf8'));w.eval(fs.readFileSync(root+'/site/portal.js','utf8'));
 try{
  await settled(w,()=>!!$('#document-form'));assert.equal($('#customer-name').value,'Alex Example');assert.equal($('#request-link').value,reqId);assert.match($('#linked-customer').textContent,/alex@example/);
  $('#price-picker').value=tune.id;$('#add-from-price').click();await settled(w,()=>!!$('[data-line-description]'));
  assert.match($('#live-totals').textContent,/109\.00/);$('#notes').value='<script>should remain text</script>';$('#document-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await settled(w,()=>!!$('#issue-draft'));const savedCall=calls.find(c=>c.route==='admin/billing/documents'&&c.body);assert.equal(savedCall.body.items[0].unit_cents,10900);assert.equal(savedCall.body.account_id,accountId);assert.equal(savedCall.body.request_id,reqId);
  $('#issue-draft').click();await settled(w,()=>!!$('#accept-estimate'));assert.equal(w.document.querySelectorAll('.invoice-preview script').length,0);
  $('#accept-estimate').click();await settled(w,()=>!!$('#convert-estimate'));$('#convert-estimate').click();await settled(w,()=>$('#document-form')&&$('#breadcrumb').textContent==='Your account');
  assert.match($('#content').textContent,/INV-000001/);$('#issue-draft').click();await settled(w,()=>!!$('#payment-form'));
  $('#amount').value='50.00';$('#payment-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settled(w,()=>$('#content').textContent.includes('$59.00'));
  const pay=calls.find(c=>c.route.endsWith('/payments')&&c.body);assert.equal(pay.body.amount_cents,5000);assert.match(pay.body.id,/^[a-f0-9-]{36}$/);
  w.location.hash='invoices';await settled(w,()=>!!$('#billing-filter'));assert.equal($('#status').required,false);
  // Reinitialize as a customer to exercise the independent read-only document view.
  role='customer';w.location.hash='billing';w.eval(fs.readFileSync(root+'/site/portal.js','utf8'));await settled(w,()=>!!$('[data-billing-view]'));$('[data-billing-view]').click();await settled(w,()=>!!$('#detail-content a[href$="/pdf"]'));assert.match($('#detail-content').textContent,/EST-000001/);
 }finally{dom.window.close();}
});

test('operations UI records service, creates a per-system plan with reminders off, and exposes customer controls',async()=>{
 const eqId=randomUUID(),accountId=randomUUID(),invoiceId=randomUUID(),calls=[];let role='admin',history=[],plans=[];
 const equipment={id:eqId,account_id:accountId,name:'Main furnace',type:'Furnace',manufacturer:'Fixture',model:'TEST',serial_number:'SN001',customer_name:'Alex Example',email:'alex@example.test',phone:'',line1:'100 Example St',city:'Old Bridge'};
 const dom=new JSDOM(fs.readFileSync(root+'/backend/accounts/views/dashboard.html','utf8'),{url:'https://fixture.example/account/admin#equipment-record?id='+eqId,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,$=s=>w.document.querySelector(s);
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.fetch=async(url,opts)=>{const route=new URL(url,'https://fixture.example').pathname.replace('/api/account/',''),body=opts.body?JSON.parse(opts.body):undefined;calls.push({route,body});let result={ok:true};
  if(route==='session')result={...result,account:{id:accountId,name:'Alex Example',email:'alex@example.test',role},csrfToken:'fixture'};
  else if(route==='admin/operations/equipment/'+eqId)result={...result,equipment,history};
  else if(route==='admin/operations/equipment/'+eqId+'/links')result={...result,requests:[],invoices:[{id:invoiceId,number:'INV-000001'}]};
  else if(route==='admin/operations/equipment/'+eqId+'/history'){history.push({...body,equipment_id:eqId,revision:1});result.id=body.id;}
  else if(route==='admin/operations/plans'&&body){plans.push({...body,revision:1,equipment_name:equipment.name,customer_name:equipment.customer_name,email:equipment.email});result.id=body.id;}
  else if(route==='admin/operations/plans')result={...result,plans,total:plans.length,page:1};
  else if(route==='service-history')result.history=history.map(({internal_notes,...h})=>({...h,equipment_name:equipment.name}));
  else if(route==='maintenance')result.plans=plans;
  else if(/^maintenance\/[^/]+\/reminders$/.test(route))plans[0].email_reminders=body.enabled;
  else throw Error('Unexpected UI fixture route '+route);
  return {status:200,ok:true,json:async()=>result};};
 w.eval(fs.readFileSync(root+'/site/maintenance.js','utf8'));w.eval(fs.readFileSync(root+'/site/operations.js','utf8'));w.eval(fs.readFileSync(root+'/site/billing.js','utf8'));w.eval(fs.readFileSync(root+'/site/portal.js','utf8'));
 try{
  await settled(w,()=>!!$('#add-service'));$('#add-service').click();await settled(w,()=>!!$('#history-form'));
  $('#service').value='Heating tune-up';$('#findings').value='Connections checked';$('#work_performed').value='Cleaned heating elements';$('#internal_notes').value='PRIVATE';$('#document_id').value=invoiceId;
  $('#history-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settled(w,()=>$('#content').textContent.includes('Connections checked'));
  const historyCall=calls.find(c=>c.route.endsWith('/history')&&c.body);assert.equal(historyCall.body.document_id,invoiceId);assert.equal(historyCall.body.internal_notes,'PRIVATE');assert.equal($('#detail-dialog').open,false);
  w.location.hash='plans?equipment='+eqId;await settled(w,()=>!!$('#plan-form'));assert.equal($('#email_reminders').checked,false);assert.equal($('#annual').value,'189.00');$('#next_service_on').value='2026-12-01';$('#plan-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settled(w,()=>$('#content').textContent.includes('$189.00'));
  const planCall=calls.find(c=>c.route==='admin/operations/plans'&&c.body);assert.equal(planCall.body.equipment_id,eqId);assert.equal(planCall.body.annual_cents,18900);assert.equal(planCall.body.email_reminders,false);
  // New customer portal session: internal notes are absent and reminder preference is editable.
  role='customer';w.location.hash='service-history';w.eval(fs.readFileSync(root+'/site/portal.js','utf8'));await settled(w,()=>$('#content').textContent.includes('Connections checked'));assert(!$('#content').textContent.includes('PRIVATE'));
  w.location.hash='maintenance';await settled(w,()=>!!$('[data-reminders]'));$('[data-reminders]').click();await settled(w,()=>$('[data-reminders]')?.textContent.includes('Turn off'));assert.equal(plans[0].email_reminders,true);
 }finally{w.close();}
});

test('pricebook UI reviews research and imports selected items',async()=>{
 const catalog=structuredClone(require('../backend/accounts/pricebook-catalog.json')),cap=catalog.items.find(x=>x.key==='cap-TRCFD455');catalog.items=catalog.items.filter(x=>[cap.id,'10900000-0000-4000-8000-000000000001'].includes(x.id));catalog.items.forEach(x=>x.existing=x.key==='heat-tune'?{unit_cents:10900,active:true}:null);let imported;
 const dom=new JSDOM(fs.readFileSync(root+'/backend/accounts/views/dashboard.html','utf8'),{url:'https://fixture.example/account/admin#pricebook',runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s);w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(url,opts)=>{const route=new URL(url,'https://fixture.example').pathname.replace('/api/account/','');let r={ok:true};if(route==='session')r={...r,account:{name:'Admin',email:'admin@example.test',role:'admin'},csrfToken:'fixture'};else if(route==='admin/billing/pricebook')r.items=[];else if(route==='admin/billing/pricebook-catalog')r.catalog=catalog;else if(route==='admin/billing/pricebook-catalog/import'){imported=JSON.parse(opts.body);r={...r,imported:1,skipped:0};}else throw Error(route);return {ok:true,status:200,json:async()=>r};};
 for(const file of ['operations.js','billing.js','portal.js'])w.eval(fs.readFileSync(root+'/site/'+file,'utf8'));await settled(w,()=>!!$('#import-catalog'));$('#import-catalog').click();await settled(w,()=>!!$('#catalog-form'));assert.match($('#detail-content').textContent,/cost × 2.75/);assert.match($('#detail-content').textContent,/\$34.65/);assert.match($('#detail-content').textContent,/\$12.60/);assert($('#catalog-form input[disabled]'));$('#catalog-parts-taxable').checked=true;$('#catalog-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settled(w,()=>!!imported);assert.deepEqual(imported,{ids:[cap.id],parts_taxable:true});await settled(w,()=>$('#notice').textContent.includes('1 pricebook items added'));dom.window.close();
});
