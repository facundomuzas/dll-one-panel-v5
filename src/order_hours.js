export const dayNames=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
export function defaultHours(){return {mode:'ALWAYS',timeZone:'America/Argentina/Buenos_Aires',days:Array.from({length:7},()=>[]),closedMessage:''};}
function minutes(value){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)))throw new Error('Horario inválido. Usá HH:MM.');const [h,m]=value.split(':').map(Number);return h*60+m;}
export function normalizeHours(input){
 if(!input||!['ALWAYS','SCHEDULED','PAUSED'].includes(input.mode))throw new Error('Elegí cómo recibir pedidos.');
 const timeZone=String(input.timeZone||'').trim();
 try{if(!timeZone)throw Error();new Intl.DateTimeFormat('es-AR',{timeZone}).format(new Date());}catch{throw new Error('Zona horaria inválida.');}
 if(!Array.isArray(input.days)||input.days.length!==7)throw new Error('Configurá los siete días de la semana.');
 const days=input.days.map(slots=>{
  if(!Array.isArray(slots)||slots.length>4)throw new Error('Máximo cuatro turnos por día.');
  return slots.map(slot=>{const start=String(slot?.start||''),end=String(slot?.end||'');const a=minutes(start),b=minutes(end);if(a===b&&a!==0)throw new Error('La apertura y el cierre deben ser distintos. Para un día completo usá 00:00 a 00:00.');return {start,end};});
 });
 if(input.mode==='SCHEDULED'&&!days.some(d=>d.length))throw new Error('Agregá al menos un turno o elegí Pausar pedidos.');
 const closedMessage=String(input.closedMessage||'').trim();if(closedMessage.length>500)throw new Error('El mensaje de cierre admite hasta 500 caracteres.');
 return {mode:input.mode,timeZone,days,closedMessage};
}
export function evaluateHours(config,now=new Date()){
 const s=normalizeHours(config);
 if(s.mode==='ALWAYS')return {open:true,mode:s.mode,timeZone:s.timeZone,message:'Tomamos pedidos las 24 horas, todos los días.'};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:s.timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const day=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday),minute=Number(parts.hour)*60+Number(parts.minute);
 const current=s.days[day].some(slot=>{const a=minutes(slot.start),b=minutes(slot.end);return a===0&&b===0||a<b&&minute>=a&&minute<b||a>b&&minute>=a;});
 const previous=s.days[(day+6)%7].some(slot=>{const a=minutes(slot.start),b=minutes(slot.end);return a>b&&minute<b;});
 const open=s.mode==='SCHEDULED'&&(current||previous);
 const schedule=s.days.map((slots,i)=>slots.length?`${dayNames[i]}: ${slots.map(x=>x.start===x.end?'24 horas':`${x.start} a ${x.end}${minutes(x.end)<minutes(x.start)?' (día siguiente)':''}`).join(' y ')}`:'').filter(Boolean).join('\n');
 const message=s.mode==='PAUSED'?'Por el momento no estamos tomando pedidos.':`Ahora ${open?'estamos tomando':'no tomamos'} pedidos.\nHorarios para pedidos (${s.timeZone}):\n${schedule}`;
 return {open,mode:s.mode,timeZone:s.timeZone,message:[message,!open&&s.closedMessage].filter(Boolean).join('\n')};
}
export async function initOrderHours(db){await db.query(`CREATE TABLE IF NOT EXISTS panel_order_hours(company_id TEXT PRIMARY KEY,settings JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);}
export async function getOrderHours(db,companyId){const row=(await db.query('SELECT settings,revision FROM panel_order_hours WHERE company_id=$1',[companyId])).rows[0];return row||{settings:defaultHours(),revision:0};}
export async function saveOrderHours(db,companyId,input){
 const settings=normalizeHours(input.settings);if(!Number.isInteger(input.revision)||input.revision<0)throw new Error('Recargá los horarios antes de guardar.');
 const client=await db.connect();try{
  await client.query('BEGIN');
  if(!(await client.query('SELECT company_id FROM panel_companies WHERE company_id=$1 FOR UPDATE',[companyId])).rows.length)throw new Error('Empresa no encontrada.');
  const current=await getOrderHours(client,companyId);if(current.revision!==input.revision)throw new Error('Los horarios cambiaron en otra sesión. Recargá antes de guardar.');
  const row=(await client.query(`INSERT INTO panel_order_hours(company_id,settings) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET settings=EXCLUDED.settings,revision=panel_order_hours.revision+1,updated_at=NOW() RETURNING settings,revision`,[companyId,JSON.stringify(settings)])).rows[0];
  await client.query('COMMIT');return row;
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export async function requireOrderOpen(db,payload,now=new Date()){
 const company=(await db.query('SELECT phone_number_id FROM panel_companies WHERE company_id=$1',[payload.companyId])).rows[0];
 if(!company||String(company.phone_number_id)!==String(payload.phoneNumberId))throw new Error('Empresa o número incorrecto.');
 const status=evaluateHours((await getOrderHours(db,payload.companyId)).settings,now);
 if(!status.open){const err=new Error(status.message);err.code='ORDERS_CLOSED';throw err;}
 return status;
}
