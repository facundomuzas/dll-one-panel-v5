import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {requireCompanyOperation} from '../src/operation_access.js';
import {requireConfiguredModule} from '../src/module_access.js';
import {initHealthDemo,seedHealthDemo,doctors,saveDoctor,isHealth,reserve,appointments,appointmentState,localToday} from '../src/health_demo.js';
import {initHealthAssistant,healthAssistant} from '../src/health_assistant.js';

const pg=new PGlite();let queue=Promise.resolve(),failPermission=false,aiCalls=0;
const pool={query:(sql,args)=>{if(failPermission&&sql.includes('SELECT uc.permissions'))throw Error('database unavailable');return pg.query(sql,args);},connect:async()=>{let release;const before=queue;queue=new Promise(r=>release=r);await before;return {query:pool.query,release};}};
await pg.exec(`CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY,company_name TEXT,service_state TEXT,modules JSONB);
CREATE TABLE panel_users(user_id INT PRIMARY KEY,active BOOLEAN);
CREATE TABLE panel_user_companies(user_id INT,company_id TEXT,permissions JSONB);
INSERT INTO panel_companies VALUES('A','Hospital A','ACTIVE','{"salud":true}'),('B','Hospital B','ACTIVE','{"salud":true}'),('C','Gastro C','ACTIVE','{"gastro":true}');
INSERT INTO panel_users VALUES(1,true),(2,true),(3,true),(4,false),(5,true);
INSERT INTO panel_user_companies VALUES(1,'A','{"view":true,"operate":false}'),(2,'A','{"view":true,"operate":true}'),(3,'B','{"view":true,"operate":true}'),(4,'A','{"view":true,"operate":true}'),(5,'A','{"view":false,"operate":true}');`);
await initHealthDemo(pool);await initHealthAssistant(pool);
const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const dbSource=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const accessSource=dbSource.slice(dbSource.indexOf('export async function userCanAccessCompany'),dbSource.indexOf('export async function getPanelUserById')).replace('export ','');
const userCanAccessCompany=new Function('pool',accessSource+'\nreturn userCanAccessCompany;')(pool);
const companyAccess=source.slice(source.indexOf('async function companyAccessRequired'),source.indexOf('function runtimeStateToChatItem'));
const globalGate=source.slice(source.indexOf('app.use(\n  "/api/company/:companyId"'),source.indexOf("app.use('/api/company/:companyId/business-admin'"));
const healthGate=source.slice(source.indexOf("app.use('/api/company/:companyId/health',"),source.indexOf("app.get('/api/company/:companyId/health/doctors'"));
const registrations=source.split('\n').filter(line=>/^app\.(get|post)\('\/api\/company\/:companyId\/health\/(book|chat|state|agenda|doctors)'/.test(line)).join('\n');
const app=express();app.use(express.json());
// Authentication is simulated here; JWT/session behavior has its own existing suite.
const authRequired=(req,res,next)=>{const user=req.headers['x-test-user'];if(!user)return res.status(401).json({ok:false});req.session=user==='super'?{uid:0,role:'SUPERADMIN',sub:'owner'}:{uid:Number(user),role:'ADMIN_EMPRESA',sub:'user-'+user};next();};
const requireSuperadmin=(req,res,next)=>String(req.session?.role||'').toUpperCase()==='SUPERADMIN'?next():res.status(403).json({ok:false});
const deps={app,pool,userCanAccessCompany,authRequired,requireSuperadmin,requireConfiguredModule,getCompany:async id=>(await pool.query('SELECT * FROM panel_companies WHERE company_id=$1',[id])).rows[0],isHealth,canOperate:requireCompanyOperation(pool),reserve,appointments,appointmentState,doctors,localToday,healthAssistant,crypto,interpretHealth:async()=>{aiCalls++;return {action:'HELP'};}};
new Function(...Object.keys(deps),companyAccess+globalGate+healthGate+registrations)(...Object.values(deps));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const future=new Date(localToday()+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+2);const date=future.toISOString().slice(0,10);
const booking=()=>({doctorId:'DEMO-1',date,slot:'08:00',patient:'Paciente Prueba',contact:'test-patient',dni:'12345678',requestId:'test-booking'});
async function request(user,path,body){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/company/${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(user?{'x-test-user':user}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
const count=async table=>Number((await pool.query('SELECT COUNT(*) AS n FROM '+table)).rows[0].n);
test.beforeEach(async()=>{failPermission=false;aiCalls=0;await pg.exec('TRUNCATE panel_health_doctors,panel_health_appointments,panel_health_ai_chats,panel_health_ai_events');await pg.exec("UPDATE panel_companies SET service_state='ACTIVE'");for(const id of ['A','B']){await seedHealthDemo(pool,id);for(const d of await doctors(pool,id))await saveDoctor(pool,id,{...d,days:[0,1,2,3,4,5,6]});}});
test('read-only user can see agenda but cannot reserve a real appointment',async()=>{
 assert.equal((await request('1','A/health/agenda?date='+date)).status,200);
 const readOnly=await request('1','A/health/doctors');assert.equal(readOnly.status,200);assert.equal(readOnly.body.canOperate,false);
 const operator=await request('2','A/health/doctors');assert.equal(operator.status,200);assert.equal(operator.body.canOperate,true);
 assert.equal((await request('1','A/health/book',booking())).status,403);assert.equal(await count('panel_health_appointments'),0);
});
test('read-only user cannot use administrative AI chat or create its state',async()=>{
 assert.equal((await request('1','A/health/chat',{text:'Quiero un turno',messageId:'m1',sessionId:'s1'})).status,403);
 assert.equal(aiCalls,0);assert.equal(await count('panel_health_ai_chats'),0);assert.equal(await count('panel_health_ai_events'),0);
});
test('authorized operator can reserve, use chat and cancel; read-only cannot cancel',async()=>{
 const booked=await request('2','A/health/book',{...booking(),companyId:'B'});assert.equal(booked.status,200,JSON.stringify(booked.body));
 assert.equal((await appointments(pool,'A',date)).length,1);assert.equal((await appointments(pool,'B',date)).length,0);
 const id=booked.body.appointment.id;
 assert.equal((await request('1','A/health/state',{id,state:'CANCELLED'})).status,403);
 assert.equal((await request('2','A/health/chat',{text:'Hola',messageId:'m1',sessionId:'s1'})).status,200);assert.equal(aiCalls,1);
 assert.equal((await request('2','A/health/state',{id,state:'CANCELLED'})).status,200);
 assert.equal((await appointments(pool,'A',date))[0].state,'CANCELLED');
});
test('other-company, disabled and view-denied users cannot read or operate A',async()=>{
 for(const user of ['3','4','5'])for(const [path,body] of [['agenda?date='+date,undefined],['book',booking()],['chat',{text:'Hola',messageId:'m1'}],['state',{id:'not-owned',state:'CANCELLED'}]])assert.equal((await request(user,'A/health/'+path,body)).status,403);
 assert.equal(await count('panel_health_appointments'),0);assert.equal(aiCalls,0);
});
test('missing authentication, suspended service and wrong module reject operations',async()=>{
 assert.equal((await request(null,'A/health/book',booking())).status,401);
 await pool.query("UPDATE panel_companies SET service_state='SUSPENDED' WHERE company_id='A'");assert.equal((await request('2','A/health/book',booking())).status,403);
 assert.equal((await request('super','C/health/book',booking())).status,403);assert.equal(await count('panel_health_appointments'),0);
});
test('suspending Health disables the editor and forbids cancelling an existing appointment',async()=>{
 const bookingResult=await request('2','A/health/book',booking());
 assert.equal(bookingResult.status,200);
 const id=bookingResult.body.appointment.id;
 await pool.query("UPDATE panel_companies SET service_state='SUSPENDED' WHERE company_id='A'");
 const access=await request('super','A/health/doctors');
 assert.equal(access.status,200);assert.equal(access.body.canOperate,false);
 assert.equal((await request('super','A/health/state',{id,state:'CANCELLED'})).status,403);
 assert.equal((await appointments(pool,'A',date))[0].state,'BOOKED');
});
test('permission database failure fails closed before booking or invoking AI',async()=>{
 failPermission=true;
 assert.equal((await request('2','A/health/book',booking())).status,503);
 assert.equal((await request('2','A/health/chat',{text:'Hola',messageId:'m1'})).status,503);
 assert.equal(await count('panel_health_appointments'),0);assert.equal(aiCalls,0);
});
test('superadmin retains operations on an active health company',async()=>{
 assert.equal((await request('super','A/health/book',booking())).status,200);
 assert.equal((await request('super','A/health/chat',{text:'Hola',messageId:'m1'})).status,200);assert.equal(aiCalls,1);
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));await pg.close();});
