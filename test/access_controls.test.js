import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import {readFile} from 'node:fs/promises';
import {requireCompanyOperation} from '../src/operation_access.js';

process.env.DATABASE_URL = 'postgres://unused:unused@localhost/unused';
process.env.JWT_SECRET = 'isolated-test-secret-never-production';
const {pool, userCanAccessCompany} = await import('../src/db.js');
const {validLogin, authRequired} = await import('../src/auth.js');
let user = {user_id:7, login_key:'operador', role:'ADMIN_EMPRESA', active:true};
let permissions = {view:true, operate:true};
let membership = true;
let service = 'ACTIVE';
let failDatabase = false;
pool.query = async (sql, args) => {
  if (failDatabase) throw Error('simulated database failure');
  if (sql.includes('service_state')) return {rows:service ? [{service_state:service}] : []};
  if (sql.includes('panel_user_companies')) {
    assert.equal(args[1], 'A');
    const allowed = membership && user?.active && args[0] === user.user_id;
    const viewFilter = sql.includes("permissions->>'view'");
    return {rows:allowed && (!viewFilter || permissions.view !== false) ? [{permissions}] : []};
  }
  if (sql.includes('FROM panel_users')) return {rows:user ? [user] : []};
  throw Error('unexpected SQL');
};

function reset() {
  delete process.env.PANEL_ADMIN_USER; delete process.env.PANEL_ADMIN_PASSWORD;
  user={user_id:7,login_key:'operador',role:'ADMIN_EMPRESA',active:true};
  permissions={view:true,operate:true};membership=true;service='ACTIVE';failDatabase=false;
}
function token(uid=7, role='ADMIN_EMPRESA', sub='operador') {
  return jwt.sign({uid,role,sub,policy:2},process.env.JWT_SECRET,{issuer:'DLL ONE Panel V5',expiresIn:3600});
}
let writes = 0;
const app=express();app.use(cookieParser());
app.post('/company/:companyId/action',authRequired,requireCompanyOperation(pool),(_req,res)=>{writes++;res.json({ok:true});});
app.get('/me',authRequired,(_req,res)=>res.json({ok:true}));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
after(()=>new Promise(resolve=>server.close(resolve)));
async function request(path,session,method='GET') {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:session?{Cookie:`dllone_panel_v5=${session}`}:{}});
}

test('bootstrap sin configurar o parcial nunca admite credenciales vacías',async()=>{
  reset();assert.equal(await validLogin('',''),null);
  process.env.PANEL_ADMIN_USER='admin';assert.equal(await validLogin('admin',''),null);
  delete process.env.PANEL_ADMIN_USER;process.env.PANEL_ADMIN_PASSWORD='secret';
  assert.equal(await validLogin('','secret'),null);
});
test('bootstrap configurado conserva acceso y rechaza contraseña equivocada',async()=>{
  reset();user=null;process.env.PANEL_ADMIN_USER='admin';process.env.PANEL_ADMIN_PASSWORD='secret';
  assert.equal((await validLogin('admin','secret')).role,'SUPERADMIN');
  assert.equal(await validLogin('admin','wrong'),null);
});
test('usuario de base de datos conserva login bcrypt',async()=>{
  reset();user.password_hash=await bcrypt.hash('test-password',4);
  assert.equal((await validLogin('operador','test-password')).userId,7);
  user.active=false;assert.equal(await validLogin('operador','test-password'),null);
});
test('sesión vigente se rechaza inmediatamente al desactivar usuario',async()=>{
  reset();const session=token();assert.equal((await request('/me',session)).status,200);
  user.active=false;assert.equal((await request('/me',session)).status,401);
});
test('cambio de rol, eliminación y cambio de identidad invalidan sesión',async()=>{
  for (const change of [()=>user.role='SUPERADMIN',()=>user=null,()=>user.login_key='otro']) {
    reset();const session=token();change();assert.equal((await request('/me',session)).status,401);
  }
});
test('bootstrap sólo admite identidad y rol configurados',async()=>{
  reset();process.env.PANEL_ADMIN_USER='admin';process.env.PANEL_ADMIN_PASSWORD='secret';
  assert.equal((await request('/me',token(0,'SUPERADMIN','admin'))).status,200);
  for(const session of [token(0,'ADMIN_EMPRESA','admin'),token(0,'SUPERADMIN','otro'),token(-1),token('7')]) {
    assert.equal((await request('/me',session)).status,401);
  }
  delete process.env.PANEL_ADMIN_PASSWORD;
  assert.equal((await request('/me',token(0,'SUPERADMIN','admin'))).status,401);
});
test('sin cookie y firma incorrecta no hay acceso',async()=>{
  reset();assert.equal((await request('/me')).status,401);
  assert.equal((await request('/me',token()+'x')).status,401);
});
test('operate=false, view=false o empresa ajena impiden ejecutar la operación',async()=>{
  for(const change of [()=>permissions.operate=false,()=>permissions.view=false,()=>membership=false]){
    reset();change();const before=writes;
    assert.equal((await request('/company/A/action',token(),'POST')).status,403);
    assert.equal(writes,before);
  }
});
test('operador autorizado conserva la operación',async()=>{
  reset();const before=writes;
  assert.equal((await request('/company/A/action',token(),'POST')).status,200);assert.equal(writes,before+1);
});
test('error de base de datos bloquea acceso y no ejecuta operación',async()=>{
  reset();failDatabase=true;const before=writes;
  assert.equal((await request('/company/A/action',token(),'POST')).status,401);assert.equal(writes,before);
});
test('acceso a empresa no admite uid cero con rol común ni permiso de vista negado',async()=>{
  reset();assert.equal(await userCanAccessCompany(0,'ADMIN_EMPRESA','A'),false);
  assert.equal(await userCanAccessCompany(7,'ADMIN_EMPRESA','A'),true);
  permissions.view=false;assert.equal(await userCanAccessCompany(7,'ADMIN_EMPRESA','A'),false);
  permissions.view=true;user.active=false;assert.equal(await userCanAccessCompany(7,'ADMIN_EMPRESA','A'),false);
});
test('empresa suspendida bloquea operador y archivada bloquea también administrador',async()=>{
  reset();service='SUSPENDED';assert.equal(await userCanAccessCompany(7,'ADMIN_EMPRESA','A'),false);
  assert.equal(await userCanAccessCompany(0,'SUPERADMIN','A'),true);
  service='ARCHIVED';assert.equal(await userCanAccessCompany(0,'SUPERADMIN','A'),false);
});
test('las cinco rutas operativas reales incluyen el control de permiso',async()=>{
  const src=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  for(const path of ['conversation/:clientId/take','conversation/:clientId/send','conversation/:clientId/return-bot','pedidos/:orderId/action','deliveryQuotes/:quoteId/quote']){
    assert.ok(src.includes(`"/api/company/:companyId/${path}",\n  authRequired, canOperate,`),path);
  }
});
