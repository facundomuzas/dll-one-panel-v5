import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {changeUserAccess,authenticatedBootstrapRecovery,registerUserAccessRoutes} from '../src/user_access.js';

process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
process.env.JWT_SECRET='bootstrap-recovery-test-long-jwt-signing-secret-2026';
process.env.PANEL_ADMIN_USER='bootstrap@example.test';
process.env.PANEL_ADMIN_PASSWORD='TestPrincipalPassword_2026';
const {pool}=await import('../src/db.js');
const {validLogin,issueSession,authRequired}=await import('../src/auth.js');

const db=new PGlite();
await db.exec(`
CREATE TABLE panel_users(
 user_id BIGINT PRIMARY KEY,login_key TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,role TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
 session_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE panel_user_companies(user_id BIGINT,company_id TEXT);
CREATE TABLE panel_companies(company_id TEXT,service_state TEXT);
CREATE TABLE orders(company_id TEXT,amount INT);
INSERT INTO orders VALUES('client-a',24000);
`);
await db.query('INSERT INTO panel_users(user_id,login_key,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)',[
 7,'delegate@example.test','Administrador de prueba',
 await bcrypt.hash('TestPassword_Del_2026',4),'SUPERADMIN'
]);
await db.query('INSERT INTO panel_users(user_id,login_key,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)',[
 8,'client@example.test','Cliente de prueba',
 await bcrypt.hash('TestPassword_Client_2026',4),'ADMIN_EMPRESA'
]);

pool.query=(...args)=>db.query(...args);
const database={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
const app=express();app.use(express.json(),cookieParser());
app.post('/test/login',async(req,res)=>{
 const user=await validLogin(req.body.user,req.body.password);
 if(!user)return res.status(401).json({ok:false});
 issueSession(res,user);
 res.json({ok:true,userId:user.userId,role:user.role});
});
app.get('/test/me',authRequired,(req,res)=>res.json({ok:true,uid:req.session.uid}));
registerUserAccessRoutes(app,{
 pool:database,authRequired,
 requireSuperadmin:(req,res,next)=>req.session.role==='SUPERADMIN'?next():res.sendStatus(403)
});
const server=await new Promise(resolve=>{const x=app.listen(0,'127.0.0.1',()=>resolve(x));});
const url=`http://127.0.0.1:${server.address().port}`;
const signIn=async(user,password)=>{
 const result=await fetch(url+'/test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user,password})});
 return {response:result,cookie:result.headers.get('set-cookie')?.split(';')[0]};
};
const request=async(cookie,method,path,body)=>fetch(url+path,{
 method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},
 body:body?JSON.stringify(body):undefined
});
after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});

test('bootstrap helper requires verified signed-in account identity and configured credentials',()=>{
 const env={PANEL_ADMIN_USER:'bootstrap@example.test',PANEL_ADMIN_PASSWORD:'configured-elsewhere'};
 assert.equal(authenticatedBootstrapRecovery({uid:0,sub:'bootstrap@example.test',role:'SUPERADMIN'},env),true);
 for(const session of [
  {uid:7,sub:'bootstrap@example.test',role:'SUPERADMIN'},
  {uid:0,sub:'bootstrap@example.test',role:'ADMIN_EMPRESA'},
  {uid:0,sub:'different@example.test',role:'SUPERADMIN'},
  {uid:8,sub:'client@example.test',role:'ADMIN_EMPRESA'},
  {}
 ]) assert.equal(authenticatedBootstrapRecovery(session,env),false);
 assert.equal(authenticatedBootstrapRecovery({uid:0,sub:'bootstrap@example.test',role:'SUPERADMIN'},{}),false);
});

