import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {lodgingRouter} from '../src/lodging_routes.js';
import {requireConfiguredModule} from '../src/module_access.js';

let company={company_id:'A',modules:{cabanas:true},service_state:'ACTIVE'};
let member=true,edit=true,operate=true,role='ADMIN_EMPRESA',writes=0;
const db={query:async sql=>{
 if(sql.includes('panel_user_companies'))return {rows:member?[{permissions:{view:true,editCatalog:edit,operate}}]:[]};
 if(sql.startsWith('SELECT items'))return {rows:[]};
 if(sql.startsWith('SELECT settings'))return {rows:[{settings:{},revision:0}]};
 if(sql.startsWith('SELECT *'))return {rows:[]};
 writes++;return {rows:[{revision:1}]};
}};
const app=express();app.use(express.json());
app.use('/company/:companyId',(req,res,next)=>{
 if(!member)return res.sendStatus(403);
 req.session={role,uid:1};next();
},requireConfiguredModule(async()=>company));
app.use('/company/:companyId/lodging',lodgingRouter(db));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const url=`http://127.0.0.1:${server.address().port}/company/A/lodging`;
test.after(()=>server.close());
const post=(suffix,body={})=>fetch(url+suffix,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const reset=()=>{company={company_id:'A',modules:{cabanas:true},service_state:'ACTIVE'};member=true;edit=true;operate=true;role='ADMIN_EMPRESA';};

test('lectura permitida; edición denegada, empresa ajena, módulo incorrecto y pausa bloquean escrituras',async()=>{
 reset();
 assert.equal((await fetch(url)).status,200);
 edit=false;
 assert.equal((await post('',{items:[],revision:0})).status,403);
 assert.equal(writes,0);
 member=false;assert.equal((await fetch(url)).status,403);
 member=true;company.modules={gastro:true};assert.equal((await fetch(url)).status,403);
 company.modules={cabanas:true};company.service_state='PAUSED';edit=true;
 assert.equal((await post('')).status,403);
 assert.equal(writes,0);
});

test('reservas usan operate y ajustes del alojamiento son exclusivos de SUPERADMIN',async()=>{
 reset();
 edit=true;operate=false;
 const before=writes;
 assert.equal((await post('/bookings')).status,403,'el editor sin permiso operativo no reserva');
 assert.equal((await post('/settings')).status,403,'el editor de catálogo no configura el alojamiento');
 assert.equal(writes,before);

 edit=false;operate=true;
 const data=await (await fetch(url+'/operations')).json();
 assert.equal(data.canOperate,true);
 assert.equal(data.canConfigure,false);
 assert.notEqual((await post('/bookings')).status,403,'el operador puede pasar el control para reservar');
 const afterAllowed=writes;
 assert.equal((await post('/settings')).status,403);
 company.service_state='PAUSED';
 assert.equal((await post('/bookings')).status,403);
 assert.equal(writes,afterAllowed,'los intentos sin autorización no ejecutan escrituras');

 reset();role='SUPERADMIN';
 const result=await post('/settings',{settings:{checkIn:'14:00'},revision:0});
 assert.equal(result.status,200,'SUPERADMIN puede guardar la configuración');
});
