import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initHealthDemo,seedHealthDemo,doctors,saveDoctor,validateDoctor,availableSlots,availability,reserve,appointments,appointmentState,healthChat,printAgenda,localToday} from '../src/health_demo.js';
const pg=new PGlite();let chain=Promise.resolve();
const db={query:(...a)=>pg.query(...a),connect:async()=>{let release;const previous=chain;chain=new Promise(r=>release=r);await previous;return {query:(...a)=>pg.query(...a),release};}};
await initHealthDemo(db);
const tomorrow=new Date(localToday()+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const date=tomorrow.toISOString().slice(0,10);
test.beforeEach(async()=>{await pg.exec('TRUNCATE panel_health_state_events,panel_health_doctors,panel_health_appointments,panel_health_chats,panel_health_chat_events');await seedHealthDemo(db,'A');for(const d of await doctors(db,'A'))await saveDoctor(db,'A',{...d,days:[0,1,2,3,4,5,6],capacity:2});});
const input=(contact='P1',requestId='REQ1')=>({doctorId:'DEMO-1',date,slot:'08:00',patient:'Paciente Ficticio',dni:contact==='P2'?'23456789':contact==='P3'?'34567890':'12345678',contact,requestId});
test('dos modalidades, límites, días bloqueados y horas pasadas',()=>{
 const d=validateDoctor({name:'Demo',specialty:'Demo',room:'1',mode:'FIXED',days:[1],start:'08:00',end:'09:00',minutes:20,capacity:2,active:true});
 const now=new Date('2026-10-19T11:10:00Z');assert.deepEqual(availableSlots(d,'2026-10-19',[],now),['08:20','08:40']);assert.deepEqual(availableSlots({...d,blockedDates:['2026-10-19']},'2026-10-19',[],now),[]);
 assert.deepEqual(availableSlots({...d,mode:'QUEUE'},'2026-10-19',[{slot:'1'}],now),['2']);
 assert.throws(()=>availableSlots(d,'2026-02-31',[],now),/Fecha/);assert.throws(()=>validateDoctor({...d,end:'07:00'}),/posterior/);assert.throws(()=>validateDoctor({...d,capacity:0}),/Cupo/);
});
test('reserva por horario, repetición idempotente, aislamiento y liberación por cancelación',async()=>{
 const a=await reserve(db,'A',input());assert.equal(a.slot,'08:00');assert.equal((await reserve(db,'A',input())).id,a.id);
 await assert.rejects(()=>reserve(db,'A',input('P2','REQ2')),/disponible/);
 await assert.rejects(()=>reserve(db,'B',input()),/Especialista/);await assert.rejects(()=>appointmentState(db,'B',a.id,'CANCELLED'),/encontrado/);
 await appointmentState(db,'A',a.id,'CANCELLED');const second=await reserve(db,'A',input('P2','REQ2'));assert.notEqual(second.id,a.id);
 await assert.rejects(()=>reserve(db,'A',input()),/cancelado/);
 assert.equal((await appointments(db,'A',date)).length,2);assert.equal((await appointments(db,'B',date)).length,0);
});
test('cupo por llegada limita reservas concurrentes y no cambia la agenda con turnos vigentes',async()=>{
 const results=await Promise.allSettled([1,2,3].map(i=>reserve(db,'A',{...input('P'+i,'REQ'+i),doctorId:'DEMO-2'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const rows=await appointments(db,'A',date,'DEMO-2');assert.deepEqual(rows.map(a=>a.slot),['1','2']);
 const d=(await doctors(db,'A')).find(d=>d.id==='DEMO-2');await assert.rejects(()=>saveDoctor(db,'A',{...d,capacity:1}),/vigentes/);
 await saveDoctor(db,'A',{...d,name:'Profesional Ejemplo'});await assert.rejects(()=>saveDoctor(db,'A',{...d,name:'Dato viejo'}),/cambió/);
});
test('chat reserva con una confirmación, reintento no duplica y cancelar requiere el mismo contacto',async()=>{
 let n=0;const say=(text,messageId=String(++n),contact='CHAT-A')=>healthChat(db,'A',{contact,text,messageId});
 assert.match(await say('TURNOS'),/especialista/);assert.match(await say('1'),/día/);assert.match(await say('1'),/horario/);assert.match(await say('1'),/nombre completo/);assert.match(await say('Persona Ejemplo, 12.345.678'),/Confirmás/);
 const reply=await say('SI','confirm');assert.match(reply,/Turno registrado/);assert.equal(await say('SI','confirm'),reply);
 const id=reply.match(/TUR-[A-Z0-9]+/)[0];assert.match(await say('MIS TURNOS'),new RegExp(id));
 await assert.rejects(()=>say('CANCELAR '+id,'other','CHAT-B'),/encontrado/);assert.match(await say('CANCELAR '+id),/cancelado/);assert.match(await say('MIS TURNOS'),/No tenés/);
});
test('chat por llegada informa franja y cupo, impresión filtra cancelados y escapa HTML',async()=>{
 let n=0;const say=text=>healthChat(db,'A',{contact:'Q',text,messageId:String(++n)});
 await say('TURNOS');await say('2');assert.match(await say('1'),/no indica una hora ni prioridad/);await say('<img src=x>, 12345678');const reply=await say('SI');assert.match(reply,/Orden de llegada/);
 const row=(await pg.query('SELECT * FROM panel_health_appointments')).rows[0];const html=printAgenda('<Hospital>',row.day,[row,{...row,patient:'Cancelado',state:'CANCELLED'}]);assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('Cancelado'));assert.match(html,/window.print/);
});
test('índice de base de datos impide duplicados incluso fuera del servicio',async()=>{
 const a=await reserve(db,'A',input());await assert.rejects(()=>pg.query(`INSERT INTO panel_health_appointments(company_id,id,doctor_id,day,slot,patient,contact,mode,doctor_name,specialty,room,start_time,end_time,state,request_id,created_at,dni) SELECT company_id,'OTRO',doctor_id,day,slot,patient,'OTRO',mode,doctor_name,specialty,room,start_time,end_time,state,'REQ-OTRO',created_at,dni FROM panel_health_appointments WHERE id=$1`,[a.id]),e=>e.code==='23505');
});
test('DNI validado, almacenado y único por especialista y día; permite familiares con un teléfono',async()=>{
 await assert.rejects(()=>reserve(db,'A',{...input(),dni:''}),/DNI/);
 await assert.rejects(()=>reserve(db,'A',{...input(),dni:'abc12345678'}),/DNI/);
 const a=await reserve(db,'A',{...input(),dni:'12.345.678'});assert.equal(a.dni,'12345678');
 await assert.rejects(()=>reserve(db,'A',{...input('OTRO','REQ-OTRO'),dni:'12345678',slot:'08:20'}),/ya tiene/);
 await assert.rejects(()=>reserve(db,'A',{...input(),dni:'23456789'}),/otro turno/);
 const family=await reserve(db,'A',{...input('P1','REQ-FAMILY'),dni:'23456789',slot:'08:20'});assert.equal(family.contact,a.contact);
 const html=printAgenda('Demo',date,[a,family,{...a,dni:null}]);assert.match(html,/DNI/);assert.match(html,/12345678/);assert.match(html,/Sin registrar/);
 await initHealthDemo(db);assert.equal((await appointments(db,'A',date)).length,2);
});
test('chat pide solo DNI faltante y conserva nombre, rechaza inválido y confirma una vez',async()=>{
 let n=0;const say=text=>healthChat(db,'A',{contact:'DNI-CHAT',text,messageId:String(++n)});
 await say('TURNOS');await say('2');await say('1');assert.match(await say('Persona Demo, 123'),/Me falta el DNI/);
 assert.match(await say('abc'),/DNI/);const confirmation=await say('12.345.678');assert.match(confirmation,/Persona Demo/);assert.match(confirmation,/Confirmás/);
 assert.match(await say('SI'),/Turno registrado/);const row=(await pg.query('SELECT * FROM panel_health_appointments')).rows[0];assert.equal(row.dni,'12345678');assert.equal(row.patient,'Persona Demo');
});
test('migración conserva turnos antiguos sin inventar DNI y los imprime sin registrar',async()=>{
 const a=await reserve(db,'A',input());await pg.query('UPDATE panel_health_appointments SET dni=NULL WHERE id=$1',[a.id]);
 await initHealthDemo(db);const row=(await appointments(db,'A',date))[0];assert.equal(row.dni,null);assert.equal(row.id,a.id);assert.match(printAgenda('Demo',date,[row]),/Sin registrar/);
});
test('recepción y consulta registran tiempos, autor y cambios únicos',async()=>{
 const a=await reserve(db,'A',input());
 await assert.rejects(()=>appointmentState(db,'A',a.id,'ATTENDED'),/transición/);
 const arrived=await appointmentState(db,'A',a.id,'ARRIVED',null,'recepcion');
 assert.ok(arrived.arrived_at);assert.equal(arrived.consultation_started_at,null);
 const replay=await appointmentState(db,'A',a.id,'ARRIVED',null,'recepcion');
 assert.equal(String(replay.arrived_at),String(arrived.arrived_at));
 await assert.rejects(()=>appointmentState(db,'A',a.id,'ARRIVED','OTRO'),/encontrado/);
 await appointmentState(db,'A',a.id,'IN_CONSULTATION',null,'medico');
 await assert.rejects(()=>appointmentState(db,'A',a.id,'CANCELLED',a.contact),/recepción/);
 const done=await appointmentState(db,'A',a.id,'ATTENDED',null,'medico');
 assert.ok(done.consultation_started_at);assert.ok(done.attended_at);
 await assert.rejects(()=>appointmentState(db,'A',a.id,'BOOKED'),/transición/);
 const events=(await pg.query('SELECT * FROM panel_health_state_events WHERE company_id=$1 AND appointment_id=$2 ORDER BY id',['A',a.id])).rows;
 assert.deepEqual(events.map(e=>e.to_state),['ARRIVED','IN_CONSULTATION','ATTENDED']);
 assert.deepEqual(events.map(e=>e.actor),['recepcion','medico','medico']);
 await initHealthDemo(db);assert.equal((await appointments(db,'A',date))[0].state,'ATTENDED');
});
test('fallo de auditoría revierte estado y horario',async()=>{
 const a=await reserve(db,'A',input());
 const broken={connect:async()=>{const cx=await db.connect();return {release:cx.release,query:(sql,args)=>{if(sql.startsWith('INSERT INTO panel_health_state_events'))throw Error('audit failed');return cx.query(sql,args);}};}};
 await assert.rejects(()=>appointmentState(broken,'A',a.id,'ARRIVED'),/audit failed/);
 const row=(await appointments(db,'A',date))[0];assert.equal(row.state,'BOOKED');assert.equal(row.arrived_at,null);
});
test.after(()=>pg.close());
