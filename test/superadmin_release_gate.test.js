import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {changeUserAccess,registerUserAccessRoutes} from '../src/user_access.js';
import {resetUserPassword} from '../src/password_reset.js';

process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
process.env.JWT_SECRET='release-gate-superadmin-test-jwt-secret-2026';
delete process.env.PANEL_ADMIN_USER;
delete process.env.PANEL_ADMIN_PASSWORD;
const {pool}=await import('../src/db.js');
const {validLogin,issueSession,authRequired}=await import('../src/auth.js');

const db=new PGlite();
await db.exec(`
CREATE TABLE panel_users (
 user_id INT PRIMARY KEY,login_key TEXT NOT NULL,display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,role TEXT NOT NULL,active BOOLEAN NOT NULL,
 session_version INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE panel_user_companies (user_id INT,company_id TEXT,PRIMARY KEY(user_id,company_id));
CREATE TABLE panel_companies(company_id TEXT,service_state TEXT);
CREATE TABLE orders(company_id TEXT,amount INT);
CREATE TABLE panel_user_security_log (
 id BIGSERIAL PRIMARY KEY,actor_user_id BIGINT,target_user_id BIGINT,
 action TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO panel_companies VALUES ('A','ACTIVE'),('B','ACTIVE');
INSERT INTO orders VALUES ('A',24000),('B',16000);
INSERT INTO panel_user_companies VALUES (3,'A'),(3,'B');
`);
const credentials=[
 [1,'root@example.test','Principal','SUPERADMIN'],
 [2,'delegate@example.test','Delegado','SUPERADMIN'],
 [3,'client@example.test','Cliente','ADMIN_EMPRESA']
];
for(const [id,login,name,role] of credentials) {
 await db.query('INSERT INTO panel_users(user_id,login_key,display_name,password_hash,role,active) VALUES ($1,$2,$3,$4,$5,TRUE)',
  [id,login,name,await bcrypt.hash('ClaveDePrueba-Segura-2026',4),role]);
}
const database={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
pool.query=(...args)=>db.query(...args);

const app=express();app.use(cookieParser(),express.json());
app.post('/test-login',async(req,res)=>{
 const user=await validLogin(req.body.user,req.body.password);
 if(!user)return res.sendStatus(401);
 issueSession(res,user);res.json({ok:true,role:user.role});
});
app.get('/test-me',authRequired,(req,res)=>res.json({ok:true,uid:req.session.uid}));
const auth=(req,res,next)=>{if(!req.headers['x-test-role'])return res.sendStatus(401);req.session={uid:Number(req.headers['x-actor-id']||1),role:req.headers['x-test-role']};next();};
registerUserAccessRoutes(app,{pool:database,authRequired:auth,requireSuperadmin:(req,res,next)=>req.session.role==='SUPERADMIN'?next():res.sendStatus(403)});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});

