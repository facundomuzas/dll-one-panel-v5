import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initBusinessAdmin,readBusinessAdmin,changeBusinessAdmin,businessRuntime,businessLogo} from '../src/business_admin.js';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

const company={company_id:'A',phone_number_id:'111',config:{}};
const branch={nombre:'Centro',direccion:'Nueva 123',telefono:'',horarios:'9 a 18',mapsUrl:'https://maps.google.com/',orden:1,activa:true,retiroHabilitado:true,principal:true};
test('administración por empresa con SQL real: migración, revisiones, bajas, estilo y logo',async()=>{
 const pg=new PGlite();const db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
 try{
 await pg.exec('CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY); CREATE TABLE panel_native_companies(company_id TEXT,runtime JSONB); CREATE TABLE panel_motor_snapshot(snapshot JSONB); INSERT INTO panel_companies VALUES (\'A\'),(\'B\');');
 await initBusinessAdmin(db);
 await pg.query('INSERT INTO panel_motor_snapshot VALUES ($1)',[JSON.stringify({empresas:[{idEmpresa:'A',phoneNumberId:'111',context:{sucursales:[{...branch,nombre:'Anterior'}],secret:'NO_EXPOSE'}}]})]);
 const initial=await readBusinessAdmin(db,company);assert.equal(initial.branchesNative,false);assert.equal(initial.branches[0].nombre,'Anterior');assert.doesNotMatch(JSON.stringify(initial),/NO_EXPOSE/);
 let state=await changeBusinessAdmin(db,company,{revision:0,action:'branches-import'});assert.equal(state.branchesNative,true);
 state=await changeBusinessAdmin(db,company,{revision:1,action:'branch-save',branch:{...state.branches[0],activa:false}});
 assert.deepEqual((await businessRuntime(db,company)).branches,[]);
 await pg.query('UPDATE panel_motor_snapshot SET snapshot=$1',[JSON.stringify({empresas:[]})]);
 assert.equal((await readBusinessAdmin(db,company)).branches[0].activa,false);
 await assert.rejects(changeBusinessAdmin(db,company,{revision:1,action:'branch-save',branch}),/otra sesión/);
 assert.equal((await readBusinessAdmin(db,company)).revision,2);
 state=await changeBusinessAdmin(db,company,{revision:2,action:'branch-save',branch});
 state=await changeBusinessAdmin(db,company,{revision:3,action:'branch-save',branch:{...branch,nombre:'Segundo'}});
 assert.equal(state.branches.filter(b=>b.principal).length,1);
 const other={company_id:'B',phone_number_id:'222',config:{}};
 await assert.rejects(changeBusinessAdmin(db,other,{revision:0,action:'branch-save',branch:{...branch,idSucursal:state.branches[1].idSucursal}}),/no pertenece/);
 assert.equal((await readBusinessAdmin(db,other)).revision,0);
 for(const mapsUrl of ['javascript:alert(1)','https://user:password@example.com'])await assert.rejects(changeBusinessAdmin(db,company,{revision:4,action:'branch-save',branch:{...branch,mapsUrl}}));
 await assert.rejects(changeBusinessAdmin(db,company,{revision:4,action:'style-save',style:{personalidad:'HACK',energia:200,cierre:'ALTA'}}));
 const style={personalidad:'INFORMATIVA',energia:20,cierre:'BAJA'};
 state=await changeBusinessAdmin(db,company,{revision:4,action:'style-save',style});assert.deepEqual((await businessRuntime(db,company)).style,style);
 for(const mime of ['image/svg+xml','text/html'])await assert.rejects(changeBusinessAdmin(db,company,{revision:5,action:'logo-upload',mime,base64:'PHN2Zz4='}));
 await assert.rejects(changeBusinessAdmin(db,company,{revision:5,action:'logo-upload',mime:'image/png',base64:Buffer.from('<script>alert(1)</script>').toString('base64')}));
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 state=await changeBusinessAdmin(db,company,{revision:5,action:'logo-upload',mime:'image/png',base64:png,name:'Logo.png'});
 assert.equal(state.logo.available,true);assert.equal(Buffer.from((await businessLogo(db,'A')).logo_data).toString('base64'),png);assert.equal(await businessLogo(db,'B'),null);
 state=await changeBusinessAdmin(db,company,{revision:6,action:'logo-remove'});assert.equal(state.logo.available,false);
 }finally{await pg.close();}
});

const source=readFileSync(new URL('../public/business_admin.js',import.meta.url),'utf8');
const payload=id=>({companyId:id,revision:0,branchesNative:true,branches:[{...branch,nombre:'<img src=x onerror=alert(1)>'}],style:{personalidad:'COMERCIAL',energia:75,cierre:'ALTA'},logo:{available:false},canEdit:true});
test('UI: respuestas tardías, borradores por empresa, lectura y texto sin HTML',async()=>{
 const dom=new JSDOM('<div id="businessAdmin"></div>',{runScripts:'outside-only',url:'https://panel.example/'});
 const w=dom.window;w.companyId='A';w.$=id=>w.document.getElementById(id);w.confirm=()=>true;
 const requests=[];w.api=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));w.eval(source);
 const a=w.loadBusinessAdmin();w.companyId='B';const b=w.loadBusinessAdmin();
 requests[1].resolve(payload('B'));await b;requests[0].resolve(payload('A'));await a;
 assert.match(w.$('adminBranchesList').textContent,/<img/);assert.equal(w.$('adminBranchesList').querySelector('img'),null);
 w.$('adminBranchName').value='Borrador B';w.$('adminBranchName').dispatchEvent(new w.Event('input'));
 w.companyId='A';const reload=w.loadBusinessAdmin();assert.equal(w.$('adminBranchName').value,'');requests[2].resolve({...payload('A'),canEdit:false});await reload;
 assert.equal(w.$('adminBranchFields').disabled,true);
 w.companyId='B';await w.loadBusinessAdmin();assert.equal(w.$('adminBranchName').value,'Borrador B');
 const saving=w.saveBusinessAdmin('branch-save',{branch});requests[3].reject(Error('Conflicto'));await saving;
 assert.equal(w.$('adminBranchName').value,'Borrador B');assert.match(w.$('businessAdminStatus').textContent,/borrador se conserva/);
 dom.window.close();
});
