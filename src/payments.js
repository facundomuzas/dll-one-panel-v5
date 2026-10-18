import {randomUUID} from 'node:crypto';
import {WebhookSignatureValidator} from 'mercadopago';
import {mpRequest,openSecrets,webhookUrl,cents,publicBase} from './payment_settings.js';

export async function createCheckout(db,company,kind,targetId,eventId='',fetcher=fetch){
 if(!['EVENT','ORDER'].includes(kind))throw Error('Tipo de cobro inválido.');
 const cx=await db.connect();try{await cx.query('BEGIN');
 const settings=(await cx.query('SELECT * FROM panel_payment_settings WHERE company_id=$1 FOR UPDATE',[company])).rows[0];
 if(settings?.mode!=='MP'){await cx.query('COMMIT');return {mode:'MANUAL'};}
 let amount,title;
 if(kind==='EVENT'){
  const event=(await cx.query('SELECT * FROM panel_events WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,eventId])).rows[0];
  const attendee=(await cx.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',[company,eventId,targetId])).rows[0];
  if(!event||!attendee||attendee.state==='CANCELLED'||event.status==='CANCELLED')throw Error('La inscripción no está disponible.');
  if(attendee.payment_mode!=='MP')throw Error('Esta inscripción se confirma manualmente.');
  if(['APPROVED','FREE'].includes(attendee.payment_state)){await cx.query('COMMIT');return {mode:'MP',paid:true};}
  if(attendee.payment_state==='REVOKED')throw Error('El pago fue revertido. Revisalo en Mercado Pago.');
  amount=Number(attendee.amount_cents);title='Entrada · '+event.name;
 }else{
  const order=(await cx.query('SELECT * FROM panel_orders WHERE company_id=$1 AND order_id=$2 FOR UPDATE',[company,targetId])).rows[0];
  if(!order||order.order_state==='CANCELADO')throw Error('Pedido no disponible.');
  if(order.payment_state==='CONFIRMADO'){await cx.query('COMMIT');return {mode:'MP',paid:true};}
  if(order.payment_method==='EFECTIVO'){await cx.query('COMMIT');return {mode:'MANUAL'};}
  amount=cents(order.total);title='Pedido '+order.order_id;
 }
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('El importe debe ser mayor a cero.');
 let intent=(await cx.query('SELECT * FROM panel_payment_intents WHERE company_id=$1 AND kind=$2 AND target_id=$3 FOR UPDATE',[company,kind,targetId])).rows[0];
 if(intent&&Number(intent.amount_cents)!==amount)throw Error('El importe cambió después de generar el enlace. Revisá el cobro anterior.');
 if(!intent){intent=(await cx.query('INSERT INTO panel_payment_intents(id,company_id,kind,event_id,target_id,amount_cents,collector_id,live_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),company,kind,eventId,targetId,amount,settings.collector_id,settings.live_mode])).rows[0];}
 if(intent.checkout_url){await cx.query('COMMIT');return {mode:'MP',url:intent.checkout_url,id:intent.id};}
 const secrets=openSecrets(company,settings.secrets);
 const pref=await mpRequest(secrets.accessToken,'/checkout/preferences',{method:'POST',requestId:intent.id,fetcher,body:{items:[{id:intent.id,title,quantity:1,currency_id:'ARS',unit_price:amount/100}],external_reference:intent.id,notification_url:webhookUrl(company),back_urls:{success:publicBase()+'/payment-return',pending:publicBase()+'/payment-return',failure:publicBase()+'/payment-return'}}});
 if(String(pref.collector_id)!==settings.collector_id)throw Error('La preferencia pertenece a otra cuenta.');
 const url=settings.live_mode?pref.init_point:pref.sandbox_init_point;
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)mercadopago\.com(\.ar)?$/.test(parsed.hostname))throw Error('Mercado Pago devolvió un enlace inválido.');
 await cx.query('UPDATE panel_payment_intents SET preference_id=$2,checkout_url=$3 WHERE id=$1',[intent.id,String(pref.id),url]);await cx.query('COMMIT');return {mode:'MP',url,id:intent.id};
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
export function verifyWebhook(headers,query,body,secret){
 const id=query['data.id'];if(typeof id!=='string'||!/^\d{1,30}$/.test(id)||String(body?.data?.id)!==id||body.type!=='payment'||typeof headers['x-request-id']!=='string')throw Error('Notificación inválida.');
 WebhookSignatureValidator.validate({xSignature:headers['x-signature'],xRequestId:headers['x-request-id'],dataId:id,secret});return id;
}
export async function reconcilePayment(db,company,paymentId,fetcher=fetch){
 const cx=await db.connect();try{await cx.query('BEGIN');
 // Fetch after this lock: parallel notifications cannot apply an older remote response last.
 const config=(await cx.query('SELECT * FROM panel_payment_settings WHERE company_id=$1 FOR UPDATE',[company])).rows[0];if(!config?.secrets)throw Error('Empresa sin conexión de pagos.');
 const p=await mpRequest(openSecrets(company,config.secrets).accessToken,'/v1/payments/'+encodeURIComponent(paymentId),{fetcher});
 const intent=(await cx.query('SELECT * FROM panel_payment_intents WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,String(p.external_reference||'')])).rows[0];
 if(!intent){await cx.query('COMMIT');return {ignored:true};}
 if(String(p.id)!==String(paymentId)||String(p.collector_id)!==intent.collector_id||p.currency_id!=='ARS'||cents(p.transaction_amount)!==Number(intent.amount_cents)||p.live_mode!==intent.live_mode)throw Error('El pago no coincide con la cuenta, importe, moneda o entorno esperado.');
 const approved=p.status==='approved'&&p.captured!==false&&cents(p.transaction_amount_refunded??0)===0;
 const revoked=['refunded','charged_back','cancelled'].includes(p.status)||cents(p.transaction_amount_refunded??0)>0;
 if(intent.payment_id&&intent.payment_id!==String(paymentId)){await cx.query('COMMIT');return {ignored:true,duplicatePayment:true};}
 const status=approved?'APPROVED':revoked?'REVOKED':'PENDING';
 let notice=null;
 if(intent.kind==='EVENT'){
  const event=(await cx.query('SELECT * FROM panel_events WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,intent.event_id])).rows[0];
  const attendee=(await cx.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',[company,intent.event_id,intent.target_id])).rows[0];
  if(!attendee)throw Error('Inscripción no encontrada.');
  await cx.query('UPDATE panel_event_attendees SET payment_state=$4,updated_by=$5,revision=revision+1 WHERE company_id=$1 AND event_id=$2 AND id=$3 AND payment_state<>$4',[company,intent.event_id,intent.target_id,status,'MERCADO_PAGO']);
  if(approved&&attendee.state!=='CANCELLED'&&event.status!=='CANCELLED'&&/^WA-\d+$/.test(attendee.contact))notice={client:attendee.contact.replace('WA-','WA_'),message:'Pago confirmado. Tu entrada para '+event.name+': '+publicBase()+'/tickets/'+encodeURIComponent(company)+'/'+encodeURIComponent(attendee.code)};
 }else{
  const order=(await cx.query('SELECT * FROM panel_orders WHERE company_id=$1 AND order_id=$2 FOR UPDATE',[company,intent.target_id])).rows[0];if(!order)throw Error('Pedido no encontrado.');
  if(approved&&order.order_state!=='CANCELADO'){
   await cx.query("UPDATE panel_orders SET payment_state='CONFIRMADO',order_state=CASE WHEN order_state='ESPERANDO_PAGO' THEN 'PENDIENTE_PREPARACION' ELSE order_state END,updated_at=NOW() WHERE company_id=$1 AND order_id=$2",[company,intent.target_id]);
   notice={client:order.client_id,message:'El pago de tu pedido '+order.order_id+' fue confirmado por Mercado Pago.'};
  }else if(revoked)await cx.query("UPDATE panel_orders SET payment_state='REVERTIDO_MP',updated_at=NOW() WHERE company_id=$1 AND order_id=$2",[company,intent.target_id]);
 }
 await cx.query('UPDATE panel_payment_intents SET status=$2,payment_id=CASE WHEN $2 IN (\'APPROVED\',\'REVOKED\') THEN $3 ELSE payment_id END,updated_at=NOW() WHERE id=$1',[intent.id,status,String(paymentId)]);
 if(notice)await cx.query('INSERT INTO panel_payment_notifications(id,company_id,client_id,message) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[intent.id,company,notice.client,notice.message]);
 await cx.query('COMMIT');return {status};
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
