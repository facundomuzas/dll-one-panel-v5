import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initHealthDemo,seedHealthDemo,doctors,saveDoctor,appointments,localToday} from '../src/health_demo.js';
import {initHealthAssistant,healthAssistant,validateHealthIntent} from '../src/health_assistant.js';
import {initVoiceSettings,saveVoiceSettings,getVoiceSettings} from '../src/voice_settings.js';
const pg=new PGlite();let queue=Promise.resolve();const db={query:(...a)=>pg.query(...a),connect:async()=>{let release;const prev=queue;queue=new Promise(r=>release=r);await prev;return {query:(...a)=>pg.query(...a),release};}};
await initHealthDemo(db);await initHealthAssistant(db);await initVoiceSettings(db);await pg.exec('CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY)');await pg.exec("INSERT INTO panel_companies VALUES('A'),('B')");
const company={company_id:'A',company_name:'Institución de prueba'};
const day=new Date(localToday()+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+2);const date=day.toISOString().slice(0,10);
let n=0;const say=(x,text='mensaje',messageId=String(++n),contact='WA-1',c=company)=>healthAssistant(db,c,{contact,text,messageId},async()=>x);
const book={action:'BOOK',doctorId:'DEMO-1',date,slot:'08:00',patient:'Paciente Apellido',dni:'12345678'};
test.beforeEach(async()=>{n=0;await pg.exec('TRUNCATE panel_health_doctors,panel_health_appointments,panel_health_ai_chats,panel_health_ai_events,panel_voice_settings,panel_voice_audit');await seedHealthDemo(db,'A');for(const d of await doctors(db,'A'))await saveDoctor(db,'A',{...d,days:[0,1,2,3,4,5,6],address:'Calle de prueba 100',service:'Consultorios externos'});});
test('reserva con resumen previo, QR opaco y repetición sin duplicar',async()=>{
 assert.match((await say({...book,action:'CONFIRM'})).response,/Confirmás/);
 assert.equal((await appointments(db,'A',date)).length,0);
 const r=await say({action:'CONFIRM'},'sí','confirm');assert.match(r.response,/Turno confirmado/);assert.match(r.response,/DNI: 12345678/);assert.match(r.response,/Calle de prueba 100/);assert.ok(r.qrBase64.startsWith('iVBOR'));
 const rows=await appointments(db,'A',date);assert.equal(rows.length,1);assert.equal(rows[0].qr_token.length,48);assert.ok(!rows[0].qr_token.includes('12345678'));
 assert.deepEqual(await say({action:'CONFIRM'},'sí','confirm'),r);assert.equal((await appointments(db,'A',date)).length,1);
 assert.equal((await appointments(db,'A',date,'','Clínica médica','Consultorios externos')).length,1);
 assert.equal((await appointments(db,'A',date,'','Cardiología')).length,0);
});
test('corregir un dato invalida consentimiento; IA caída preserva borrador',async()=>{
 await say(book);const corrected=await say({action:'CONFIRM',patient:'Otro Apellido'});assert.match(corrected.response,/Confirmás/);assert.equal((await appointments(db,'A',date)).length,0);
 const failed=await healthAssistant(db,company,{contact:'WA-1',text:'sí',messageId:'failed'},async()=>{throw Error('503');});assert.match(failed.response,/No modifiqué/);
 const r=await say({action:'CONFIRM'});assert.match(r.response,/Otro Apellido/);
});
test('no mezcla instituciones y no cancela sin aceptación previa',async()=>{
 await say(book);const r=await say({action:'CONFIRM'});const id=r.appointmentId;
 const bad=await say({action:'BOOK',doctorId:'DEMO-1'},'turno','b','WA-1',{company_id:'B',company_name:'B'});assert.match(bad.response,/No pude interpretar/);
 assert.match((await say({action:'CANCEL',appointmentId:id},'cancelar','other','WA-2')).response,/código/);
 assert.match((await say({action:'CANCEL',appointmentId:id})).response,/Confirmás cancelar/);assert.equal((await appointments(db,'A',date))[0].state,'BOOKED');
 await say({action:'CONFIRM'});assert.equal((await appointments(db,'A',date))[0].state,'CANCELLED');
});
test('último cupo no se reserva dos veces y se pide alternativa',async()=>{
 await say(book,'reserva','a','WA-1');await say({...book,patient:'Segunda Persona',dni:'23456789'},'reserva','b','WA-2');
 await say({action:'CONFIRM'},'sí','c','WA-1');const r=await say({action:'CONFIRM'},'sí','d','WA-2');assert.match(r.response,/Horarios disponibles/);assert.equal((await appointments(db,'A',date)).length,1);
});
test('solo superadmin habilita voz, no acepta clave ni otros tenants por perfil',async()=>{
 assert.equal((await getVoiceSettings(db,'A')).enabled,false);
 for(const role of ['ADMIN','OPERADOR',undefined])await assert.rejects(()=>saveVoiceSettings(db,'A',{enabled:true,voiceId:'voice',revision:0},{role}),/Super Admin/);
 const saved=await saveVoiceSettings(db,'A',{enabled:true,voiceId:'voice',revision:0},{role:'SUPERADMIN',sub:'owner'});assert.equal(saved.enabled,true);assert.equal((await getVoiceSettings(db,'B')).enabled,false);
 await assert.rejects(()=>saveVoiceSettings(db,'A',{enabled:false,voiceId:'voice',revision:0},{role:'SUPERADMIN'}),/cambió/);
 await saveVoiceSettings(db,'A',{enabled:false,voiceId:'voice',revision:1},{role:'SUPERADMIN'});assert.equal((await getVoiceSettings(db,'A')).enabled,false);
});
test('no acepta IDs inventados ni tipos erróneos',()=>{assert.throws(()=>validateHealthIntent({action:'BOOK',doctorId:'inventado'},[]));assert.throws(()=>validateHealthIntent({action:'CONFIRM',dni:12345678},[]));});
test.after(()=>pg.close());
