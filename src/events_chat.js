import {createHash} from 'node:crypto';
import {listEvents,registerAttendee} from './events.js';
import {createCheckout} from './payments.js';
import {publicBase} from './payment_settings.js';
export async function eventsChat(db,company,input){
 const contact='WA-'+String(input.waId||'').replace(/\D/g,'');if(!/^WA-\d{7,20}$/.test(contact)||!input.messageId)throw Error('Faltan datos del mensaje.');
 const text=String(input.text||'').trim(),upper=text.toUpperCase();
 if(upper==='MIS ENTRADAS'){
  const rows=(await db.query("SELECT a.*,e.name AS event_name,e.status AS event_status FROM panel_event_attendees a JOIN panel_events e ON e.company_id=a.company_id AND e.id=a.event_id WHERE a.company_id=$1 AND a.contact=$2 AND a.state<>'CANCELLED' ORDER BY a.created_at DESC LIMIT 10",[company,contact])).rows;
  if(!rows.length)return 'Todavía no tenés entradas. Escribí EVENTOS para ver las opciones.';
  return rows.map(a=>a.event_status==='CANCELLED'?a.event_name+': evento cancelado.':a.payment_state==='REVOKED'?a.event_name+': pago revertido, consultá al organizador.':['APPROVED','FREE'].includes(a.payment_state)?a.event_name+': '+publicBase()+'/tickets/'+encodeURIComponent(company)+'/'+encodeURIComponent(a.code):a.event_name+': pago pendiente de confirmación.').join('\n\n');
 }
 const pay=text.match(/^PAGAR\s+([a-zA-Z0-9-]+)$/i);
 if(pay){const rows=(await db.query("SELECT a.* FROM panel_event_attendees a WHERE a.company_id=$1 AND a.contact=$2 AND a.state<>'CANCELLED' ORDER BY a.created_at DESC",[company,contact])).rows.filter(a=>a.event_id.startsWith(pay[1]));if(rows.length!==1)throw Error('No encontré una inscripción única para ese código.');const a=rows[0];if(['FREE','APPROVED'].includes(a.payment_state))return 'Tu entrada: '+publicBase()+'/tickets/'+encodeURIComponent(company)+'/'+encodeURIComponent(a.code);if(a.payment_mode!=='MP')return 'El organizador comprueba este pago manualmente.';const checkout=await createCheckout(db,company,'EVENT',a.id,a.event_id);return checkout.url?'Pagá tu entrada aquí: '+checkout.url:'La conexión de cobro está desactivada. Consultá al organizador.';}
 const match=text.match(/^ENTRADA\s+([a-zA-Z0-9-]+)\s*\|\s*([^|]+)\s*\|\s*([\d.\s]+)$/i);
 if(match){
  const events=await listEvents(db,company),matches=events.filter(e=>e.id.startsWith(match[1]));if(matches.length!==1)throw Error('No encontré ese evento. Escribí EVENTOS para ver sus códigos.');
  const event=matches[0],name=match[2].trim();if(name.split(/\s+/).length<2)throw Error('Ingresá nombre y apellido completos.');
  const a=await registerAttendee(db,company,event.id,{name,dni:match[3].trim(),contact,requestId:createHash('sha256').update(String(input.messageId)).digest('hex')},'BOT');
  if(['FREE','APPROVED'].includes(a.payment_state))return 'Inscripción confirmada para '+event.name+'. Tu entrada: '+publicBase()+'/tickets/'+encodeURIComponent(company)+'/'+encodeURIComponent(a.code);
  if(a.payment_mode==='MP'){
   try{const checkout=await createCheckout(db,company,'EVENT',a.id,event.id);if(checkout.url)return 'Tu cupo para '+event.name+' quedó reservado. Pagá aquí: '+checkout.url+'\nEl QR se habilita al confirmar Mercado Pago. Después podés escribir MIS ENTRADAS.';}catch{}
   return 'Tu inscripción quedó guardada, pero no pudimos obtener el enlace de pago. Escribí PAGAR '+event.id.slice(0,8)+' para reintentar el enlace, o pedí ayuda al organizador. No vuelvas a inscribirte.';
  }
  return 'Tu inscripción para '+event.name+' quedó pendiente de pago ($'+(Number(a.amount_cents)/100).toLocaleString('es-AR')+'). El organizador comprobará el pago manualmente. Cuando esté confirmado, escribí MIS ENTRADAS para obtener tu QR.';
 }
 const events=(await listEvents(db,company)).filter(e=>e.status==='OPEN'&&e.registered<e.capacity).slice(0,10);
 if(!events.length)return 'No hay eventos con inscripción abierta y cupos disponibles.';
 return 'Eventos disponibles:\n'+events.map(e=>e.name+' · '+new Date(e.starts_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})+' · '+(Number(e.price_cents)?'$'+Number(e.price_cents)/100:'Gratis')+' · código '+e.id.slice(0,8)).join('\n')+'\n\nPara inscribirte enviá todo en un mensaje:\nENTRADA código | Nombre y apellido completos | DNI\n\nPara consultar tus entradas: MIS ENTRADAS.';
}
