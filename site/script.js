const toggle=document.querySelector('.menu-toggle');
const mobile=document.querySelector('.mobile-nav');
if(toggle && mobile){
  const setOpen=open=>{
    mobile.classList.toggle('open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Close menu':'Open menu');
    toggle.textContent=open?'✕':'☰';
  };
  toggle.addEventListener('click',()=>setOpen(!mobile.classList.contains('open')));
  mobile.addEventListener('click',e=>{if(e.target.closest('a'))setOpen(false);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && mobile.classList.contains('open')){setOpen(false);toggle.focus();}
  });
  window.matchMedia('(min-width:1191px)').addEventListener('change',e=>{if(e.matches)setOpen(false);});
}

const CONTACT_EMAIL='contact@communitycomfortsolutions.org';
const PHONE_DISPLAY='917-608-3201';

// Read the shared HttpOnly session on every public page, including browser Back.
// Account state is never saved into cached HTML or localStorage.
(() => {
  const links = [...document.querySelectorAll('[data-account-link]')];
  if (!links.length) return;
  let checking = false;
  async function refreshAccount() {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch('/api/account/session', {credentials:'same-origin', cache:'no-store'});
      if (response.ok) {
        const data = await response.json();
        if (data.account) {
          const target = data.account.role === 'admin' ? 'admin' : data.account.role === 'contractor' ? 'contractor' : 'dashboard';
          for (const link of links) {link.textContent='My Account';link.href='/account/'+target;}
        }
      } else if ([401,403,404].includes(response.status)) {
        for (const link of links) {link.textContent='Log in / Register';link.href='/account/login';}
      }
    } catch (_) { /* Keep the navigation usable during a connection failure. */ }
    finally {checking=false;}
  }
  refreshAccount();
  window.addEventListener('pageshow', refreshAccount);
  window.addEventListener('focus', refreshAccount);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccount();});
})();

const form=document.getElementById('contact-form');
if(form){
  const status=document.getElementById('form-status');

  // Fallback: opens the visitor's own email app with the message filled in
  const mailtoFor=()=>{
    const data=new FormData(form);
    const subject=(data.get('_subject')||'Message from website').toString();
    const lines=[];
    data.forEach((v,k)=>{ if(k[0]!=='_' && String(v).trim()) lines.push(k.replace(/_/g,' ')+': '+v); });
    return 'mailto:'+CONTACT_EMAIL+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(lines.join('\n'));
  };
  const fallback=(msg)=>{
    status.className='err';
    const emailLink=document.createElement('a');
    emailLink.href=mailtoFor();emailLink.textContent='Click here to email us instead';
    const phoneLink=document.createElement('a');
    phoneLink.href='tel:+19176083201';phoneLink.textContent=PHONE_DISPLAY;
    status.replaceChildren(msg||'We could not send this automatically.',' ',emailLink,', or call ',phoneLink,'.');
  };

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!form.reportValidity())return;
    const btn=form.querySelector('button[type=submit]');
    btn.disabled=true;status.className='';status.textContent='Sending...';
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const r=await fetch(form.getAttribute('action'),{
        method:'POST',
        signal:controller.signal,
        body:new URLSearchParams(new FormData(form)),
        headers:{Accept:'application/json'}
      });
      let j={};try{j=await r.json();}catch(_){}
      if(!r.ok||!j.ok){
        if((r.status===400||r.status===413||r.status===429)&&j.error){status.className='err';status.textContent=j.error;btn.disabled=false;return;}
        throw new Error();
      }
      form.reset();status.className='ok';
      status.textContent='Thank you! We received your request and will get back to you soon. For urgent issues, call '+PHONE_DISPLAY+'.';
    }catch(err){
      fallback();
    }finally{
      clearTimeout(timeout);
      btn.disabled=false;
    }
  });
}
