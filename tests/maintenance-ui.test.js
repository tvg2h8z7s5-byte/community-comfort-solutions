'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{JSDOM}=require('../backend/node_modules/jsdom');
const root=path.join(__dirname,'..');async function settled(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI did not settle');}
test('maintenance work lists load packages, record visits, open queue jobs and prefill a renewal invoice',async()=>{
 const id='00000000-0000-4000-8000-000000000001',address='00000000-0000-4000-8000-000000000002',calls=[];
 const plan={id,equipment_id:id,account_id:id,address_id:address,name:'Essential',annual_cents:18900,status:'active',revision:1,next_service_on:'2026-10-01',renew_on:'2026-10-01',notes:'Electrical checks and health report',equipment_name:'Main furnace',type:'Furnace',customer_name:'Alex',email:'alex@example.test',phone:'917-555-0100',verified_at:'2026-10-01',line1:'10 Correct St',city:'Old Bridge',visit_id:id,visit_status:'scheduled',visit_appointment:'2026-10-03T12:00:00Z'};
 const pkg={id,name:'Filter Care annual plan — 1 system',unit_cents:21900,description:'Includes supplied filter',active:true,unit:'household/year',taxable:false};
 const dom=new JSDOM(fs.readFileSync(root+'/backend/accounts/views/dashboard.html','utf8'),{url:'https://test.example/account/admin#plans',runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s);
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.fetch=async(url,opts)=>{const route=new URL(url,'https://test.example').pathname.replace('/api/account/',''),body=opts.body?JSON.parse(opts.body):undefined;calls.push({route,body});let data={ok:true};
  if(route==='session')data={...data,account:{role:'admin',name:'Admin',email:'admin@example.test'},csrfToken:'test'};
  else if(route==='admin/operations/plans')data={...data,plans:[plan],summary:{service:0,scheduled:1,renewal:1,missing:0},page:1,total:1};
  else if(route==='admin/operations/plans/'+id+'/complete-visit'){plan.visit_id=null;plan.next_service_on=body.next_service_on;plan.revision++;data.email='sent';}
  else if(route==='admin/operations/plans/'+id+'/visit')data.id=id;
  else if(route==='admin/operations/plans/'+id)data.plan=plan;
  else if(route==='admin/operations/equipment/'+id+'/links')data={...data,requests:[],invoices:[]};
  else if(route==='admin/billing/pricebook')data.items=[pkg];
  else if(route==='admin/accounts/'+id)data={...data,account:{id,name:'Alex',email:'alex@example.test',phone:'917-555-0100'},addresses:[{id,name:'Wrong',line1:'99 Wrong St',city:'Old Bridge',region:'NJ',postal_code:'08857'},{id:address,line1:'10 Correct St',city:'Old Bridge',region:'NJ',postal_code:'08857'}],requests:[]};
  else if(route==='admin/requests')data={...data,requests:[],page:1,total:0};
  else if(route==='admin/requests/'+id)data.request={id,account_id:id,status:'requested',service:'Seasonal tune-up',name:'Alex',email:'alex@example.test',line1:plan.line1,city:plan.city,description:'Maintenance visit',created_at:'2026-10-02'};
  else throw Error('Unexpected route '+route);
  return {ok:true,status:200,json:async()=>data};
 };
 for(const f of ['maintenance','operations','billing','scheduling','inquiries','portal'])w.eval(fs.readFileSync(root+'/site/'+f+'.js','utf8'));
 try{
  await settled(()=>!!$('[data-complete]'));assert.match($('#content').textContent,/Maintenance workspace/);assert.equal($('#content a[href="#plans?view=scheduled"] strong').textContent,'1');assert($('#content a[href="tel:9175550100"]'));
  $('[data-edit-plan]').click();await settled(()=>!!$('#load-plan-packages'));$('#load-plan-packages').click();await settled(()=>!!$('#package-choice'));$('#package-choice').value=id;$('#package-choice').dispatchEvent(new w.Event('change'));assert.equal($('#annual').value,'219.00');assert.equal($('#notes').value,'Includes supplied filter');$('#detail-dialog').close();
  $('[data-complete]').click();await settled(()=>!!$('#complete-maintenance'));$('#serviced_on').value='2026-10-01';$('#next_service_on').value='2027-04-01';$('#work_performed').value='Checked electrical and cleaned elements';$('#complete-maintenance').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settled(()=>!$('#detail-dialog').open&&!!$('[data-visit]'));const saved=calls.find(c=>c.route.endsWith('/complete-visit'));assert.equal(saved.body.request_id,id);assert.equal(saved.body.revision,1);assert.equal(saved.body.next_service_on,'2027-04-01');
  $('[data-visit]').click();await settled(()=>!!$('#review-form'));assert(w.location.hash.includes('queue?request='));$('#detail-dialog').close();w.location.hash='plans';await settled(()=>!!$('#content a[href*="&plan="]'));$('#content a[href*="&plan="]').click();await settled(()=>!!$('#document-form'));assert.equal($('#customer-name').value,'Alex');assert.match($('#customer-address').value,/10 Correct St/);assert(!$('#customer-address').value.includes('Wrong'));assert.equal($('[data-line-price]').value,'189.00');assert.match($('[data-line-description]').value,/Essential.*Main furnace/);assert.equal($('#notes').value,plan.notes);assert(!calls.some(c=>c.route==='admin/billing/documents'&&c.body));
 }finally{w.close();}
});