test('Super Admin delegated email login, suspension and reactivation never resurrect previous JWT',async()=>{
 const login=await fetch(base+'/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'  DELEGATE@EXAMPLE.TEST ',password:'ClaveDePrueba-Segura-2026'})});
 assert.equal(login.status,200);
 assert.equal((await login.json()).role,'SUPERADMIN');
 const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const before=await fetch(base+'/test-me',{headers:{cookie}});assert.equal(before.status,200);
 await changeUserAccess(database,{userId:2,actorId:1,active:false});
 assert.equal((await fetch(base+'/test-me',{headers:{cookie}})).status,401,'suspension revokes access immediately');
 await changeUserAccess(database,{userId:2,actorId:1,active:true});
 assert.equal((await fetch(base+'/test-me',{headers:{cookie}})).status,401,'restoration must not revive a JWT issued before suspension');
 const afterLogin=await fetch(base+'/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'delegate@example.test',password:'ClaveDePrueba-Segura-2026'})});
 assert.equal(afterLogin.status,200);
 assert.equal((await fetch(base+'/test-me',{headers:{cookie:afterLogin.headers.get('set-cookie')?.split(';')[0]}})).status,200);
 assert.equal((await db.query('SELECT session_version FROM panel_users WHERE user_id=2')).rows[0].session_version,2);
});

test('last active superadmin and self are protected, but another superadmin is manageable',async()=>{
 await assert.rejects(changeUserAccess(database,{userId:1,actorId:1,active:false}),/propio acceso/);
 await assert.rejects(changeUserAccess(database,{userId:1,actorId:1,remove:true}),/propio acceso/);
 await assert.rejects(changeUserAccess(database,{userId:2,actorId:1,companyId:'A'}),/acceso global/);
 await assert.rejects(changeUserAccess(database,{userId:2,actorId:1,companyId:'A',restore:true}),/acceso global/);
 await changeUserAccess(database,{userId:2,actorId:1,active:false});
 await assert.rejects(changeUserAccess(database,{userId:1,actorId:0,active:false}),/último superadministrador/);
 await assert.rejects(changeUserAccess(database,{userId:1,actorId:0,remove:true}),/último superadministrador/);
 await changeUserAccess(database,{userId:2,actorId:1,active:true});
 await changeUserAccess(database,{userId:2,actorId:1,remove:true});
 assert.equal((await db.query('SELECT * FROM panel_users WHERE user_id=2')).rows.length,0);
 assert.equal((await db.query('SELECT * FROM orders')).rows.length,2,'business orders survive account deletion');
});

test('client revoke/restore is tenant-specific; reset password hashes and invalidates sessions',async()=>{
 await changeUserAccess(database,{userId:3,actorId:1,companyId:'A'});
 assert.deepEqual((await db.query('SELECT company_id FROM panel_user_companies WHERE user_id=3 ORDER BY company_id')).rows.map(x=>x.company_id),['B']);
 await changeUserAccess(database,{userId:3,actorId:1,companyId:'A',restore:true});
 assert.deepEqual((await db.query('SELECT company_id FROM panel_user_companies WHERE user_id=3 ORDER BY company_id')).rows.map(x=>x.company_id),['A','B']);
 const old=await fetch(base+'/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'client@example.test',password:'ClaveDePrueba-Segura-2026'})});
 assert.equal(old.status,200);const oldCookie=old.headers.get('set-cookie')?.split(';')[0];
 await resetUserPassword(database,{actorId:1,userId:3,newPassword:'ClaveDistinta-Nueva-2026'});
 assert.equal((await fetch(base+'/test-me',{headers:{cookie:oldCookie}})).status,401);
 const row=(await db.query('SELECT password_hash,session_version FROM panel_users WHERE user_id=3')).rows[0];
 assert.ok(await bcrypt.compare('ClaveDistinta-Nueva-2026',row.password_hash));
 assert.notEqual(row.password_hash,'ClaveDistinta-Nueva-2026');
 assert.equal((await db.query('SELECT action FROM panel_user_security_log')).rows[0].action,'RESET_PASSWORD');
 assert.equal((await db.query('SELECT * FROM orders')).rows.length,2);
});

test('user lifecycle HTTP endpoints block company admins and unauthenticated callers',async()=>{
 const requests=[
  ['POST','/api/admin/users/3/active',{active:false}],
  ['DELETE','/api/admin/users/3',undefined],
  ['POST','/api/admin/users/3/companies/A',undefined],
  ['DELETE','/api/admin/users/3/companies/A',undefined]
 ];
 for(const [method,path,body] of requests){
  for(const role of ['', 'ADMIN_EMPRESA','OPERADOR']){
   const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(role?{'x-test-role':role}:{})},body:body?JSON.stringify(body):undefined});
   assert.equal(response.status,role?403:401,path+' '+role);
  }
 }
});

test('Super Admin UI can manage another delegated SUPERADMIN, but not its own or the last active one',async()=>{
 const dom=new JSDOM('<section id="users"></section>',{runScripts:'outside-only'});
 try{
  dom.window.eval(await readFile(new URL('../public/admin-users.js',import.meta.url),'utf8'));
  const calls=[];dom.window.confirm=()=>true;
  const render=users=>dom.window.renderAdminUsers(dom.window.document.querySelector('#users'),users,{
   api:async(...args)=>{calls.push(args);return {ok:true};},
   reload:async()=>{},notify:()=>{},currentUser:{userId:1},companies:[]
  });
  render([
   {user_id:1,login_key:'root@example.test',role:'SUPERADMIN',active:true,companies:[]},
   {user_id:2,login_key:'delegate@example.test',role:'SUPERADMIN',active:true,companies:[]},
   {user_id:3,login_key:'employee@example.test',role:'ADMIN_EMPRESA',active:true,companies:[]}
  ]);
  const rows=[...dom.window.document.querySelectorAll('.data-row')];
  assert.equal(rows[0].querySelectorAll('button').length,0,'cannot alter own account');
  const labels=[...rows[1].querySelectorAll('button')].map(x=>x.textContent);
  assert.ok(labels.includes('Eliminar usuario'));
  assert.ok(labels.includes('Suspender usuario'));
  assert.ok(labels.includes('Restablecer contraseña'));
  const suspend=[...rows[1].querySelectorAll('button')].find(x=>x.textContent==='Suspender usuario');suspend.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0][0],'/api/admin/users/2/active');
  assert.deepEqual(JSON.parse(calls[0][1].body),{active:false});
  render([
   {user_id:1,login_key:'root@example.test',role:'SUPERADMIN',active:true,companies:[]},
   {user_id:2,login_key:'delegate@example.test',role:'SUPERADMIN',active:false,companies:[]}
  ]);
  const other=[...dom.window.document.querySelectorAll('.data-row')][1];
  assert.ok([...other.querySelectorAll('button')].some(x=>x.textContent==='Reactivar usuario'));
  assert.ok([...other.querySelectorAll('button')].some(x=>x.textContent==='Eliminar usuario'));
  render([{user_id:2,login_key:'last@example.test',role:'SUPERADMIN',active:true,companies:[]}]);
  const last=dom.window.document.querySelector('.data-row');
  assert.ok(![...last.querySelectorAll('button')].some(x=>/Suspender usuario|Eliminar usuario/.test(x.textContent)));
 }finally{dom.window.close();}
});
