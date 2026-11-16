import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {eventsRouter} from '../src/events_routes.js';

let role='ADMIN_EMPRESA',member=true,view=true,edit=false,operate=false,active=true,writes=0;
const db={async query(sql){
 if(sql.includes('panel_user_companies'))return {rows:member?[{permissions:{view,editCatalog:edit,operate}}]:[]};
 if(!/^SELECT\s/i.test(sql))writes++;
 return {rows:[]};
}};
const app=express();app.use(express.json());
app.use('/company/:companyId',(req,_res,next)=>{
 req.session={uid:1,role,sub:'test-operator'};
 req.moduleCompany={service_state:active?'ACTIVE':'SUSPENDED',company_name:'Prueba'};
 next();
});
app.use('/company/:companyId/events',eventsRouter(db));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
test.after(()=>new Promise(resolve=>server.close(resolve)));
const url=`http://127.0.0.1:${server.address().port}/company/A/events`;
const post=path=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
const reset=()=>{role='ADMIN_EMPRESA';member=true;view=true;edit=false;operate=false;active=true;};

test('Eventos rejects users with view denied and separates editing from operating',async()=>{
 reset();const start=writes;
 assert.equal((await post('')).status,403);
 assert.equal((await post('/event-1/attendees')).status,403);
 assert.equal(writes,start);
 edit=true;view=false;
 assert.equal((await fetch(url)).status,403);
 assert.equal((await post('')).status,403);
 view=true;edit=false;operate=true;
 assert.equal((await post('')).status,403,'operate does not grant event creation');
 const output=await (await fetch(url)).json();
 assert.equal(output.permissions.manage,false);
 assert.equal(output.permissions.operate,true);
 operate=false;member=false;
 assert.equal((await post('/event-1/attendees')).status,403);
 assert.equal(writes,start);
});

test('suspended events deny write operations even to superadmin',async()=>{
 reset();role='SUPERADMIN';active=false;
 const start=writes;
 assert.equal((await post('')).status,403);
 assert.equal((await post('/event-1/attendees')).status,403);
 assert.equal(writes,start);
});
