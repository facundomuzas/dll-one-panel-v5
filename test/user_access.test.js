import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {changeUserAccess,registerUserAccessRoutes} from '../src/user_access.js';

test('revocation preserves unrelated memberships and business data; protected accounts and strict inputs',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE panel_users(user_id int PRIMARY KEY,role text,active boolean,session_version integer NOT NULL DEFAULT 0,updated_at timestamptz);
 CREATE TABLE panel_user_companies(user_id int,company_id text,PRIMARY KEY(user_id,company_id));
 CREATE TABLE panel_companies(company_id text,service_state text);
 INSERT INTO panel_companies VALUES('A','ACTIVE'),('C','ARCHIVED');
 CREATE TABLE orders(company_id text,amount int);
 INSERT INTO panel_users(user_id,role,active,updated_at) VALUES(1,'SUPERADMIN',true,now()),(2,'ADMIN_EMPRESA',true,now()),(3,'OPERADOR',true,now());
 INSERT INTO panel_user_companies VALUES(2,'A'),(2,'B');INSERT INTO orders VALUES('A',100);`);
 const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 try {
  for(const input of [{userId:0,active:false},{userId:2,active:'false'},{userId:1,active:false},{userId:3,actorId:3,active:false},{userId:99,active:false}])
   await assert.rejects(changeUserAccess(pool,{actorId:1,...input}));
  await changeUserAccess(pool,{userId:2,actorId:1,companyId:'A'});
  assert.deepEqual((await db.query('SELECT * FROM panel_user_companies')).rows,[{user_id:2,company_id:'B'}]);
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,1);
  await changeUserAccess(pool,{userId:2,actorId:1,active:false});
  assert.equal((await db.query('SELECT active,session_version FROM panel_users WHERE user_id=2')).rows[0].active,false);
  assert.equal((await db.query('SELECT session_version FROM panel_users WHERE user_id=2')).rows[0].session_version,1);
  await changeUserAccess(pool,{userId:2,actorId:1,active:true});
  assert.equal((await db.query('SELECT active FROM panel_users WHERE user_id=2')).rows[0].active,true);
  assert.equal((await db.query('SELECT session_version FROM panel_users WHERE user_id=2')).rows[0].session_version,2);
  assert.equal((await db.query('SELECT * FROM panel_user_companies')).rows.length,1);
  await changeUserAccess(pool,{userId:2,actorId:1,companyId:'A',restore:true});
  await changeUserAccess(pool,{userId:2,actorId:1,companyId:'A',restore:true});
  assert.equal((await db.query('SELECT * FROM panel_user_companies')).rows.length,2);
  await assert.rejects(changeUserAccess(pool,{userId:2,actorId:1,companyId:'C',restore:true}));
  await assert.rejects(changeUserAccess(pool,{userId:1,actorId:0,remove:true}));
  await db.query("INSERT INTO panel_users(user_id,role,active,updated_at) VALUES (4,'SUPERADMIN',true,now())");
  await changeUserAccess(pool,{userId:4,actorId:1,remove:true});
  await changeUserAccess(pool,{userId:2,actorId:1,remove:true});
  assert.equal((await db.query('SELECT * FROM panel_users WHERE user_id=2')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM panel_user_companies')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM orders')).rows.length,1);
 }finally{await db.close();}
});

test('access mutation routes reject unauthenticated and company admin requests',async()=>{
 let touched=false;const app=express();app.use(express.json());
 registerUserAccessRoutes(app,{pool:{connect(){touched=true;throw Error('unexpected');}},
 authRequired:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={uid:1,role:req.headers.authorization};next();},
 requireSuperadmin:(req,res,next)=>req.session.role==='SUPERADMIN'?next():res.sendStatus(403)});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try {
  for(const [method,path] of [['POST','/api/admin/users/2/active'],['DELETE','/api/admin/users/2/companies/A'],['POST','/api/admin/users/2/companies/A'],['DELETE','/api/admin/users/2']]){
   for(const role of ['', 'ADMIN_EMPRESA','OPERADOR']){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:role?{Authorization:role}:{}});
    assert.equal(response.status,role?403:401);
   }
  }assert.equal(touched,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('UI removes only selected membership, confirms actions and protects superadmin',async()=>{
 const dom=new JSDOM('<div id="users"></div>',{runScripts:'outside-only'});
 dom.window.eval(await readFile(new URL('../public/admin-users.js',import.meta.url),'utf8'));
 const calls=[];let confirms=0;dom.window.confirm=()=>{confirms++;return true;};
 dom.window.renderAdminUsers(dom.window.document.querySelector('#users'),[
  {user_id:1,login_key:'root',role:'SUPERADMIN',active:true,companies:[]},
  {user_id:2,login_key:'<img onerror=alert(1)>',role:'ADMIN_EMPRESA',active:true,companies:[{companyId:'A'},{companyId:'B'}]},
  {user_id:3,login_key:'empty',role:'OPERADOR',active:false,companies:[]}
 ],{currentUser:{userId:1},companies:[{idEmpresa:'A',nombreEmpresa:'Empresa A'}],api:async(...args)=>calls.push(args),reload:async()=>{},notify:()=>{}});
 const rows=dom.window.document.querySelectorAll('.data-row');
 assert.equal(rows[0].querySelectorAll('button').length,0);assert.equal(dom.window.document.querySelector('img'),null);
 assert.match(rows[2].textContent,/Sin empresas asignadas/);
 rows[1].querySelector('button').click();await new Promise(r=>setImmediate(r));
 assert.equal(confirms,1);assert.equal(calls[0][0],'/api/admin/users/2/companies/A');assert.equal(calls[0][1].method,'DELETE');
 dom.window.confirm=()=>false;rows[1].querySelectorAll('button')[2].click();assert.equal(calls.length,1);
 dom.window.confirm=()=>true;
 const restore=[...rows[2].querySelectorAll('button')].find(b=>b.textContent.includes('Restablecer'));
 restore.click();await new Promise(r=>setImmediate(r));
 assert.equal(calls[1][0],'/api/admin/users/3/companies/A');assert.equal(calls[1][1].method,'POST');
 const remove=[...rows[2].querySelectorAll('button')].find(b=>b.textContent==='Eliminar usuario');
 remove.click();await new Promise(r=>setImmediate(r));assert.equal(calls[2][0],'/api/admin/users/3');assert.equal(calls[2][1].method,'DELETE');
 dom.window.close();
});
