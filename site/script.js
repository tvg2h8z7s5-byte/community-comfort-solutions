const toggle=document.querySelector('.menu-toggle');
const mobile=document.querySelector('.mobile-nav');
if(toggle){
  toggle.addEventListener('click',()=>{
    const open=mobile.classList.toggle('open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.textContent=open?'✕':'☰';
  });
}

const form=document.getElementById('contact-form');
if(form){
  const status=document.getElementById('form-status');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=form.querySelector('button[type=submit]');
    btn.disabled=true;status.className='';status.textContent='Sending...';
    try{
      const r=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error();
      form.reset();status.className='ok';
      status.textContent="Thank you! We received your request and will call you back soon. For urgent issues, call 917-608-3201.";
    }catch(err){
      status.className='err';
      status.textContent='Sorry, something went wrong. Please call 917-608-3201 instead.';
    }
    btn.disabled=false;
  });
}
