'use strict';
(() => {
 const kind=location.pathname.split('/').pop(), form=document.querySelector('#auth-form'), message=document.querySelector('#auth-message');
 const options={login:['Welcome back','Sign in to take care of your comfort.','Sign in'],register:['Make yourself at home','Create your customer account to get started.','Create account'],forgot:['Forgot your password?','We’ll email you a link to choose a new password.','Send reset link'],resend:['Verify your email','Request a fresh verification link.','Send verification link'],verify:['One more step','Confirm your email address to activate your account.','Verify my email'],reset:['A fresh start','Choose a new password for your account.','Save new password']};
 const config=options[kind]||options.login;
 document.querySelector('#auth-title').textContent=config[0];document.querySelector('#auth-intro').textContent=config[1];document.title=config[0]+' | Community Comfort Solutions';
 const rawToken=new URLSearchParams(location.hash.slice(1)).get('token');
 if(location.hash) history.replaceState(null,'',location.pathname);
 const passwordField=`<label for="password">${kind==='reset'?'New password':'Password'}</label><div class="password-wrap"><input id="password" name="password" type="password" required minlength="15" maxlength="128" autocomplete="${kind==='login'?'current-password':'new-password'}" aria-describedby="password-help"><button type="button" id="show-password" aria-label="Show password">Show</button></div><small id="password-help">Use 15–128 characters. A long, unique passphrase works well.</small>`;
 form.innerHTML=(['verify','reset'].includes(kind)?'':'<label for="email">Email address</label><input id="email" type="email" name="email" autocomplete="email" maxlength="254" required placeholder="you@example.com">')+(['login','register','reset'].includes(kind)?passwordField:'')+(['register','reset'].includes(kind)?'<label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autocomplete="new-password" required maxlength="128">':'')+`<button class="button primary full" type="submit">${config[2]} <span aria-hidden="true">→</span></button>`;
 document.querySelector('#auth-links').innerHTML=kind==='login'?'<a href="/account/forgot">Forgot password?</a><p>New here? <a href="/account/register">Create an account</a></p><a href="/account/resend">Resend verification email</a>':'<a href="/account/login">Back to sign in</a>';
 document.querySelector('#show-password')?.addEventListener('click',e=>{const p=document.querySelector('#password');p.type=p.type==='password'?'text':'password';e.target.textContent=p.type==='password'?'Show':'Hide';e.target.setAttribute('aria-label',p.type==='password'?'Show password':'Hide password');});
 function say(text,error=false){message.hidden=false;message.className='message '+(error?'error':'success');message.textContent=text;}
 if(['verify','reset'].includes(kind)&&!/^[a-f0-9]{64}$/.test(rawToken||'')){say('This link is missing or invalid. Request a new link below.',true);form.hidden=true;document.querySelector('#auth-links').innerHTML=`<a href="/account/${kind==='verify'?'resend':'forgot'}">Request a new link</a>`;}
 form.addEventListener('submit',async e=>{
  e.preventDefault();const values=Object.fromEntries(new FormData(form));if(values.confirm!==undefined&&values.confirm!==values.password){say('Your passwords do not match.',true);return;}delete values.confirm;
  if(['verify','reset'].includes(kind))values.token=rawToken;
  const routes={register:'register',login:'login',forgot:'forgot-password',resend:'resend-verification',verify:'verify-email',reset:'reset-password'};
  const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Please wait…';
  try{const response=await fetch('/api/account/'+routes[kind],{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(values)});const data=await response.json();if(!response.ok)throw Error(response.status===404?'Accounts are not enabled yet. Please call us for help.':data.error||'Please try again.');
   if(kind==='login'){location.assign('/account/'+(data.account.role==='admin'?'admin':data.account.role==='contractor'?'contractor':'dashboard'));return;}
   say(kind==='register'?'Check your inbox for a verification link. Verify your email before signing in.':kind==='verify'?'Email verified. You can now sign in.':kind==='reset'?'Your password is updated. Sign in with your new password.':'If your account is eligible, we’ll email you a link. Check your inbox and spam folder.');
   if(['register','verify','reset'].includes(kind))form.hidden=true;
  }catch(err){say(err instanceof SyntaxError?'The server is unavailable. Please try again shortly.':err.message||'Connection failed. Please try again.',true);}
  finally{button.disabled=false;button.textContent=config[2];}
 });
})();
