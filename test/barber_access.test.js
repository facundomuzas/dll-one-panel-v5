import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {barberRouter} from '../src/barber_routes.js';
import {requireConfiguredModule} from '../src/module_access.js';

let company={modules:{barberias:true},service_state:'ACTIVE'},member=true,edit=false,operate=false,role='ADMIN_EMPRESA',writes=0;
const db={query:async sql=>{
 if(sql.includes('panel_user_companies'))return {rows:member?[{permissions:{view:true,editCatalog:edit,operate}}]:[]};
 if(sql.startsWith('SELECT'))return {rows:[]};
 writes++;return {rows:[]};
}};
const app=express();app.use(express.json());
app.use('/company/:companyId',(req,res,next)=>{
 if(!member)return res.sendStatus(403);
 req.session={role,uid:1};next();
},requireConfiguredModule(async()=>company));
app.use('/company/:companyId/barber',barberRouter(db));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const url=`http://127.0.0.1:${server.address().port}/company/A/barber`;
test.after(()=>server.close());
const post=path=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});

test('barbería exige permisos y módulo correcto; sin servicio activo no escribe',async()=>{
 assert.equal((await fetch(url)).status,200);
 assert.equal((await post('')).status,403);
 assert.equal((await post('/appointment')).status,403);
 member=false;assert.equal((await fetch(url)).status,403);
 member=true;company.modules={salud:true};assert.equal((await fetch(url)).status,403);
 company.modules={barberias:true};company.service_state='PAUSED';edit=true;operate=true;
 assert.equal((await post('')).status,403);assert.equal((await post('/appointment')).status,403);assert.equal(writes,0);
});

test('solo SUPERADMIN configura barbería; operador conserva la gestión de turnos',async()=>{
 company={modules:{barberias:true},service_state:'ACTIVE'};
 member=true;role='ADMIN_EMPRESA';edit=true;operate=true;
 const config=await (await fetch(url)).json();
 assert.equal(config.canEdit,false);
 assert.equal(config.canOperate,true);
 assert.equal((await post('')).status,403);
 assert.notEqual((await post('/appointment')).status,403,'operate debe pasar el control de acceso');

 operate=false;
 assert.equal((await post('/appointment')).status,403);
 role='SUPERADMIN';
 const superConfig=await (await fetch(url)).json();
 assert.equal(superConfig.canEdit,true);
 assert.equal(superConfig.canOperate,true);
 assert.notEqual((await post('')).status,403,'solo la validación de datos, no el permiso, puede rechazar esta solicitud');
});
