'use strict';
// Apply a targeted, idempotent content update to the current site at build time.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const site=path.join(root,'site');
const shield='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/></svg>';
const star='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2 3 6.1 6.7 1-4.8 4.7 1.1 6.6-6-3.1-6 3.1 1.1-6.6-4.8-4.7 6.7-1Z"/></svg>';
const flag='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 22V3m0 1c5-4 10 4 16 0v11c-6 4-11-4-16 0"/></svg>';
const footer=`<!-- credentials:footer:start -->
<div class="container credentials-footer" aria-label="Technician certifications and ownership">
 <div class="credentials-footer-item">${shield}<span><strong>NATE-certified</strong><small>Technicians</small></span></div>
 <div class="credentials-footer-item">${star}<span><strong>Panasonic Gold Star</strong><small>Certified technicians</small></span></div>
 <div class="credentials-footer-item">${flag}<span><strong>Military owned</strong><small>And operated</small></span></div>
</div>
<!-- credentials:footer:end -->`;
const about=`<!-- credentials:about:start -->
<section class="credentials-section" aria-labelledby="credentials-heading">
 <div class="container">
  <div class="credentials-heading"><p class="eyebrow">OUR PEOPLE &amp; OUR VALUES</p><h2 id="credentials-heading">Certified technicians. Military owned and operated.</h2><p>Community Comfort Solutions brings technical training and a commitment to dependable service to homes and businesses throughout Central New Jersey.</p></div>
  <div class="credentials-cards">
   <article class="credential-card"><div class="credential-icon">${shield}</div><h3>NATE-certified technicians</h3><p>Our technicians hold certification from North American Technician Excellence, an HVAC industry certification organization.</p></article>
   <article class="credential-card"><div class="credential-icon">${star}</div><h3>Panasonic Gold Star certified</h3><p>Our technicians hold Panasonic Gold Star certification, with manufacturer training in heat pump systems and preventive maintenance.</p></article>
   <article class="credential-card"><div class="credential-icon">${flag}</div><h3>Military owned and operated</h3><p>Our military background shapes how we work: with discipline, accountability, and respect for your home and your time.</p></article>
  </div>
 </div>
</section>
<!-- credentials:about:end -->`;
function updateFooter(html){
 html=html.replace(/<!-- credentials:footer:start -->[\s\S]*?<!-- credentials:footer:end -->\s*/g,'');
 if(!html.includes('<footer'))throw Error('Footer missing from page.');
 const closing=html.indexOf('</footer>');
 const copyright=html.lastIndexOf('<div class="container copyright"',closing);
 const insertion=copyright>=0?copyright:closing;
 return html.slice(0,insertion)+footer+'\n'+html.slice(insertion);
}
let count=0;
for(const file of fs.readdirSync(site).filter(f=>f.endsWith('.html'))){
 const p=path.join(site,file);let html=updateFooter(fs.readFileSync(p,'utf8'));
 html=html.replace(/href="\/styles\.css(?:\?[^"]*)?"/g,'href="/styles.css?v=credentials-1"');
 if(file==='about.html'){
  html=html.replace(/<!-- credentials:about:start -->[\s\S]*?<!-- credentials:about:end -->\s*/g,'');
  if(!html.includes('</main>'))throw Error('About page main section missing.');
  html=html.replace('</main>',about+'\n</main>');
 }
 fs.writeFileSync(p,html);count++;
}
const partial=path.join(root,'partials/footer.html');
if(fs.existsSync(partial))fs.writeFileSync(partial,updateFooter(fs.readFileSync(partial,'utf8')));
const cssPath=path.join(site,'styles.css');
let css=fs.readFileSync(cssPath,'utf8').replace(/\/\* credentials:styles:start \*\/[\s\S]*?\/\* credentials:styles:end \*\//g,'');
css=css.trimEnd();
css+=`
/* credentials:styles:start */
.credentials-footer{display:flex;flex-wrap:wrap;gap:16px 32px;margin-top:30px;padding-top:24px;border-top:1px solid #ffffff26}
.credentials-footer-item{display:flex;align-items:center;gap:12px;flex:1 1 220px;min-width:0}
.credentials-footer-item svg{width:34px;height:34px;flex:0 0 34px;fill:none;stroke:#91d8ff;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.credentials-footer-item strong{display:block;font-size:13px;line-height:1.4;color:#fff}
.credentials-footer-item small{display:block;font-size:12px;line-height:1.6;color:#c8d9e8}
.credentials-section{padding:64px 0;background:#eef7fd}
.credentials-heading{max-width:760px;margin-bottom:30px}
.credentials-heading h2{font-size:clamp(25px,3vw,36px);line-height:1.2;margin:0 0 16px;color:#10375f}
.credentials-heading>p:last-child{color:#47647b;line-height:1.7}
.credentials-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
.credential-card{background:#fff;border:1px solid #dce9f3;border-radius:14px;padding:26px;min-width:0}
.credential-icon{width:52px;height:52px;background:#eaf5fc;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.credential-icon svg{width:29px;height:29px;fill:none;stroke:#126eae;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.credential-card h3{font-size:19px;line-height:1.35;margin:0 0 12px;color:#10375f}
.credential-card p{font-size:14px;line-height:1.7;color:#47647b;margin:0;overflow-wrap:anywhere}
@media(max-width:800px){.credentials-cards{grid-template-columns:1fr}.credentials-section{padding:48px 0}.credentials-footer{gap:20px}.credentials-footer-item{flex-basis:100%}}
/* credentials:styles:end */
`;
fs.writeFileSync(cssPath,css);
console.log('Credentials added to '+count+' public page footers and the About page.');
