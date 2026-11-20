import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile} from 'node:fs/promises';

const serverSource=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
// Exercise the exact production registration code with isolated auth/DB doubles.
// No Railway, tenant or real customer data is touched.
const begin=serverSource.indexOf("app.get('/api/company/:companyId/gastro/settings'");
const end=serverSource.indexOf("app.get('/api/company/:companyId/gastro/menu/:id/preview'",begin);
assert.ok(begin>=0&&end>begin,'Gastro settings routes must be present in production');
const registration=serverSource.slice(begin,end);

let writes=0,reads=0,role='ADMIN_EMPRESA',canEditCatalog=true;
let operation='',companyId='';
const app=express();
app.use(express.json());
app.use('/api/company/:companyId',(req,res,next)=>{
  if(!req.headers['x-test-role'])return res.status(401).json({ok:false,error:'NO_AUTH'});
  req.session={uid:Number(req.headers['x-test-user-id']||7),role:String(req.headers['x-test-role'])};
  if(req.params.companyId!=='company-A'||req.session.uid===8)
    return res.status(403).json({ok:false,error:'NO_TENANT'});
  next();
});
const authRequired=(_req,_res,next)=>next();
const requireSuperadmin=(req,res,next)=>
  req.session.role==='SUPERADMIN'?next():res.status(403).json({ok:false,error:'NO_ADMIN'});
// This function models the existing editCatalog permission; a client may have
// all catalog permissions, but those must never unlock admin configuration.
const canEditGastro=(req,res,next)=>canEditCatalog?next():res.status(403).json({ok:false,error:'NO_EDIT_CATALOG'});
const getCompany=async id=>({company_id:id});
const ensureSettings=async()=>{reads++;return {revision:3,settings:{
 menu:{imagenes:[],auto:true},pagos:{items:[]},entrega:{zonas:[]}
}};};
const changeSettings=async (_pool,company,op)=>{writes++;operation=op;companyId=company.company_id;
  return {revision:4,settings:{menu:{imagenes:[]},pagos:{items:[]},entrega:{zonas:[]}}};
};
const pool={query(){throw Error('Unexpected DB call');}};
new Function('app','authRequired','requireSuperadmin','canEditGastro','getCompany','ensureSettings','changeSettings','pool',registration)(
  app,authRequired,requireSuperadmin,canEditGastro,getCompany,ensureSettings,changeSettings,pool
);
const listener=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${listener.address().port}`;
after(()=>new Promise(resolve=>listener.close(resolve)));
function req(method,path,userRole='ADMIN_EMPRESA',id=7){
 return fetch(base+path,{method,headers:{'content-type':'application/json','x-test-role':userRole,'x-test-user-id':String(id)},body:method==='GET'?undefined:JSON.stringify({revision:3,action:'config'})});
}

const mutations=[
 '/config','/payment','/payment/pay-1/toggle','/zone','/zone/zone-1/delete',
 '/menu/config','/menu/upload','/menu/image-1/toggle','/menu/image-1/move','/menu/image-1/delete'
];
const url=path=>'/api/company/company-A/gastro'+path;

test('client with editCatalog=true still cannot change any Gastro administrative setting',async()=>{
 for(const userRole of ['ADMIN_EMPRESA','OPERADOR']){
  canEditCatalog=true;
  const before=writes;
  for(const path of mutations){
    const response=await req('POST',url(path),userRole);
    assert.equal(response.status,403,userRole+' '+path);
  }
  assert.equal(writes,before,'No update operation may run on denial');
 }
});
test('clients see Gastro settings as read-only and the superadmin can edit',async()=>{
 for(const userRole of ['ADMIN_EMPRESA','OPERADOR']){
  const response=await req('GET',url('/settings'),userRole);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.canEdit,false,userRole);
  assert.equal(body.settingsRevision,3);
 }
 const admin=await req('GET',url('/settings'),'SUPERADMIN');
 assert.equal(admin.status,200);
 assert.equal((await admin.json()).canEdit,true);
 assert.ok(reads>=3);
});
test('an actual Super Admin can still update Gastro operational settings',async()=>{
 const before=writes;
 const response=await req('POST',url('/payment'),'SUPERADMIN');
 assert.equal(response.status,200,await response.text());
 assert.equal(writes,before+1);
 assert.equal(operation,'payment');
 assert.equal(companyId,'company-A');
});
test('missing session, forged company id or unauthorized tenant fails before any write',async()=>{
 const before=writes;
 let response=await fetch(base+url('/config'),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,401);
 response=await req('POST','/api/company/company-B/gastro/config','SUPERADMIN');
 assert.equal(response.status,403);
 response=await req('POST',url('/config'),'ADMIN_EMPRESA',8);
 assert.equal(response.status,403);
 assert.equal(writes,before);
});
test('client permission editCatalog does not imply administrative settings capability',async()=>{
 canEditCatalog=true;
 const client=await req('GET',url('/settings'),'ADMIN_EMPRESA');
 assert.equal((await client.json()).canEdit,false);
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/\$\('gSettingsFields'\)\.disabled=settingsRevision===null\|\|!gastroSettingsCanEdit/);
 assert.match(html,/gastroSettingsCanEdit=raw\.canEdit===true/);
});
