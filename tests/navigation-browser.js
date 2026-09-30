'use strict';
const {chromium}=require('playwright');
const {createApp}=require('../backend/server');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const server=createApp({sendMail:async()=>{}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;let role=null;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/account/session',r=>r.fulfill({status:role?200:401,contentType:'application/json',body:JSON.stringify(role?{ok:true,account:{role}}:{ok:false})}));
  for(const width of [375,768,1024,1440]){
   await page.setViewportSize({width,height:1000});role=null;await page.goto(base+'/');
   assert.equal(await page.locator('[data-account-link]').first().innerText(),'Log in / Register');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow at '+width);
   const bounds=await page.locator('.hero-photo').boundingBox(),header=await page.locator('.site-header').boundingBox();assert(bounds.y>=header.y+header.height+20,'hero must have space below header');
   assert(await page.locator('.hero-photo').evaluate(e=>e.complete&&e.naturalWidth>0));
   role='customer';await page.goto(base+'/services.html');await page.waitForFunction(()=>document.querySelector('[data-account-link]').textContent==='My Account');
   assert.equal(await page.locator('[data-account-link]').first().getAttribute('href'),'/account/dashboard');
   assert.equal(await page.locator('.photo-placeholder').count(),0);
   for(const image of await page.locator('.site-photo').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(e=>e.decode());assert(await image.evaluate(e=>e.naturalWidth>0));}
   role='admin';await page.goto(base+'/');await page.waitForFunction(()=>document.querySelector('[data-account-link]').getAttribute('href')==='/account/admin');
   role=null;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-account-link]').textContent==='Log in / Register');
  }
  const out=process.env.PHOTO_SCREENSHOTS||'/tmp/ccs-photo-previews';fs.mkdirSync(out,{recursive:true});
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await page.goto(base+'/');for(const image of await page.locator('img').all()){await image.evaluate(e=>{e.loading="eager";return e.decode();});}await page.screenshot({path:out+'/home-'+width+'.png',fullPage:true});}
  assert.deepEqual(errors,[]);console.log('PASS: guest/customer/admin navigation, sign-out refresh, images, hero spacing and mobile overflow');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
