import {randomUUID,createHash} from 'node:crypto';
export function normalizeDni(value){const dni=String(value??'').trim().replace(/[.\s]/g,'');if(!/^[0-9]{7,8}$/.test(dni))throw Error('Ingresá un DNI ficticio de 7 u 8 dígitos, sin letras.');return dni;}
export const isHealth=c=>c?.modules?.salud===true;
const clean=(v,n=100)=>String(v??'').trim().slice(0,n);
export function localToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
const minutes=t=>{if(!/^\d{2}:\d{2}$/.test(t))throw Error('Horario inválido.');const [h,m]=t.split(':').map(Number);if(h>23||m>59)throw Error('Horario inválido.');return h*60+m;};
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
function validDate(date,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Fecha inválida.');
 if(date<localToday(now)||Date.parse(date+'T12:00:00Z')>now.getTime()+91*86400000)throw Error('Elegí una fecha entre hoy y los próximos 90 días.');
}
export function validateDoctor(input){
 const d={name:clean(input.name),specialty:clean(input.specialty),room:clean(input.room),mode:input.mode,days:input.days,start:input.start,end:input.end,minutes:Number(input.minutes),capacity:Number(input.capacity),active:input.active===true,blockedDates:input.blockedDates||[]};
 if(!d.name||!d.specialty)throw Error('Completá nombre y especialidad.');
 if(!['FIXED','QUEUE'].includes(d.mode)||!Array.isArray(d.days)||!d.days.length||d.days.some(x=>!Number.isInteger(x)||x<0||x>6))throw Error('Revisá modalidad y días.');
 d.days=[...new Set(d.days)].sort();if(minutes(d.end)<=minutes(d.start))throw Error('La hora final debe ser posterior al inicio.');
 if(!Number.isInteger(d.minutes)||d.minutes<5||d.minutes>120||!Number.isInteger(d.capacity)||d.capacity<1||d.capacity>100)throw Error('Duración: 5 a 120 minutos. Cupo: 1 a 100.');
 if(!Array.isArray(d.blockedDates)||d.blockedDates.length>90||d.blockedDates.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x+'T12:00:00Z'))||new Date(x+'T12:00:00Z').toISOString().slice(0,10)!==x))throw Error('Fechas bloqueadas inválidas.');
 if(d.mode==='FIXED'&&minutes(d.start)+d.minutes>minutes(d.end))throw Error('El turno no cabe en el horario de atención.');return d;
}
export async function initHealthDemo(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_health_doctors(company_id TEXT NOT NULL,id TEXT NOT NULL,data JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(company_id,id))`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_health_appointments(company_id TEXT NOT NULL,id TEXT NOT NULL,doctor_id TEXT NOT NULL,day TEXT NOT NULL,slot TEXT NOT NULL,patient TEXT NOT NULL,contact TEXT NOT NULL,mode TEXT NOT NULL,doctor_name TEXT NOT NULL,specialty TEXT NOT NULL,room TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'BOOKED',request_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,id),UNIQUE(company_id,request_id))`);
 await db.query(`ALTER TABLE panel_health_appointments ADD COLUMN IF NOT EXISTS dni TEXT`);
 await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS panel_health_dni_unique ON panel_health_appointments(company_id,doctor_id,day,dni) WHERE state<>'CANCELLED' AND dni IS NOT NULL`);
 await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS panel_health_slot_unique ON panel_health_appointments(company_id,doctor_id,day,slot) WHERE state<>'CANCELLED'`);
 await db.query(`DROP INDEX IF EXISTS panel_health_patient_unique`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_health_chats(company_id TEXT NOT NULL,contact TEXT NOT NULL,state JSONB NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,contact))`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_health_chat_events(company_id TEXT NOT NULL,contact TEXT NOT NULL,message_id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(company_id,contact,message_id))`);
}
export async function doctors(db,id){return (await db.query('SELECT id,data,revision FROM panel_health_doctors WHERE company_id=$1 ORDER BY id',[id])).rows.map(r=>({...r.data,id:r.id,revision:r.revision}));}
export async function seedHealthDemo(db,id){
 const samples=[{id:'DEMO-1',name:'Dra. Ana Demo',specialty:'Clínica médica',room:'Consultorio 1',mode:'FIXED',minutes:20,capacity:12},{id:'DEMO-2',name:'Dr. Martín Ejemplo',specialty:'Traumatología',room:'Consultorio 2',mode:'QUEUE',minutes:20,capacity:8}];
 for(const d of samples)await db.query('INSERT INTO panel_health_doctors(company_id,id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,d.id,JSON.stringify({...d,days:[1,2,3,4,5],start:'08:00',end:'12:00',active:true,blockedDates:[]})]);
}
export async function saveDoctor(db,id,input){
 const data=validateDoctor(input),doctorId=clean(input.id)||randomUUID(),cx=await db.connect();try{
 await cx.query('BEGIN');
 const old=(await cx.query('SELECT * FROM panel_health_doctors WHERE company_id=$1 AND id=$2 FOR UPDATE',[id,doctorId])).rows[0];
 if(input.id&&!old)throw Error('Especialista no encontrado.');
 if(old&&input.revision!==old.revision)throw Error('El especialista cambió. Volvé a seleccionarlo.');
 if(old&&['days','start','end','minutes','capacity','mode','active','blockedDates'].some(k=>JSON.stringify(old.data[k])!==JSON.stringify(data[k]))){
  const booked=(await cx.query("SELECT 1 FROM panel_health_appointments WHERE company_id=$1 AND doctor_id=$2 AND day>=$3 AND state<>'CANCELLED' LIMIT 1",[id,doctorId,localToday()])).rows.length;
  if(booked)throw Error('Hay turnos vigentes: cancelalos o trasladalos antes de cambiar la disponibilidad.');
 }
 await cx.query('INSERT INTO panel_health_doctors(company_id,id,data) VALUES($1,$2,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data,revision=panel_health_doctors.revision+1',[id,doctorId,JSON.stringify(data)]);await cx.query('COMMIT');return doctorId;
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
export function availableSlots(d,date,taken=[],now=new Date()){
 validDate(date,now);
 if(!d.active||!d.days.includes(new Date(date+'T12:00:00Z').getUTCDay())||d.blockedDates.includes(date))return [];
 const occupied=new Set(taken.map(x=>x.slot));
 if(d.mode==='QUEUE'){
  if(new Date(date+'T'+d.end+':00-03:00')<=now)return [];
  return Array.from({length:d.capacity},(_,i)=>String(i+1)).filter(x=>!occupied.has(x));
 }
 const slots=[];for(let n=minutes(d.start);n+d.minutes<=minutes(d.end);n+=d.minutes){const t=clock(n);if(!occupied.has(t)&&new Date(date+'T'+t+':00-03:00')>now)slots.push(t);}return slots;
}
async function availabilityOn(db,id,doctor,date){
 const occupied=(await db.query("SELECT slot FROM panel_health_appointments WHERE company_id=$1 AND doctor_id=$2 AND day=$3 AND state<>'CANCELLED'",[id,doctor.id,date])).rows;
 return availableSlots(doctor,date,occupied);
}
export async function availability(db,id,doctorId,date){const d=(await doctors(db,id)).find(d=>d.id===doctorId);if(!d)throw Error('Especialista no encontrado.');return {doctor:d,slots:await availabilityOn(db,id,d,date)};}
async function reserveOn(cx,id,input){
 const requestId=clean(input.requestId,150),contact=clean(input.contact,120),patient=clean(input.patient,80),dni=normalizeDni(input.dni);
 if(!requestId||!contact||patient.length<2)throw Error('Completá nombre ficticio y código de paciente demo.');
 const old=(await cx.query('SELECT * FROM panel_health_appointments WHERE company_id=$1 AND request_id=$2',[id,requestId])).rows[0];
 const replay=a=>{if(a.state==='CANCELLED')throw Error('Ese intento corresponde a un turno cancelado. Iniciá una reserva nueva.');if(a.contact!==contact||a.doctor_id!==input.doctorId||a.day!==input.date||a.patient!==patient||a.dni!==dni||(a.mode==='FIXED'&&a.slot!==input.slot))throw Error('La solicitud ya corresponde a otro turno.');return a;};
 if(old)return replay(old);
 const row=(await cx.query('SELECT * FROM panel_health_doctors WHERE company_id=$1 AND id=$2 FOR UPDATE',[id,input.doctorId])).rows[0];if(!row)throw Error('Especialista no encontrado.');
 const repeated=(await cx.query('SELECT * FROM panel_health_appointments WHERE company_id=$1 AND request_id=$2',[id,requestId])).rows[0];if(repeated)return replay(repeated);
 const d={...row.data,id:row.id},slots=await availabilityOn(cx,id,d,input.date);
 const existing=(await cx.query("SELECT 1 FROM panel_health_appointments WHERE company_id=$1 AND doctor_id=$2 AND day=$3 AND (dni=$4 OR (dni IS NULL AND contact=$5)) AND state<>'CANCELLED'",[id,d.id,input.date,dni,contact])).rows.length;
 if(existing)throw Error('Este paciente demo ya tiene un turno con ese especialista ese día.');
 const slot=d.mode==='QUEUE'?slots[0]:String(input.slot||'');if(!slot||!slots.includes(slot))throw Error('Ese turno o cupo ya no está disponible. Elegí otro.');
 return (await cx.query(`INSERT INTO panel_health_appointments(company_id,id,doctor_id,day,slot,patient,contact,mode,doctor_name,specialty,room,start_time,end_time,request_id,dni) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[id,'TUR-'+randomUUID().slice(0,8).toUpperCase(),d.id,input.date,slot,patient,contact,d.mode,d.name,d.specialty,d.room,d.start,d.end,requestId,dni])).rows[0];
}
export async function reserve(db,id,input){const cx=await db.connect();try{await cx.query('BEGIN');const r=await reserveOn(cx,id,input);await cx.query('COMMIT');return r;}catch(e){await cx.query('ROLLBACK');if(e.code==='23505')throw Error('El turno ya fue reservado. Actualizá la disponibilidad.');throw e;}finally{cx.release();}}
export async function appointments(db,id,date,doctorId=''){return (await db.query('SELECT * FROM panel_health_appointments WHERE company_id=$1 AND day=$2 AND ($3=\'\' OR doctor_id=$3) ORDER BY doctor_name,CASE WHEN mode=\'QUEUE\' THEN LPAD(slot,3,\'0\') ELSE slot END',[id,date,doctorId])).rows;}
export async function appointmentState(db,id,appointmentId,state,contact=null){
 if(!['BOOKED','ARRIVED','ATTENDED','ABSENT','CANCELLED'].includes(state))throw Error('Estado inválido.');
 const r=(await db.query("UPDATE panel_health_appointments SET state=$3 WHERE company_id=$1 AND id=$2 AND state<>'CANCELLED' AND ($4::text IS NULL OR contact=$4) RETURNING *",[id,appointmentId,state,contact])).rows[0];
 if(!r)throw Error('Turno no encontrado o ya cancelado.');return r;
}
export function bookingText(a){return `DEMO — Turno registrado: ${a.id}\n${a.patient}\n${a.doctor_name} · ${a.specialty}\n${a.day} · ${a.mode==='FIXED'?a.slot:'Orden de llegada, atención de '+a.start_time+' a '+a.end_time+'. Cupo asignado '+a.slot+' (no indica hora ni prioridad).'}\n${a.room}\nPodés escribir MIS TURNOS o CANCELAR ${a.id}. No es un turno hospitalario real.`;}
function confirmPatient(s,docs){const d=docs.find(d=>d.id===s.doctorId);return `DEMO — ${s.patient}\nDNI: terminado en ${s.dni.slice(-3)}\n${d?.name||'Especialista'} · ${s.date}\n${s.mode==='FIXED'?s.slot:'Por orden de llegada'}\n¿Confirmás? Respondé SI o NO.`;}
export async function healthChat(db,id,{contact,text,messageId}){
 contact=clean(contact,120);text=clean(text,500);messageId=clean(messageId,150);if(!contact||!messageId)throw Error('Faltan datos de conversación.');
 const cx=await db.connect();try{
 await cx.query('BEGIN');await cx.query('INSERT INTO panel_health_chats(company_id,contact) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,contact]);
 const chat=(await cx.query('SELECT * FROM panel_health_chats WHERE company_id=$1 AND contact=$2 FOR UPDATE',[id,contact])).rows[0];
 const prior=(await cx.query('SELECT response FROM panel_health_chat_events WHERE company_id=$1 AND contact=$2 AND message_id=$3',[id,contact,messageId])).rows[0];
 if(prior){await cx.query('COMMIT');return prior.response;}
 let s=Date.now()-new Date(chat.updated_at).getTime()>30*60*1000?{}:chat.state,response='';const upper=text.toUpperCase();const docs=(await doctors(cx,id)).filter(d=>d.active);
 const menu=()=>{s={step:'doctor',ids:docs.map(d=>d.id)};return 'DEMO ONE Salud — Usá datos ficticios. No asigna turnos reales.\nElegí un especialista:\n'+docs.map((d,i)=>`${i+1}. ${d.name} · ${d.specialty}`).join('\n')+'\nEscribí el número. Para empezar otra vez: TURNOS.';};
 if(/^CANCELAR TUR-[A-Z0-9]+$/.test(upper)){const a=await appointmentState(cx,id,upper.split(' ')[1],'CANCELLED',contact);response='DEMO — Turno '+a.id+' cancelado.';s={};}
 else if(upper==='MIS TURNOS'){
  const rows=(await cx.query("SELECT * FROM panel_health_appointments WHERE company_id=$1 AND contact=$2 AND day>=$3 AND state<>'CANCELLED' ORDER BY day,slot LIMIT 10",[id,contact,localToday()])).rows;
  response=rows.length?rows.map(bookingText).join('\n\n'):'DEMO — No tenés turnos futuros. Escribí TURNOS para comenzar.';
 }
 else if(!s.step||['HOLA','TURNOS','INICIO','CANCELAR'].includes(upper))response=docs.length?menu():'DEMO — Aún no hay especialistas activos. Recepción debe cargar la disponibilidad.';
 else if(s.step==='doctor'){
  const d=docs.find(d=>d.id===s.ids[Number(text)-1]);if(!d)response='Elegí el número de un especialista o escribí TURNOS.';
  else{const dates=[];for(let i=0;i<15;i++){const date=new Date(localToday()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+i);const key=date.toISOString().slice(0,10);if((await availabilityOn(cx,id,d,key)).length)dates.push(key);}
   if(!dates.length){s={};response='No quedan lugares en los próximos 15 días. Escribí TURNOS para elegir otro especialista.';}else{s={step:'date',doctorId:d.id,dates};response='Elegí un día:\n'+dates.map((x,i)=>`${i+1}. ${x}`).join('\n');}}
 }else if(s.step==='date'){
  const date=s.dates[Number(text)-1],d=docs.find(d=>d.id===s.doctorId);if(!date||!d)response='Elegí el número de un día o escribí TURNOS.';
  else{const slots=await availabilityOn(cx,id,d,date);if(!slots.length){s={};response='Ese día ya no tiene lugares. Escribí TURNOS para actualizar.';}else if(d.mode==='QUEUE'){s={step:'name',doctorId:d.id,date,slot:'',mode:d.mode};response=`Orden de llegada, atención de ${d.start} a ${d.end}. El cupo no indica una hora ni prioridad.\nEscribí nombre completo y DNI ficticios del paciente en un solo mensaje. Ejemplo: Persona Demo, 12345678.`;}else{s={step:'slot',doctorId:d.id,date,slots};response='Elegí un horario:\n'+slots.map((x,i)=>`${i+1}. ${x}`).join('\n');}}
 }else if(s.step==='slot'){
  const slot=s.slots[Number(text)-1];if(!slot)response='Elegí el número de un horario o escribí TURNOS.';else{s={step:'name',doctorId:s.doctorId,date:s.date,slot,mode:'FIXED'};response='Escribí nombre completo y DNI ficticios del paciente en un solo mensaje. Ejemplo: Persona Demo, 12345678.';}
 }else if(s.step==='name'){
  const match=text.match(/^(.+?)[,;]\s*(?:DNI\s*[:\s]?\s*)?(.+)$/i)||text.match(/^(.+?)\s+(?:DNI\s*[:\s]?\s*)?([0-9][0-9.\s]*)$/i);
  const patient=(match?match[1]:text).trim();let dni=null;
  if(match){try{dni=normalizeDni(match[2]);}catch{}}
  if(patient.length<2||patient.length>80)response='Usá un nombre completo ficticio de entre 2 y 80 caracteres y el DNI ficticio.';
  else{s={...s,patient,dni,step:dni?'confirm':'dni'};response=dni?confirmPatient(s,docs):'Me falta el DNI ficticio del paciente (7 u 8 dígitos). Escribilo para continuar.';}
 }else if(s.step==='dni'){
  try{s={...s,dni:normalizeDni(text),step:'confirm'};response=confirmPatient(s,docs);}catch(e){response=e.message;}
 }else if(s.step==='confirm'){
  if(['SI','SÍ'].includes(upper)&&!s.dni){s={...s,step:'dni'};response='Antes de confirmar, ingresá el DNI ficticio del paciente (7 u 8 dígitos).';}
  else if(['SI','SÍ'].includes(upper)){const a=await reserveOn(cx,id,{...s,contact,requestId:'CHAT-'+createHash('sha256').update(contact+'\0'+messageId).digest('hex')});response=bookingText(a);s={};}
  else if(upper==='NO'){s={};response='No se reservó el turno. Escribí TURNOS para empezar.';}else response='Respondé SI para reservar, NO para descartar o TURNOS para empezar otra vez.';
 }
 await cx.query('UPDATE panel_health_chats SET state=$3,updated_at=NOW() WHERE company_id=$1 AND contact=$2',[id,contact,JSON.stringify(s)]);
 await cx.query('INSERT INTO panel_health_chat_events(company_id,contact,message_id,response) VALUES($1,$2,$3,$4)',[id,contact,messageId,response]);await cx.query('COMMIT');return response;
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function printAgenda(name,date,rows,professional='Todos los especialistas'){return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Agenda demo ONE Salud</title><style>body{font:14px Arial;margin:32px;color:#16312b}h1{font-size:24px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ccd7ce;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}@media print{button{display:none}@page{size:A4;margin:15mm}}</style><button onclick="window.print()">Imprimir / Guardar PDF</button><h1>${escape(name)} — Agenda de demostración</h1><p>${escape(professional)}</p><p>${escape(date)} · Datos ficticios · No válido como turno hospitalario</p><table><thead><tr><th>Profesional</th><th>Hora / cupo</th><th>Paciente ficticio</th><th>DNI ficticio</th><th>Consultorio</th><th>Estado</th></tr></thead><tbody>${rows.filter(a=>a.state!=='CANCELLED').map(a=>`<tr><td>${escape(a.doctor_name)}</td><td>${escape(a.mode==='FIXED'?a.slot:'Llegada · cupo '+a.slot+' · '+a.start_time+'–'+a.end_time)}</td><td>${escape(a.patient)}</td><td>${escape(a.dni||'Sin registrar')}</td><td>${escape(a.room)}</td><td>${escape({BOOKED:'Reservado',ARRIVED:'Llegó',ATTENDED:'Atendido',ABSENT:'No asistió'}[a.state]||a.state)}</td></tr>`).join('')}</tbody></table><p>Orden de llegada: el cupo no representa hora ni prioridad. Generado: ${escape(new Date().toISOString())}.</p></html>`;}
