import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import express from 'express';
import bcrypt from 'bcryptjs';
import {readFile} from 'node:fs/promises';
import {resetUserPassword,registerPasswordResetRoutes,validateNewPassword} from '../src/password_reset.js';

const db=new PGlite();
await db.exec(`CREATE TABLE panel_users (
 user_id BIGINT PRIMARY KEY,login_key TEXT NOT NULL,
 role TEXT NOT NULL,active BOOLEAN NOT NULL,
 password_hash TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE panel_user_security_log (
 id BIGSERIAL PRIMARY KEY,actor_user_id BIGINT,target_user_id BIGINT,
 action TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO panel_users(user_id,login_key,role,active,password_hash)
 VALUES (1,'root','SUPERADMIN',TRUE,'old-hash'),
        (2,'new-superadmin','SUPERADMIN',TRUE,'old-hash'),
        (3,'operator','OPERADOR',TRUE,'old-hash'),
        (4,'suspended','ADMIN_EMPRESA',FALSE,'old-hash');`);
const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
test.after(()=>db.close());

test('another superadmin can recover an account; hashing and audit omit plaintext',async()=>{
 const pass='UnaClaveDistinta_2026';
 const result=await resetUserPassword(pool,{actorId:1,userId:2,newPassword:pass});
 assert.deepEqual(result,{ok:true,userId:2,sessionsRevoked:true,active:true});
 const {rows}=await db.query('SELECT password_hash,session_version FROM panel_users WHERE user_id=2');
 assert.equal(rows[0].session_version,1);
 assert.notEqual(rows[0].password_hash,pass);
 assert.equal(await bcrypt.compare(pass,rows[0].password_hash),true);
 assert.equal((await db.query('SELECT actor_user_id,target_user_id,action FROM panel_user_security_log')).rows[0].action,'RESET_PASSWORD');
 const serialized=JSON.stringify((await db.query('SELECT * FROM panel_user_security_log')).rows);
 assert.ok(!serialized.includes(pass));
});

test('reset of a suspended user does not reactivate the user',async()=>{
 const r=await resetUserPassword(pool,{actorId:1,userId:4,newPassword:'ClaveSegura_Larga2026'});
 assert.equal(r.active,false);
 assert.equal((await db.query('SELECT active,session_version FROM panel_users WHERE user_id=4')).rows[0].session_version,1);
});

test('invalid actor, short password, oversized bcrypt password, self-reset and nonexistent user fail closed',async()=>{
 for(const args of [
  {actorId:1,userId:1,newPassword:'ClaveSegura_Larga2026'},
  {actorId:1,userId:0,newPassword:'ClaveSegura_Larga2026'},
  {actorId:1,userId:999,newPassword:'ClaveSegura_Larga2026'},
  {actorId:-1,userId:3,newPassword:'ClaveSegura_Larga2026'},
  {actorId:1,userId:3,newPassword:'short'},
  {actorId:1,userId:3,newPassword:'😀'.repeat(20)}
 ]) await assert.rejects(resetUserPassword(pool,args));
 assert.equal((await db.query('SELECT session_version FROM panel_users WHERE user_id=3')).rows[0].session_version,0);
 assert.throws(()=>validateNewPassword(null),/contraseña nueva/);
});

test('reset endpoint requires active SUPERADMIN session and rejects read-only users',async()=>{
 let called=0;
 const app=express();app.use(express.json());
 registerPasswordResetRoutes(app,{pool:{connect(){called++;throw Error('unexpected');}},
 authRequired:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={uid:1,role:req.headers.authorization};next();},
 requireSuperadmin:(req,res,next)=>req.session.role==='SUPERADMIN'?next():res.sendStatus(403)});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  for(const role of ['', 'ADMIN_EMPRESA','OPERADOR']){
   const res=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/2/password`,{
    method:'POST',headers:{'content-type':'application/json',...(role?{authorization:role}:{})},
    body:JSON.stringify({newPassword:'ClaveSegura_Larga2026'})
   });
   assert.equal(res.status,role?403:401);
  }
  assert.equal(called,0);
 } finally{await new Promise(resolve=>server.close(resolve));}
});

test('admin UI supports safe reset of other superadmins without showing saved passwords',async()=>{
 const html=await readFile(new URL('../public/admin-users.js',import.meta.url),'utf8');
 const dom=new JSDOM('<div id="users"></div>',{runScripts:'outside-only'});
 dom.window.eval(html);
 const calls=[],notices=[];
 dom.window.confirm=()=>true;
 dom.window.renderAdminUsers(dom.window.document.getElementById('users'),[
  {user_id:1,login_key:'root',role:'SUPERADMIN',active:true,companies:[]},
  {user_id:2,login_key:'brother@example.com',role:'SUPERADMIN',active:true,companies:[]},
  {user_id:3,login_key:'worker',role:'OPERADOR',active:true,companies:[]}
 ],{currentUser:{userId:1},companies:[],api:async(...args)=>{calls.push(args);return {ok:true};},reload:async()=>{},notify:x=>notices.push(x)});
 const rows=dom.window.document.querySelectorAll('.data-row');
 assert.equal([...rows[0].querySelectorAll('button')].some(b=>b.textContent==='Restablecer contraseña'),false);
 const button=[...rows[1].querySelectorAll('button')].find(b=>b.textContent==='Restablecer contraseña');
 assert.ok(button);
 assert.equal(rows[1].querySelector('form').hidden,true);
 button.click();assert.equal(button.getAttribute('aria-expanded'),'true');
 const [password,confirmation]=rows[1].querySelectorAll('input[type=password]');
 password.value='ClaveSegura_Nueva2026';confirmation.value='ClaveSegura_Nueva2026';
 rows[1].querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'/api/admin/users/2/password');
 assert.equal(calls[0][1].method,'POST');
 assert.deepEqual(JSON.parse(calls[0][1].body),{newPassword:'ClaveSegura_Nueva2026'});
 assert.equal(password.value,'');assert.equal(confirmation.value,'');
 assert.equal(button.getAttribute('aria-expanded'),'false');
 assert.match(notices[0],/sesiones anteriores/i);
 assert.ok(!rows[1].textContent.includes('ClaveSegura_Nueva2026'));
 dom.window.close();
});

test('admin UI refuses mismatched password confirmation and does not call the API',async()=>{
 const dom=new JSDOM('<div id="users"></div>',{runScripts:'outside-only'});
 dom.window.eval(await readFile(new URL('../public/admin-users.js',import.meta.url),'utf8'));
 let calls=0;dom.window.confirm=()=>true;
 dom.window.renderAdminUsers(dom.window.document.querySelector('#users'),[
  {user_id:2,login_key:'worker',role:'OPERADOR',active:true,companies:[]}
 ],{currentUser:{userId:1},companies:[],api:async()=>calls++,reload:async()=>{},notify:()=>{}});
 const open=[...dom.window.document.querySelectorAll('button')].find(x=>x.textContent==='Restablecer contraseña');
 open.click();
 const inputs=dom.window.document.querySelectorAll('input[type=password]');
 inputs[0].value='ClaveSegura_Nueva2026';inputs[1].value='ClaveDistinta_2026';
 const form=dom.window.document.querySelector('form');
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,0);assert.match(form.textContent,/no coinciden/);
 dom.window.close();
});
