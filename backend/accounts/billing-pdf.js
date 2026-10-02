'use strict';
const PDFDocument=require('pdfkit');
const fs=require('node:fs');
const path=require('node:path');
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100);
function invoicePDF(d) {
 return new Promise((resolve,reject)=>{
  const pdf=new PDFDocument({size:'LETTER',margin:48,bufferPages:true,info:{Title:d.number+' | '+d.business.company,Author:d.business.company}}),chunks=[];
  pdf.on('data',c=>chunks.push(c));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);
  pdf.registerFont('CCS',path.join(__dirname,'fonts/DejaVuSans.ttf'));
  pdf.registerFont('CCS-Bold',path.join(__dirname,'fonts/DejaVuSans-Bold.ttf'));
  const navy='#123756',blue='#227cba',muted='#60788c';
  const date=v=>v?new Date(v instanceof Date?v.toISOString().slice(0,10)+'T12:00:00Z':String(v).slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'}):'Not set';
  let logo;try{const svg=fs.readFileSync(path.join(__dirname,'../../site/assets/logo-mark.svg'),'utf8');const match=svg.match(/data:image\/png;base64,([^"']+)/);if(match)logo=Buffer.from(match[1],'base64');}catch(_){}
  if(logo)pdf.image(logo,48,43,{fit:[46,46]});
  pdf.font('CCS-Bold').fontSize(16).fillColor(navy).text(d.business.company,logo?104:48,48,{width:300});
  pdf.font('CCS').fontSize(9).fillColor(muted).text([d.business.phone,d.business.email,d.business.website,d.business.address].filter(Boolean).join('\n'),logo?104:48,pdf.y+8,{width:300});
  const headerBottom=Math.max(140,pdf.y+22);
  pdf.font('CCS-Bold').fontSize(24).fillColor(navy).text(d.kind.toUpperCase(),390,48,{width:174,align:'right'});
  pdf.font('CCS').fontSize(10).text(d.number,390,80,{width:174,align:'right'});
  const state=d.status==='issued'&&d.kind==='invoice'?(d.balance_cents===0?'PAID':d.paid_cents?'PARTIALLY PAID':'ISSUED'):d.status.toUpperCase();
  pdf.font('CCS-Bold').fillColor(blue).text(state,390,99,{width:174,align:'right'});
  pdf.moveTo(48,headerBottom).lineTo(564,headerBottom).strokeColor('#cbdce8').stroke();
  let y=headerBottom+20;
  pdf.font('CCS-Bold').fontSize(9).fillColor(blue).text('PREPARED FOR',48,y);
  pdf.font('CCS').fontSize(11).fillColor(navy).text([d.customer.name,d.customer.address,d.customer.email,d.customer.phone].filter(Boolean).join('\n'),48,y+18,{width:300});const customerEnd=pdf.y;
  pdf.fontSize(10).text('Created: '+date(d.created_at),375,y,{width:189});
  if(d.issued_at)pdf.text('Issued: '+date(d.issued_at),375,pdf.y+5,{width:189});
  if(d.due_on)pdf.text((d.kind==='estimate'?'Valid through: ':'Due: ')+date(d.due_on),375,pdf.y+5,{width:189});
  if(d.technician)pdf.text('Technician: '+d.technician,375,pdf.y+5,{width:189});
  if(d.request_id)pdf.fontSize(8).text('Service request: '+d.request_id,375,pdf.y+5,{width:189});
  y=Math.max(customerEnd,pdf.y)+28;
  function nextPage(){pdf.addPage();y=48;}
  function tableHeader(){pdf.rect(48,y,516,28).fill(navy);pdf.fillColor('white').font('CCS-Bold').fontSize(9);pdf.text('DESCRIPTION',58,y+10,{width:265});pdf.text('QTY',328,y+10,{width:40,align:'right'});pdf.text('UNIT PRICE',380,y+10,{width:85,align:'right'});pdf.text('TOTAL',474,y+10,{width:80,align:'right'});y+=36;}
  if(y>580)nextPage();tableHeader();
  for(const item of d.items){pdf.font('CCS').fontSize(10);const label=item.description+(item.taxable?' (taxable)':'');const h=Math.max(42,pdf.heightOfString(label,{width:263})+18);if(y+h>700){nextPage();tableHeader();}
   pdf.font('CCS').fontSize(10).fillColor(navy).text(label,58,y+5,{width:263});pdf.text(String(item.quantity_milli/1000),328,y+5,{width:40,align:'right'});pdf.text(money(item.unit_cents),380,y+5,{width:85,align:'right'});pdf.text(money(item.line_cents),474,y+5,{width:80,align:'right'});
   y+=h;pdf.moveTo(48,y-5).lineTo(564,y-5).strokeColor('#e1eaf0').stroke();
  }
  if(y+160>700)nextPage();y+=14;
  function total(label,value,bold=false){pdf.font(bold?'CCS-Bold':'CCS').fontSize(bold?12:10).fillColor(navy).text(label,340,y,{width:125});pdf.text(money(value),470,y,{width:84,align:'right'});y+=23;}
  total('Subtotal',d.subtotal_cents);if(d.discount_cents)total('Discount',-d.discount_cents);total('Tax ('+(d.tax_bps/100)+'%)',d.tax_cents);total(d.kind==='invoice'?'Invoice total':'Estimate total',d.total_cents,true);
  if(d.kind==='invoice'){total('Payments recorded',d.paid_cents);total(d.status==='void'?'Voided balance':'Balance due',d.status==='void'?0:d.balance_cents,true);}
  function block(title,text){if(!text)return;pdf.font('CCS').fontSize(10);const lines=text.split('\n');y+=16;for(let i=0;i<lines.length;i++){const h=pdf.heightOfString(lines[i]||' ',{width:496})+5;if(y+h+30>700){nextPage();}if(i===0){pdf.font('CCS-Bold').fillColor(blue).text(title,48,y);y=pdf.y+9;}pdf.font('CCS').fillColor(navy).text(lines[i]||' ',48,y,{width:496});y=pdf.y+5;}}
  block('SERVICE NOTES',d.notes);block('TERMS',d.business.terms);
  if(d.kind==='estimate')block('ESTIMATE','This is an estimate, not a payment receipt.');
  if(d.status==='draft')block('DRAFT','Draft for review. This document has not been issued.');
  const pages=pdf.bufferedPageRange();for(let p=pages.start;p<pages.start+pages.count;p++){pdf.switchToPage(p);pdf.font('CCS').fontSize(8).fillColor(muted).text(d.number+' | '+d.business.company,48,725,{width:410,lineBreak:false});pdf.text((p+1)+' / '+pages.count,500,725,{width:64,align:'right',lineBreak:false});}
  pdf.end();
 });
}
module.exports={invoicePDF};
