import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Exercise the actual SELECT in db.js with PostgreSQL semantics, not an SQL mock.
const source=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
const first=source.indexOf('export async function listCompaniesForUser(');
const last=source.indexOf('export async function getCompany(',first);
assert.ok(first>=0&&last>first);
const implementation=source.slice(first,last).replace(/^export /,'');
const db=new PGlite();
await db.exec(`CREATE TABLE panel_users(user_id INT PRIMARY KEY,active BOOLEAN);
 CREATE TABLE panel_companies(
  company_id TEXT PRIMARY KEY,
  company_name TEXT,phone_number_id TEXT,modules JSONB,
  source_version TEXT,synced_at TIMESTAMPTZ,service_state TEXT
 );
 CREATE TABLE panel_user_companies(user_id INT,company_id TEXT,permissions JSONB);
 INSERT INTO panel_users VALUES(1,TRUE),(2,FALSE);
 INSERT INTO panel_companies(company_id,company_name,service_state) VALUES
  ('A','Almacén permitido','ACTIVE'),
  ('B','Empresa sin visualización','ACTIVE'),
  ('C','Empresa suspendida','SUSPENDED'),
  ('D','Empresa pausada','PAUSED'),
  ('E','Empresa archivada','ARCHIVED'),
  ('F','Empresa de otro usuario','ACTIVE'),
  ('G','Empresa con permisos vacíos','ACTIVE');
 INSERT INTO panel_user_companies VALUES
  (1,'A','{"view":true,"operate":true}'),
  (1,'B','{"view":false,"operate":true}'),
  (1,'C','{"view":true}'),
  (1,'D','{"view":true}'),
  (1,'E','{"view":true}'),
  (2,'F','{"view":true}'),
  (1,'G','{}');`);
const pool={query:(...args)=>db.query(...args)};
const listCompaniesForUser=new Function('pool','listCompanies',implementation+'\nreturn listCompaniesForUser;')(pool,async()=>[{company_id:'A'},{company_id:'B'}]);
test.after(()=>db.close());

test('selector omite empresas con view=false, suspendidas, archivadas y sin asignación',async()=>{
 const rows=await listCompaniesForUser(1,'ADMIN_EMPRESA');
 assert.deepEqual(rows.map(r=>r.company_id),['A','G','D']);
});

test('revocar y restablecer view afecta al selector sin reiniciar la sesión',async()=>{
 await db.query("UPDATE panel_user_companies SET permissions='{\"view\":false}' WHERE user_id=1 AND company_id='A'");
 let visible=(await listCompaniesForUser(1,'OPERADOR')).map(r=>r.company_id);
 assert.ok(!visible.includes('A'));
 await db.query("UPDATE panel_user_companies SET permissions='{\"view\":true}' WHERE user_id=1 AND company_id='A'");
 visible=(await listCompaniesForUser(1,'OPERADOR')).map(r=>r.company_id);
 assert.ok(visible.includes('A'));
});

test('desactivar un usuario anula todo el selector y SUPERADMIN conserva vista general',async()=>{
 assert.deepEqual(await listCompaniesForUser(2,'ADMIN_EMPRESA'),[]);
 await db.query('UPDATE panel_users SET active=FALSE WHERE user_id=1');
 assert.deepEqual(await listCompaniesForUser(1,'ADMIN_EMPRESA'),[]);
 assert.deepEqual((await listCompaniesForUser(0,'SUPERADMIN')).map(r=>r.company_id),['A','B']);
});
