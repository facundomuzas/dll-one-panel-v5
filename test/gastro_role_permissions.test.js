import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../public/gastro_migration.js',import.meta.url),'utf8');

test('Gastro distinguishes read-only, catalog editors and global administrators',async()=>{
 let view=true,edit=true,member=true,dbErrors=false;
 const pool={async query(sql,args){
   assert.match(sql,/panel_user_companies/);
   assert.deepEqual(args,[7,'A']);
   if(dbErrors)throw Error('database offline');
   return {rows:member?[{permissions:{view,editCatalog:edit}}]:[]};
 }};
 const begin=server.indexOf('async function gastroEditorAllowed(req){');
 const end=server.indexOf('app.get(\n  "/api/company/:companyId/gastro/bundle"',begin);
 assert.ok(begin>0&&end>begin,'permission function must be available');
 const {gastroEditorAllowed,canEditGastro}=new Function('pool',server.slice(begin,end)+'\nreturn {gastroEditorAllowed,canEditGastro};')(pool);
 const req={session:{role:'ADMIN_EMPRESA',uid:7},params:{companyId:'A'}};
 assert.equal(await gastroEditorAllowed(req),true);
 edit=false;assert.equal(await gastroEditorAllowed(req),false);
 edit=true;view=false;assert.equal(await gastroEditorAllowed(req),false);
 view=true;member=false;assert.equal(await gastroEditorAllowed(req),false);
 req.session.role='SUPERADMIN';assert.equal(await gastroEditorAllowed(req),true);
 req.session.role='ADMIN_EMPRESA';member=true;dbErrors=true;
 const response={statusCode:200,status(value){this.statusCode=value;return this;},json(payload){this.payload=payload;return this;}};
 let nextCalled=false;await canEditGastro(req,response,()=>{nextCalled=true;});
 assert.equal(response.statusCode,503);assert.equal(nextCalled,false);
});

test('migrations are server-side superadmin-only and absent from client navigation',()=>{
 for(const method of ['get','post'])
   assert.ok(server.includes("app."+method+"('/api/company/:companyId/gastro/migration',authRequired,requireSuperadmin,"),method);
 assert.match(migration,/if\(String\(currentUser\?\.role\|\|''\)\.toUpperCase\(\)!=='SUPERADMIN'\)return/);
 const d=new JSDOM(html).window.document;
 const card=d.getElementById('gMigrationStart').closest('.card');
 assert.ok(card.classList.contains('admin-only'));
 assert.ok(card.classList.contains('hidden-admin'));
});

test('Gastro read-only response does not enable commercial form controls',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 const w=dom.window;
 const start=html.indexOf('  let settingsRevision=null');
 const end=html.indexOf('  async function loadGastro(){',start);
 assert.ok(start>0&&end>start);
 w.eval("var gastroSettingsData={};var $=id=>document.getElementById(id);function renderGastroSettings(){};"+html.slice(start,end));
 w.acceptGastroSettings({settingsRevision:4,menu:{imagenes:[]},pagos:{items:[]},entrega:{zonas:[]},canEdit:false});
 assert.equal(w.document.getElementById('gSettingsFields').disabled,true);
 w.acceptGastroSettings({settingsRevision:4,menu:{imagenes:[]},pagos:{items:[]},entrega:{zonas:[]},canEdit:true});
 assert.equal(w.document.getElementById('gSettingsFields').disabled,false);
 assert.match(html,/\$\('gCatalogFields'\)\.disabled=!gastroCanEdit/);
 assert.match(html,/\$\('gSettingsFields'\)\.disabled=settingsRevision===null\|\|!gastroSettingsCanEdit/);
 dom.window.close();
});
