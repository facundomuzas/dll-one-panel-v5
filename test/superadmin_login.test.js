import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {PGlite} from '@electric-sql/pglite';

process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
delete process.env.PANEL_ADMIN_USER;
delete process.env.PANEL_ADMIN_PASSWORD;
const {pool}=await import('../src/db.js');
const {validLogin}=await import('../src/auth.js');
const db=new PGlite();
const pass='ClaveUnicaLarga2026!';
await db.exec(`CREATE TABLE panel_users (
 user_id INTEGER PRIMARY KEY,login_key TEXT,display_name TEXT,password_hash TEXT,
 role TEXT,active BOOLEAN,session_version INTEGER DEFAULT 0,
 created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
);`);
await db.query(`INSERT INTO panel_users(user_id,login_key,display_name,password_hash,role,active)
 VALUES(51,'brother@example.com','Nombre visible',$1,'SUPERADMIN',TRUE)`,[await bcrypt.hash(pass,4)]);
pool.query=(...args)=>db.query(...args);
test.after(()=>db.close());

test('registered SUPERADMIN signs in with email regardless of casing and surrounding whitespace',async()=>{
 const user=await validLogin('  BROTHER@EXAMPLE.COM  ',pass);
 assert.equal(user?.role,'SUPERADMIN');
 assert.equal(user?.userId,51);
 assert.equal(user?.loginKey,'brother@example.com');
 assert.equal(user?.sessionVersion,0);
});

test('display name is not a login alias and a wrong password is rejected',async()=>{
 assert.equal(await validLogin('Nombre visible',pass),null);
 assert.equal(await validLogin('brother@example.com','clave equivocada'),null);
});

test('suspended superadministrator cannot log in even with correct credentials',async()=>{
 await db.query("UPDATE panel_users SET active=FALSE WHERE user_id=51");
 assert.equal(await validLogin('brother@example.com',pass),null);
});
