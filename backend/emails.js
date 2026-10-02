'use strict';
const SITE = 'https://communitycomfortsolutions.org';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function layout(title, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#edf5fa;color:#20364a;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dbe7ef;border-radius:12px"><tr><td style="padding:26px 28px;background:#133754;color:#ffffff;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">Community Comfort Solutions<div style="margin-top:8px;font-size:13px;font-weight:normal;color:#d2eafa">Heating &amp; cooling care in Central New Jersey</div></td></tr><tr><td style="padding:28px;font-size:16px;line-height:1.65"><h1 style="margin:0 0 18px;font-size:26px;line-height:1.3;color:#133754">${escape(title)}</h1>${content}</td></tr><tr><td style="padding:20px 28px;background:#f3f8fb;font-size:13px;line-height:1.7;border-radius:0 0 12px 12px">Questions? Reply to this email or call <a href="tel:+19176083201" style="color:#17649b">917-608-3201</a>.<br><a href="${SITE}" style="color:#17649b">communitycomfortsolutions.org</a></td></tr></table></td></tr></table></body></html>`;
}
function button(label, url) {
  return `<p style="margin:26px 0"><a href="${escape(url)}" style="display:inline-block;background:#17649b;color:#ffffff;padding:14px 24px;border-radius:6px;font-size:16px;font-weight:bold;text-decoration:none">${escape(label)}</a></p>`;
}
function details(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #dbe7ef;font-size:14px;line-height:1.6">${rows.filter(([,v])=>v).map(([label,value])=>`<tr><th scope="row" align="left" style="padding:10px 12px 10px 0;vertical-align:top;width:36%;color:#496277;border-bottom:1px solid #dbe7ef">${escape(label)}</th><td style="padding:10px 0;white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #dbe7ef">${escape(value)}</td></tr>`).join('')}</table>`;
}
function accountEmail(purpose, url) {
  const verify = purpose === 'verify';
  const title = verify ? 'Welcome! Verify your email.' : 'Reset your password';
  const introduction = verify
    ? 'Thanks for creating your Community Comfort Solutions account. Verify your email address to finish setting up your customer portal.'
    : 'We received a request to reset your Community Comfort Solutions password. Use the secure link below to choose a new password.';
  const next = verify
    ? 'Once verified, you can sign in to save service addresses, add your heating and cooling equipment, submit service requests, and track updates from our team.'
    : 'After resetting your password, sign in again with your new password. For your security, existing sign-in sessions will end.';
  const expiry = verify ? 'This verification link expires in 24 hours.' : 'This password reset link expires in 30 minutes.';
  const label = verify ? 'Verify email address' : 'Reset password';
  const ignore = verify ? 'If you did not create this account, you can ignore this email.' : 'If you did not request a password reset, ignore this email. Your password will remain unchanged.';
  return {subject: verify ? 'Verify your Community Comfort Solutions account' : 'Reset your Community Comfort Solutions password',
    text: `${title}\n\n${introduction}\n\n${label}: ${url}\n\n${expiry}\n\n${next}\n\n${ignore}\n\nQuestions? Reply to this email or call 917-608-3201.`,
    html: layout(title, `<p>${introduction}</p>${button(label,url)}<p><strong>${expiry}</strong></p><p>${next}</p><p style="font-size:13px;color:#496277">If the button does not work, copy this entire link into your browser:<br><a href="${escape(url)}" style="color:#17649b;word-break:break-all">${escape(url)}</a></p><p style="font-size:13px;color:#496277">${ignore}</p>`) };
}
function receiptEmail({name, kind = 'contact', rows = [], portalUrl}) {
  const service = kind === 'service';
  const title = service ? 'Your service request is received' : kind === 'privacy' ? 'Your privacy request is received' : 'Your message is received';
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const introduction = `Thank you for contacting Community Comfort Solutions. We have received your ${service ? 'service request' : kind === 'privacy' ? 'privacy request' : 'message'}. You can expect a response from our team within 24 hours.`;
  const next = service
    ? 'We will review the details and contact you to discuss your system, availability, and next steps. Your preferred date and time are requests; your appointment is confirmed only after we arrange it with you.'
    : kind === 'privacy' ? 'Our team will review your request and contact you about any information needed to process it.' : 'Our team will review your message and follow up by email or phone using the contact information you provided.';
  const summary = rows.filter(([,v])=>v).map(([label,value])=>`${label}: ${value}`).join('\n');
  return {subject: service ? 'We received your service request | Community Comfort Solutions' : kind === 'privacy' ? 'We received your privacy request | Community Comfort Solutions' : 'We received your message | Community Comfort Solutions',
    text: `${greeting}\n\n${introduction}\n\n${next}${summary ? '\n\nYour request details\n'+summary : ''}${portalUrl ? '\n\nView your request: '+portalUrl : ''}\n\nIf you have more details, reply to this email. For urgent service needs, call 917-608-3201 to discuss availability.\n\nThank you,\nCommunity Comfort Solutions\n${SITE}`,
    html: layout(title, `<p>${escape(greeting)}</p><p>${introduction}</p><p>${next}</p>${summary ? `<h2 style="font-size:18px;color:#133754;margin-top:26px">Your request details</h2>${details(rows)}` : ''}${portalUrl ? button('View your requests',portalUrl) : ''}<p>If you have more details, reply to this email. For urgent service needs, call <a href="tel:+19176083201" style="color:#17649b">917-608-3201</a> to discuss availability.</p><p>Thank you,<br><strong>Community Comfort Solutions</strong></p>`) };
}
function serviceUpdateEmail({name, service, status, customer_update, appointment_at, id, portalUrl}) {
 const appointment = appointment_at ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'short'}).format(new Date(appointment_at))+' (Eastern time)' : 'Not confirmed';
 const rows=[['Request reference',id],['Service',service],['Status',status],['Confirmed appointment',appointment],['Team response',customer_update]];
 const title='An update on your service request';
 return {subject:title+' — Community Comfort Solutions',
  text:`Hi ${name||'there'},\n\nOur team updated your service request.\n\n${rows.filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n')}\n\nView your requests: ${portalUrl}\n\nReply to this email or call 917-608-3201 with questions.`,
  html:layout(title,`<p>Hi ${escape(name||'there')},</p><p>Our team updated your service request.</p>${details(rows)}${button('View your requests',portalUrl)}`)};
}
module.exports = {layout, details, accountEmail, receiptEmail, serviceUpdateEmail};
