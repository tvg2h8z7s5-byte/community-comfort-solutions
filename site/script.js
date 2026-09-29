const toggle=document.querySelector('.menu-toggle');
const mobile=document.querySelector('.mobile-nav');
if(toggle){
  toggle.addEventListener('click',()=>{
    const open=mobile.classList.toggle('open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.textContent=open?'✕':'☰';
  });
}

const CONTACT_EMAIL='contact@communitycomfortsolutions.org';
const PHONE_DISPLAY='917-608-3201';

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
    status.innerHTML=(msg||'We could not send this automatically.')+' <a href="'+mailtoFor()+'">Click here to email us instead</a>, or call <a href="tel:+19176083201">'+PHONE_DISPLAY+'</a>.';
  };

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=form.querySelector('button[type=submit]');
    btn.disabled=true;status.className='';status.textContent='Sending...';
    try{
      const r=await fetch(form.getAttribute('action'),{
        method:'POST',
        body:new URLSearchParams(new FormData(form)),
        headers:{Accept:'application/json'}
      });
      let j={};try{j=await r.json();}catch(_){}
      if(!r.ok||!j.ok){
        if(r.status===400&&j.error){status.className='err';status.textContent=j.error;btn.disabled=false;return;}
        throw new Error();
      }
      form.reset();status.className='ok';
      status.textContent='Thank you! We received your request and will get back to you soon. For urgent issues, call '+PHONE_DISPLAY+'.';
    }catch(err){
      fallback();
    }
    btn.disabled=false;
  });
}
