import {cents} from './payment_settings.js';
import {randomUUID} from 'node:crypto';

export async function initEvents(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_events(company_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,location TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>0),status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED','CANCELLED')),notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,id))`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_event_attendees(company_id TEXT NOT NULL,event_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,dni TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',code TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'REGISTERED' CHECK(state IN ('REGISTERED','CHECKED_IN','CANCELLED')),revision INTEGER NOT NULL DEFAULT 0,request_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),checked_in_at TIMESTAMPTZ,updated_by TEXT NOT NULL,PRIMARY KEY(company_id,event_id,id),FOREIGN KEY(company_id,event_id) REFERENCES panel_events(company_id,id),UNIQUE(company_id,event_id,request_id),UNIQUE(company_id,code))`);
 await db.query(`ALTER TABLE panel_events ADD COLUMN IF NOT EXISTS price_cents BIGINT NOT NULL DEFAULT 0`);
 await db.query(`ALTER TABLE panel_event_attendees ADD COLUMN IF NOT EXISTS amount_cents BIGINT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS payment_state TEXT NOT NULL DEFAULT 'FREE', ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'MANUAL', ADD COLUMN IF NOT EXISTS payment_note TEXT NOT NULL DEFAULT ''`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_payment_settings(company_id TEXT PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK(mode IN ('MANUAL','MP')),secrets TEXT,collector_id TEXT,live_mode BOOLEAN NOT NULL DEFAULT FALSE,revision INTEGER NOT NULL DEFAULT 0)`);
 await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS panel_event_active_dni ON panel_event_attendees(company_id,event_id,dni) WHERE state<>'CANCELLED'`);
}
const text=(v,max,label)=>{if(typeof v!=='string'||v.trim().length>max)throw Error('Revisá '+label+'.');return v.trim();};
const uuid=v=>{if(typeof v!=='string'||! /^[a-zA-Z0-9_-]{16,100}$/.test(v))throw Error('Identificador inválido. Recargá la pantalla.');return v;};
export function validateEvent(input){
 const name=text(input.name,160,'el nombre'),location=text(input.location,300,'el lugar'),notes=text(input.notes??'',2000,'las notas');
 if(!name||!location)throw Error('Completá nombre y lugar del evento.');
 // Explicit Argentina wall clock. Never use the host/browser timezone implicitly.
 const start=text(input.start,16,'la fecha y hora');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)||!Number.isFinite(Date.parse(start+'Z'))||new Date(start+'Z').toISOString().slice(0,16)!==start)throw Error('Fecha u hora inválida.');
 if(!Number.isInteger(input.capacity)||input.capacity<1||input.capacity>100000)throw Error('El cupo debe ser un entero entre 1 y 100000.');
 if(!['OPEN','CLOSED','CANCELLED'].includes(input.status))throw Error('Estado de evento inválido.');
 return {price_cents:cents(input.price??0),name,location,notes,starts_at:start+':00-03:00',capacity:input.capacity,status:input.status};
}
async function transaction(db,fn){const cx=await db.connect();try{await cx.query('BEGIN');const r=await fn(cx);await cx.query('COMMIT');return r;}catch(e){await cx.query('ROLLBACK');if(e.code==='23505')throw Error('Ese DNI o solicitud ya está registrado. Actualizá la lista.');throw e;}finally{cx.release();}}
async function lockEvent(cx,companyId,id){const r=(await cx.query('SELECT * FROM panel_events WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,id])).rows[0];if(!r)throw Error('Evento no encontrado en esta empresa.');return r;}
export async function listEvents(db,companyId){return (await db.query(`SELECT e.*,COUNT(a.id) FILTER(WHERE a.state<>'CANCELLED')::int AS registered,COUNT(a.id) FILTER(WHERE a.state='CHECKED_IN')::int AS checked_in FROM panel_events e LEFT JOIN panel_event_attendees a ON a.company_id=e.company_id AND a.event_id=e.id WHERE e.company_id=$1 GROUP BY e.company_id,e.id ORDER BY e.starts_at DESC,e.id`,[companyId])).rows;}
export async function saveEvent(db,companyId,input){
 const data=validateEvent(input),id=uuid(input.id);
 return transaction(db,async cx=>{
  // Serialize creation retries and edits by company; no catalog or legacy rows are touched.
  await cx.query('SELECT company_id FROM panel_companies WHERE company_id=$1 FOR UPDATE',[companyId]);
  const old=(await cx.query('SELECT * FROM panel_events WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,id])).rows[0];
  if(old){
   if(input.revision===null&&old.revision===0&&Object.entries(data).every(([k,v])=>k==='starts_at'?new Date(old[k]).getTime()===Date.parse(v):k==='price_cents'?Number(old[k])===v:old[k]===v))return old;
   if(!Number.isInteger(input.revision)||input.revision!==old.revision)throw Error('El evento cambió en otra sesión. Actualizá antes de guardar.');
   const count=Number((await cx.query("SELECT count(*) AS n FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND state<>'CANCELLED'",[companyId,id])).rows[0].n);
   if(data.capacity<count)throw Error('El cupo no puede ser menor a los '+count+' inscriptos vigentes.');
   return (await cx.query('UPDATE panel_events SET name=$3,starts_at=$4,location=$5,capacity=$6,status=$7,notes=$8,price_cents=$9,revision=revision+1 WHERE company_id=$1 AND id=$2 RETURNING *',[companyId,id,data.name,data.starts_at,data.location,data.capacity,data.status,data.notes,data.price_cents])).rows[0];
  }
  if(input.revision!==null)throw Error('Evento no encontrado. Actualizá la lista.');
  return (await cx.query('INSERT INTO panel_events(company_id,id,name,starts_at,location,capacity,status,notes,price_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[companyId,id,data.name,data.starts_at,data.location,data.capacity,data.status,data.notes,data.price_cents])).rows[0];
 });
}
export async function eventAttendees(db,companyId,eventId){
 const event=(await db.query('SELECT * FROM panel_events WHERE company_id=$1 AND id=$2',[companyId,eventId])).rows[0];if(!event)throw Error('Evento no encontrado en esta empresa.');
 const items=(await db.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 ORDER BY created_at,id',[companyId,eventId])).rows;
 return {event,items};
}
export async function registerAttendee(db,companyId,eventId,input,actor){
 const name=text(input.name,160,'el nombre'),contact=text(input.contact??'',100,'el contacto'),dni=text(input.dni,20,'el DNI').replace(/[.\s]/g,'');
 if(name.split(/\s+/).length<2||!/^\d{7,8}$/.test(dni))throw Error('Ingresá nombre y DNI de 7 u 8 dígitos.');
 const requestId=uuid(input.requestId);
 return transaction(db,async cx=>{
  const event=await lockEvent(cx,companyId,eventId);
  const old=(await cx.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND request_id=$3',[companyId,eventId,requestId])).rows[0];
  if(old){if(old.name!==name||old.dni!==dni||old.contact!==contact||old.state==='CANCELLED')throw Error('La solicitud ya corresponde a otra inscripción o fue cancelada.');return old;}
  if(event.status!=='OPEN')throw Error('El evento no está abierto para inscripciones.');
  if((await cx.query("SELECT 1 FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND dni=$3 AND state<>'CANCELLED'",[companyId,eventId,dni])).rows.length)throw Error('Ese DNI ya tiene una inscripción vigente en este evento.');
  const n=Number((await cx.query("SELECT count(*) AS n FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND state<>'CANCELLED'",[companyId,eventId])).rows[0].n);
  if(n>=event.capacity)throw Error('No quedan cupos disponibles.');
  const mode=(await cx.query('SELECT mode FROM panel_payment_settings WHERE company_id=$1',[companyId])).rows[0]?.mode||'MANUAL';
  return (await cx.query('INSERT INTO panel_event_attendees(company_id,event_id,id,name,dni,contact,code,request_id,updated_by,amount_cents,payment_state,payment_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[companyId,eventId,randomUUID(),name,dni,contact,'EV-'+randomUUID(),requestId,actor,event.price_cents,Number(event.price_cents)>0?'PENDING':'FREE',mode])).rows[0];
 });
}
export async function changeAttendee(db,companyId,eventId,input,actor){
 if(!['CHECKED_IN','CANCELLED'].includes(input.state))throw Error('Acción inválida.');
 return transaction(db,async cx=>{
  const event=await lockEvent(cx,companyId,eventId);
  const old=(await cx.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',[companyId,eventId,input.id])).rows[0];
  if(!old)throw Error('Inscripción no encontrada.');
  // A lost response can safely retry the identical completed transition.
  if(old.state===input.state&&Number.isInteger(input.revision)&&input.revision+1===old.revision)return old;
  if(input.revision!==old.revision)throw Error('La inscripción cambió. Actualizá antes de continuar.');
  if(old.state!=='REGISTERED')throw Error('La inscripción ya ingresó o fue cancelada.');
  if(input.state==='CHECKED_IN'&&!['FREE','APPROVED'].includes(old.payment_state))throw Error('El pago todavía no está confirmado.');
  if(input.state==='CHECKED_IN'&&event.status==='CANCELLED')throw Error('El evento está cancelado. No admite ingresos.');
  return (await cx.query("UPDATE panel_event_attendees SET state=$4,revision=revision+1,checked_in_at=CASE WHEN $4='CHECKED_IN' THEN NOW() ELSE NULL END,updated_by=$5 WHERE company_id=$1 AND event_id=$2 AND id=$3 RETURNING *",[companyId,eventId,input.id,input.state,actor])).rows[0];
 });
}
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function printEvent(company,event,items){
 const date=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'short',timeStyle:'short'}).format(new Date(event.starts_at));
 const labels={REGISTERED:'Inscripto',CHECKED_IN:'Ingresó',CANCELLED:'Cancelado'};
 return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Lista de asistentes</title><style>body{font:14px Arial;margin:28px;color:#17211b}table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ccc;text-align:left}small{color:#555}@media print{.hint{display:none}thead{display:table-header-group}tr{break-inside:avoid}}</style><h1>${escape(event.name)}</h1><p>${escape(company)} · ${escape(date)} (Argentina) · ${escape(event.location)}</p><p>Estado: ${escape({OPEN:'Abierto',CLOSED:'Inscripción cerrada',CANCELLED:'Cancelado'}[event.status])} · Cupo: ${event.capacity} · Inscriptos vigentes: ${items.filter(a=>a.state!=='CANCELLED').length} · Ingresaron: ${items.filter(a=>a.state==='CHECKED_IN').length}</p><p class="hint">Usá Imprimir del navegador (Ctrl+P) para imprimir o guardar como PDF.</p><table><thead><tr><th>Nombre</th><th>DNI</th><th>Contacto</th><th>Estado</th></tr></thead><tbody>${items.map(a=>`<tr><td>${escape(a.name)}</td><td>${escape(a.dni)}</td><td>${escape(a.contact)}</td><td>${escape(labels[a.state])}</td></tr>`).join('')}</tbody></table><p><small>Lista administrativa · ONE Eventos</small></p></html>`;
}

export async function confirmEventManual(db,companyId,eventId,input,actor){
 return transaction(db,async cx=>{
  await lockEvent(cx,companyId,eventId);
  const row=(await cx.query('SELECT * FROM panel_event_attendees WHERE company_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',[companyId,eventId,input.id])).rows[0];
  if(!row||row.state==='CANCELLED')throw Error('Inscripción no disponible.');
  if(row.payment_mode!=='MANUAL')throw Error('Esta inscripción espera confirmación de Mercado Pago.');
  if(row.payment_state==='APPROVED')return row;
  if(row.revision!==input.revision)throw Error('La inscripción cambió. Actualizá antes de confirmar.');
  const note=text(input.note||'',500,'la referencia de pago');if(!note)throw Error('Ingresá una referencia o detalle del pago que comprobaste.');
  return (await cx.query("UPDATE panel_event_attendees SET payment_state='APPROVED',payment_note=$4,updated_by=$5,revision=revision+1 WHERE company_id=$1 AND event_id=$2 AND id=$3 RETURNING *",[companyId,eventId,input.id,note,actor])).rows[0];
 });
}
