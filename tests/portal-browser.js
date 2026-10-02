'use strict';
// Browser fixtures are disposable examples, never bundled into production UI data.
const { chromium }=require('playwright');
const { createApp }=require('../backend/server');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const server=createApp({sendMail:async()=>{}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let role='customer';const id='11111111-1111-4111-8111-111111111111';const address={id,line1:'100 Example Street',label:'Home',city:'Old Bridge',region:'NJ',postal_code:'08857'};
  const request={id,account_id:id,address_id:id,service:'Seasonal tune-up',description:'Preparing the heating system for the season.',status:'requested',customer_update:'',created_at:'2026-09-30T12:00:00Z',line1:address.line1,city:address.city,name:'Alex Morgan',email:'alex@example.test',phone:'202-555-0100'};
  await page.route('**/api/account/**',async route=>{
   const url=new URL(route.request().url()),name=url.pathname.replace('/api/account/','');let data={ok:true};
   if(name==='session'||name==='login')data={...data,account:{id,role,name:role==='admin'?'Robert Machado':'Alex Morgan',email:'alex@example.test',phone:'202-555-0100'},csrfToken:'fixture'};
   if(name==='addresses')data.addresses=[address];if(name==='equipment')data.equipment=[];if(name==='requests')data.requests=[request];
   if(name==='admin/overview')data.totals={customers:1,contractors:0,unverified:0,requested:1,scheduled:0,followups:0,resolved:0,pending:0};
   if(name==='admin/accounts')data={...data,accounts:[{id,email:'alex@example.test',name:'Alex Morgan',phone:'202-555-0100',role:'customer',state:'active',verified_at:'2026-09-30',created_at:'2026-09-30'}],page:1,total:1};
   if(name==='admin/requests')data={...data,requests:[request],page:1,total:1};
   if(name.startsWith('admin/accounts/'))data={...data,account:{id,email:'alex@example.test',name:'Alex Morgan',phone:'202-555-0100',role:'customer',state:'active',verified_at:'2026-09-30',created_at:'2026-09-30'},addresses:[address],equipment:[],requests:[request]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.route(/\/account\/(dashboard|admin|contractor)(?:[?#].*)?$/,r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../backend/accounts/views/dashboard.html'),'utf8')}));
  const out=process.env.PORTAL_SCREENSHOTS||'/tmp/ccs-portal-previews';fs.mkdirSync(out,{recursive:true});
  for(const width of [375,1440]){
   await page.setViewportSize({width,height:1000});
   for(const kind of ['login','register','forgot','resend','verify','reset']){
    await page.goto(base+'/account/'+kind+(['verify','reset'].includes(kind)?'#token='+'a'.repeat(64):''));await page.locator('#auth-title').waitFor();
    assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'auth overflow '+kind);
    if(kind==='login'&&width===1440)await page.screenshot({path:out+'/login.png',fullPage:true});
   }
   await page.goto(base+'/account/register');await page.locator('#email').fill('new@example.test');await page.locator('#password').fill('This is a long passphrase');await page.locator('#confirm').fill('Different long passphrase');await page.locator('button[type=submit]').click();await page.getByText('Your passwords do not match.').waitFor();
   for(role of ['customer','admin','contractor']){
    await page.goto(base+'/account/'+(role==='customer'?'dashboard':role));await page.locator('#content[aria-busy=false]').waitFor();
    if(width===1440&&role!=='contractor')await page.screenshot({path:out+'/'+role+'-dashboard.png',fullPage:true});
    const views=role==='customer'?['overview','requests','addresses','equipment','request','profile']:role==='admin'?['overview','customers','contractors','queue','profile']:['overview','profile'];
    for(const view of views){await page.evaluate(v=>location.hash=v,view);await page.waitForTimeout(100);await page.locator('#content[aria-busy=false]').waitFor();assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'dashboard overflow '+role+' '+view);}
    if(role==='admin'){await page.evaluate(()=>location.hash='queue');await page.waitForTimeout(100);await page.locator('[data-request]').click();await page.locator('dialog[open]').waitFor();await page.locator('#customer_update').fill('Your visit is confirmed for tomorrow.');await page.locator('#review-form [type=submit]').click();await page.locator('dialog[open]').waitFor({state:'hidden'});}
   }
  }
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS: six auth screens, all role dashboards, mobile/desktop overflow, password mismatch, admin request review; screenshots saved.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
