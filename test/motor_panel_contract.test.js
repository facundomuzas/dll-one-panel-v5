import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';

const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const from=source.indexOf("app.get('/motor/company/:companyId/service',");
const to=source.indexOf('app.get("/motor/company/:companyId/catalog"',from);
assert.ok(from>0&&to>from,'service and pickup must remain protected routes');
const app=express();
const companies={
 A:{company_id:'A',company_name:'Empresa A',phone_number_id:'111',service_state:'ACTIVE'},
 B:{company_id:'B',company_name:'Empresa B',phone_number_id:'222',service_state:'SUSPENDED'}
};
const getCompany=async id=>companies[id]||null;
const getVoiceSettings=async()=>({enabled:false});
const configuredModule=()=>true;
const getPickup=async(_db,company)=>({address:'Dirección solo '+company.company_id});
const businessRuntime=async(_db,company)=>({branchesNative:true,branches:[{name:company.company_name}]});
const authenticateMotorRequest=(req,res,next)=>req.headers['x-dll-one-key']==='test-only'?next():res.status(403).json({ok:false,error:'MOTOR_NOT_AUTHORIZED'});
new Function('app','authenticateMotorRequest','getCompany','getVoiceSettings','configuredModule','getPickup','businessRuntime','pool',source.slice(from,to))(app,authenticateMotorRequest,getCompany,getVoiceSettings,configuredModule,getPickup,businessRuntime,{});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
test.after(()=>new Promise(resolve=>server.close(resolve)));
const base=`http://127.0.0.1:${server.address().port}`;
const req=(path,key='test-only')=>fetch(base+path,{headers:{'x-dll-one-key':key}});

test('motor service response echoes the tenant and verifies its connected WhatsApp number',async()=>{
 let res=await req('/motor/company/A/service?phoneNumberId=111');
 assert.equal(res.status,200);
 let body=await res.json();
 assert.equal(body.companyId,'A');assert.equal(body.active,true);
 res=await req('/motor/company/A/service?phoneNumberId=222');
 body=await res.json();
 assert.equal(body.companyId,'A');assert.equal(body.active,false);
 res=await req('/motor/company/B/service?phoneNumberId=222');
 body=await res.json();
 assert.equal(body.companyId,'B');assert.equal(body.active,false);
});

test('pickup response is tenant bound; wrong WhatsApp number and invalid key fail closed',async()=>{
 let res=await req('/motor/company/A/pickup?phoneNumberId=111');
 let body=await res.json();
 assert.equal(res.status,200);assert.equal(body.companyId,'A');
 assert.equal(body.pickup.address,'Dirección solo A');
 res=await req('/motor/company/A/pickup?phoneNumberId=222');
 assert.equal(res.status,409);
 res=await req('/motor/company/A/pickup?phoneNumberId=111','invalid');
 assert.equal(res.status,403);
});
