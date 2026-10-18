import express from 'express';
import {paymentSettings,savePaymentSettings,openSecrets} from './payment_settings.js';
import {createCheckout,reconcilePayment,verifyWebhook} from './payments.js';
import {ticketPage} from './tickets.js';
import {configuredModule} from './module_access.js';
export function paymentRouter(db,fetcher=fetch){
 const router=express.Router({mergeParams:true});
 const allowed=async req=>{if(req.session?.role==='SUPERADMIN')return true;if(req.session?.role!=='ADMIN_EMPRESA')return false;const r=(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session.uid])).rows[0];return !!r&&r.permissions?.editBusiness!==false;};
 router.get('/',async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,...await paymentSettings(db,req.params.companyId),canEdit:await allowed(req)});}catch{res.status(503).json({ok:false,error:'No se pudo leer la configuración de pagos.'});}});
 router.post('/',async(req,res)=>{try{if(!await allowed(req))return res.status(403).json({ok:false,error:'Solo el administrador autorizado puede configurar pagos.'});res.json({ok:true,...await savePaymentSettings(db,req.params.companyId,req.body||{},fetcher)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar la configuración.':e.message});}});
 router.post('/order/:orderId',async(req,res)=>{try{const company=(await db.query('SELECT service_state FROM panel_companies WHERE company_id=$1',[req.params.companyId])).rows[0];if(company?.service_state!=='ACTIVE')return res.status(403).json({ok:false,error:'Servicio pausado.'});if(req.session?.role!=='SUPERADMIN'){const r=(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session.uid])).rows[0];if(!r||r.permissions?.operate===false)return res.status(403).json({ok:false,error:'Sin permiso para cobrar.'});}res.json({ok:true,...await createCheckout(db,req.params.companyId,'ORDER',req.params.orderId)});}catch(e){res.status(400).json({ok:false,error:e.message});}});
 return router;
}
export function publicPaymentRoutes(app,db,getCompany,fetcher=fetch){
 app.get('/payment-return',(req,res)=>res.set('Cache-Control','no-store').type('html').send('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><h1>Gracias</h1><p>Estamos verificando el estado con Mercado Pago. Volvé al chat del comercio para consultar tu pedido o escribí MIS ENTRADAS para consultar tus entradas.</p></html>'));
 app.post('/payments/mercadopago/:companyId',async(req,res)=>{
  const company=req.params.companyId;let id;
  try{const row=(await db.query('SELECT secrets FROM panel_payment_settings WHERE company_id=$1',[company])).rows[0];if(!row?.secrets)return res.sendStatus(404);id=verifyWebhook(req.headers,req.query,req.body,openSecrets(company,row.secrets).webhookSecret);}catch{return res.status(401).json({ok:false,error:'Firma inválida.'});}
  try{await reconcilePayment(db,company,id,fetcher);return res.json({ok:true});}catch{return res.status(503).json({ok:false,error:'No se pudo conciliar el pago; reintentar.'});}
 });
 app.get('/tickets/:companyId/:code',async(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});try{const c=await getCompany(req.params.companyId);if(!configuredModule(c,'eventos'))return res.sendStatus(404);res.type('html').send(await ticketPage(db,req.params.companyId,req.params.code));}catch{res.status(404).type('text').send('Entrada no disponible.');}});
}
export async function flushPaymentNotifications(db,send){
 const cx=await db.connect();try{await cx.query('BEGIN');const rows=(await cx.query('SELECT n.*,c.phone_number_id FROM panel_payment_notifications n JOIN panel_companies c ON c.company_id=n.company_id LEFT JOIN panel_payment_intents p ON p.id=n.id WHERE (p.id IS NULL OR p.status=\'APPROVED\') AND n.sent=FALSE AND n.next_attempt<=NOW() AND n.attempts<12 AND c.service_state=\'ACTIVE\' ORDER BY n.next_attempt LIMIT 5 FOR UPDATE OF n SKIP LOCKED')).rows;
 for(const row of rows){try{
  const intent=(await cx.query('SELECT * FROM panel_payment_intents WHERE id=$1',[row.id])).rows[0];
  if(row.id.startsWith('manual:')){const valid=(await cx.query("SELECT 1 FROM panel_event_attendees a JOIN panel_events e ON e.company_id=a.company_id AND e.id=a.event_id WHERE a.company_id=$1 AND a.id=$2 AND a.state<>'CANCELLED' AND a.payment_state='APPROVED' AND e.status<>'CANCELLED'",[row.company_id,row.id.slice(7)])).rows.length;if(!valid){await cx.query('UPDATE panel_payment_notifications SET sent=TRUE WHERE id=$1',[row.id]);continue;}}
  if(intent?.kind==='EVENT'){const valid=(await cx.query("SELECT 1 FROM panel_event_attendees a JOIN panel_events e ON e.company_id=a.company_id AND e.id=a.event_id WHERE a.company_id=$1 AND a.id=$2 AND a.state<>'CANCELLED' AND a.payment_state='APPROVED' AND e.status<>'CANCELLED'",[row.company_id,intent.target_id])).rows.length;if(!valid){await cx.query('UPDATE panel_payment_notifications SET sent=TRUE WHERE id=$1',[row.id]);continue;}}
  if(intent?.kind==='ORDER'){const valid=(await cx.query("SELECT 1 FROM panel_orders WHERE company_id=$1 AND order_id=$2 AND order_state<>'CANCELADO' AND payment_state='CONFIRMADO'",[row.company_id,intent.target_id])).rows.length;if(!valid){await cx.query('UPDATE panel_payment_notifications SET sent=TRUE WHERE id=$1',[row.id]);continue;}}
  await send({companyId:row.company_id,phoneNumberId:row.phone_number_id,clientId:row.client_id,message:row.message,notificationId:row.id});await cx.query('UPDATE panel_payment_notifications SET sent=TRUE WHERE id=$1',[row.id]);}catch{await cx.query("UPDATE panel_payment_notifications SET attempts=attempts+1,next_attempt=NOW()+interval '5 minutes' WHERE id=$1",[row.id]);}}
 await cx.query('COMMIT');}catch{await cx.query('ROLLBACK');}finally{cx.release();}
}
