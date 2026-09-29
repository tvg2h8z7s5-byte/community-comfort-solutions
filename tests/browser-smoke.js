'use strict';
// Optional browser QA: supply Playwright through NODE_PATH or a local install.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createApp } = require('../backend/server');
(async () => {
  const localOrigins=[];
  const server=createApp({sendMail:async()=>{}},localOrigins).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && /Content Security Policy|Refused to/.test(m.text()))errors.push(m.text());});
    const base=`http://127.0.0.1:${server.address().port}`;
    localOrigins.push(base);
    const files=fs.readdirSync(require('node:path').join(__dirname,'../site')).filter(f=>f.endsWith('.html'));
    for(const width of [320,375,768,1024,1280,1440]) {
      console.log(`Checking ${width}px`);
      await page.setViewportSize({width,height:900});
      for(const file of files) {
        await page.goto(`${base}/${file}`);
        assert(await page.locator('.brand-logo').first().evaluate(img=>img.complete && img.naturalWidth>0),`${file}: logo`);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        assert(!overflow,`${file}: horizontal overflow at ${width}`);
      }
    }
    await page.setViewportSize({width:375,height:812});
    await page.goto(base+'/contact.html');
    await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
    await page.locator('.menu-toggle').click();await page.locator('.mobile-nav a[href="/services.html"]').click();assert(page.url().endsWith('/services.html'));
    for(const file of ['contact.html','schedule.html','do-not-share.html']) {
      console.log(`Checking form: ${file}`);
      await page.goto(base+'/'+file);
      await page.locator('#name').fill('Browser Test');
      if(file==='do-not-share.html') {await page.locator('#email').fill('test@example.com');await page.locator('#message').fill('Test request');}
      else {await page.locator('#phone').fill('1234567890');await page.locator('#town').fill('Old Bridge');}
      await page.locator('button[type="submit"]').click();
      await page.locator('#form-status.ok').waitFor({timeout:5000}).catch(async e=>{console.error(await page.locator('#form-status').textContent());console.error(await page.locator('form').evaluate(f=>[...f.elements].filter(e=>!e.validity.valid).map(e=>({name:e.name,message:e.validationMessage}))));throw e;});
    }
    await page.goto(base+'/contact.html');
    await page.route('**/api/contact',route=>route.fulfill({status:502,contentType:'application/json',body:'{"ok":false}'}));
    await page.locator('#name').fill('Test');await page.locator('#phone').fill('123');await page.locator('#town').fill('Old Bridge');
    await page.locator('button[type="submit"]').click();await page.locator('#form-status.err a[href^="mailto:"]').waitFor();
    assert.equal(await page.locator('button[type="submit"]').isDisabled(),false);
    await page.goto(base+'/cookies.html');await page.locator('#cookie-save').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('ccs-cookie-pref')),'essential');
    await page.goto(base+'/nested/missing');assert(await page.locator('.brand-logo').first().evaluate(img=>img.complete&&img.naturalWidth>0));
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`PASS: ${files.length} pages at six widths; logo, overflow, menu, three forms, fallback, cookie preference, CSP and nested 404`);
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
