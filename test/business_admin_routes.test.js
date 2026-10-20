import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {businessAdminRouter} from '../src/business_admin_routes.js';
import {readFileSync} from 'node:fs';

test('router deniega escritura sin permiso y no consulta logo de otra empresa',async()=>{
 const queries=[];
 const db={async query(sql,args){queries.push({sql,args});if(sql.includes('panel_user_companies'))return {rows:[{permissions:{editBusiness:false}}]};return {rows:[]};},connect(){throw Error('No debería escribir');}};
 const app=express();app.use(express.json());
 // Simula el control global de pertenencia; el montaje real se verifica debajo.
 app.use('/api/company/:companyId',(req,res,next)=>{req.session={uid:1,role:'USER'};if(req.params.companyId!=='A')return res.sendStatus(403);next();});
 app.use('/api/company/:companyId/business-admin',businessAdminRouter(db,async()=>({company_id:'A',phone_number_id:'111'})));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const save=await fetch(base+'/api/company/A/business-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logo-remove',revision:0})});assert.equal(save.status,403);
  const before=queries.length;assert.equal((await fetch(base+'/api/company/B/business-admin/logo')).status,403);assert.equal(queries.length,before);
  const logo=await fetch(base+'/api/company/A/business-admin/logo');assert.equal(logo.status,404);assert.equal(logo.headers.get('cache-control'),'no-store');
 }finally{await new Promise(resolve=>server.close(resolve));}
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const mount=source.indexOf("app.use('/api/company/:companyId/business-admin'");
 assert.ok(mount>source.indexOf('  authRequired,\n  companyAccessRequired,\n  requireConfiguredModule(getCompany)'));
});
