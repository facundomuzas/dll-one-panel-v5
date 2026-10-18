import {publicBase} from './payment_settings.js';
import {createCheckout} from './payments.js';
import {ticketRecord,ticketPage} from './tickets.js';
import express from 'express';
import {listEvents,saveEvent,eventAttendees,registerAttendee,changeAttendee,printEvent,confirmEventManual} from './events.js';
// Mounted after authentication, company membership and configured-module guards.
export function eventsRouter(db){
 const router=express.Router({mergeParams:true});
 router.use(async(req,res,next)=>{try{
  res.set('Cache-Control','no-store');
  if(req.session?.role==='SUPERADMIN')req.eventPermissions={manage:true,operate:true};
  else{const row=(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];
   if(!row)return res.status(403).json({ok:false,error:'No tenés acceso a esta empresa.'});
   req.eventPermissions={manage:row.permissions?.editCatalog!==false,operate:row.permissions?.operate!==false};
  }return next();
 }catch{return res.status(503).json({ok:false,error:'No se pudieron verificar los permisos.'});}});
 const allow=key=>(req,res,next)=>req.eventPermissions[key]?next():res.status(403).json({ok:false,error:'No tenés permiso para esta acción en Eventos.'});
 const active=(req,res,next)=>req.moduleCompany?.service_state==='ACTIVE'?next():res.status(403).json({ok:false,error:'El servicio de esta empresa está pausado.'});
 const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo completar la operación. Actualizá y reintentá.':e.message});}};
 router.get('/',run(async(req,res)=>res.json({ok:true,permissions:req.eventPermissions,items:await listEvents(db,req.params.companyId)})));
 router.post('/',allow('manage'),active,run(async(req,res)=>res.json({ok:true,event:await saveEvent(db,req.params.companyId,req.body||{})})));

 router.get('/ticket/:code',run(async(req,res)=>res.json({ok:true,attendee:await ticketRecord(db,req.params.companyId,req.params.code)})));
 router.get('/ticket/:code/print',run(async(req,res)=>res.type('html').send(await ticketPage(db,req.params.companyId,req.params.code))));
 router.post('/:eventId/manual-payment',allow('operate'),active,run(async(req,res)=>{
 const attendee=await confirmEventManual(db,req.params.companyId,req.params.eventId,req.body||{},String(req.session.sub));let warning='';
 if(/^WA-\d+$/.test(attendee.contact))try{await db.query('INSERT INTO panel_payment_notifications(id,company_id,client_id,message) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',['manual:'+attendee.id,req.params.companyId,attendee.contact.replace('WA-','WA_'),'El organizador confirmó tu pago. Tu entrada: '+publicBase()+'/tickets/'+encodeURIComponent(req.params.companyId)+'/'+encodeURIComponent(attendee.code)]);}catch{warning='Pago guardado; no se pudo preparar el aviso. El cliente puede consultar MIS ENTRADAS.';}
 res.json({ok:true,attendee,warning});
 }));
 router.post('/:eventId/checkout',allow('operate'),active,run(async(req,res)=>res.json({ok:true,...await createCheckout(db,req.params.companyId,'EVENT',req.body?.id,req.params.eventId)})));
 router.get('/:eventId/attendees',run(async(req,res)=>res.json({ok:true,...await eventAttendees(db,req.params.companyId,req.params.eventId)})));
 router.post('/:eventId/attendees',allow('operate'),active,run(async(req,res)=>res.json({ok:true,attendee:await registerAttendee(db,req.params.companyId,req.params.eventId,req.body||{},String(req.session.sub))})));
 router.post('/:eventId/state',allow('operate'),active,run(async(req,res)=>res.json({ok:true,attendee:await changeAttendee(db,req.params.companyId,req.params.eventId,req.body||{},String(req.session.sub))})));
 router.get('/:eventId/print',run(async(req,res)=>{const {event,items}=await eventAttendees(db,req.params.companyId,req.params.eventId);res.type('html').send(printEvent(req.moduleCompany.company_name,event,items));}));
 return router;
}