test('real authenticated Railway bootstrap session can suspend the sole database superadmin and reactivate it',async()=>{
 const bootstrap=await signIn('bootstrap@example.test','TestPrincipalPassword_2026');
 assert.equal(bootstrap.response.status,200);
 assert.deepEqual(await bootstrap.response.json(),{ok:true,userId:0,role:'SUPERADMIN'});
 const delegate=await signIn('delegate@example.test','TestPassword_Del_2026');
 assert.equal(delegate.response.status,200);
 const suspended=await request(bootstrap.cookie,'POST','/api/admin/users/7/active',{active:false});
 assert.equal(suspended.status,200,await suspended.text());
 assert.equal((await db.query('SELECT active,session_version FROM panel_users WHERE user_id=7')).rows[0].active,false);
 assert.equal((await request(delegate.cookie,'GET','/test/me')).status,401);
 assert.equal((await request(bootstrap.cookie,'GET','/test/me')).status,200);
 const restored=await request(bootstrap.cookie,'POST','/api/admin/users/7/active',{active:true});
 assert.equal(restored.status,200,await restored.text());
 assert.equal((await db.query('SELECT active,session_version FROM panel_users WHERE user_id=7')).rows[0].session_version,2);
 assert.equal((await request(delegate.cookie,'GET','/test/me')).status,401,'old delegated JWT stays revoked');
 const fresh=await signIn('delegate@example.test','TestPassword_Del_2026');
 assert.equal(fresh.response.status,200);
 assert.equal((await request(fresh.cookie,'GET','/test/me')).status,200);
 assert.equal((await db.query('SELECT amount FROM orders')).rows[0].amount,24000);
});

test('ordinary delegated SUPERADMIN cannot suspend itself, or delete the last active DB superadmin',async()=>{
 const delegate=await signIn('delegate@example.test','TestPassword_Del_2026');
 assert.equal(delegate.response.status,200);
 assert.equal((await request(delegate.cookie,'POST','/api/admin/users/7/active',{active:false})).status,400);
 assert.equal((await request(delegate.cookie,'DELETE','/api/admin/users/7')).status,400);
 await assert.rejects(changeUserAccess(database,{actorId:99,userId:7,active:false}),/último superadministrador/);
 await assert.rejects(changeUserAccess(database,{actorId:99,userId:7,active:false,bootstrapRecovery:true}),/último superadministrador/);
 assert.equal((await db.query('SELECT active FROM panel_users WHERE user_id=7')).rows[0].active,true);
});

test('unauthenticated or client sessions can never suspend the last DB superadmin',async()=>{
 const client=await signIn('client@example.test','TestPassword_Client_2026');
 assert.equal(client.response.status,200);
 assert.equal((await request('', 'POST','/api/admin/users/7/active',{active:false})).status,401);
 assert.equal((await request(client.cookie,'POST','/api/admin/users/7/active',{active:false})).status,403);
 assert.equal((await db.query('SELECT active FROM panel_users WHERE user_id=7')).rows[0].active,true);
});

test('bootstrap admin UI shows suspension for sole delegated superadmin; normal admins stay protected',async()=>{
 const dom=new JSDOM('<section id="users"></section>',{runScripts:'outside-only'});
 try{
  dom.window.eval(await readFile(new URL('../public/admin-users.js',import.meta.url),'utf8'));
  dom.window.confirm=()=>true;
  const calls=[];
  const user={user_id:7,login_key:'delegate@example.test',role:'SUPERADMIN',active:true,companies:[]};
  const render=currentUser=>dom.window.renderAdminUsers(dom.window.document.querySelector('#users'),[user],{
   currentUser,companies:[],notify:()=>{},reload:async()=>{},
   api:async(...args)=>{calls.push(args);return {ok:true};}
  });
  render({userId:0,role:'SUPERADMIN'});
  let buttons=[...dom.window.document.querySelectorAll('button')];
  assert.ok(buttons.some(b=>b.textContent==='Suspender usuario'));
  assert.ok(buttons.some(b=>b.textContent==='Eliminar usuario'));
  buttons.find(b=>b.textContent==='Suspender usuario').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0][0],'/api/admin/users/7/active');
  assert.deepEqual(JSON.parse(calls[0][1].body),{active:false});
  render({userId:7,role:'SUPERADMIN'});
  buttons=[...dom.window.document.querySelectorAll('button')];
  assert.ok(!buttons.some(b=>b.textContent==='Suspender usuario'),'own account protected');
  render({userId:99,role:'SUPERADMIN'});
  buttons=[...dom.window.document.querySelectorAll('button')];
  assert.ok(!buttons.some(b=>b.textContent==='Suspender usuario'),'normal DB admin cannot suspend last active');
  assert.match(dom.window.document.querySelector('#users').textContent,/cuenta principal de emergencia/i);
  render({userId:0,role:'ADMIN_EMPRESA'});
  buttons=[...dom.window.document.querySelectorAll('button')];
  assert.ok(!buttons.some(b=>b.textContent==='Suspender usuario'));
 }finally{dom.window.close();}
});
