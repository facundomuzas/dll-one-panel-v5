import {randomUUID} from 'node:crypto';
import {decodeMedia} from './receipts.js';

export async function initBusinessAdmin(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS panel_business_admin (
    company_id TEXT PRIMARY KEY REFERENCES panel_companies(company_id),
    branches JSONB, style JSONB, logo_data BYTEA, logo_mime TEXT, logo_name TEXT,
    revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
const text=(value,max)=>{
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Texto inválido o demasiado largo.');
  return value.trim();
};
function flag(value) {if(typeof value!=='boolean')throw Error('Opción inválida.');return value;}
const legacyFlag=(value,fallback=true)=>value==null?fallback:value===true||['SI','TRUE','1'].includes(String(value).toUpperCase());
function safeMap(value) {
  const raw=text(value||'',1000);if(!raw)return '';
  let url;try{url=new URL(raw);}catch{throw Error('El enlace del mapa no es válido.');}
  if(url.protocol!=='https:'||url.username||url.password)throw Error('El mapa debe usar un enlace HTTPS sin credenciales.');
  return url.href;
}
export function validateBranch(input,id) {
  const nombre=text(input.nombre,150),direccion=text(input.direccion,500);
  if(!nombre||!direccion)throw Error('Completá el nombre y la dirección del local.');
  const orden=Number(input.orden);
  if(!Number.isInteger(orden)||orden<0||orden>9999)throw Error('El orden debe estar entre 0 y 9999.');
  return {idSucursal:id,nombre,direccion,telefono:text(input.telefono||'',80),horarios:text(input.horarios||'',500),mapsUrl:safeMap(input.mapsUrl),
    activa:flag(input.activa),retiroHabilitado:flag(input.retiroHabilitado),principal:flag(input.principal),orden};
}
export function validateStyle(input) {
  if(!['COMERCIAL','EQUILIBRADA','INFORMATIVA'].includes(input.personalidad)||!['ALTA','MEDIA','BAJA'].includes(input.cierre))throw Error('Estilo de respuesta inválido.');
  if(!Number.isInteger(input.energia)||input.energia<0||input.energia>100)throw Error('La energía debe estar entre 0 y 100.');
  return {personalidad:input.personalidad,energia:input.energia,cierre:input.cierre};
}
async function legacyData(db,company) {
  // Sólo se leen campos públicos de negocio, nunca tokens del runtime.
  const native=(await db.query(`SELECT runtime#>'{context,sucursales}' AS branches,
    runtime#>>'{context,personalidadIA}' AS personality,runtime#>>'{context,energiaIA}' AS energy
    FROM panel_native_companies WHERE company_id=$1 AND runtime->>'phoneNumberId'=$2`,[company.company_id,company.phone_number_id])).rows[0];
  const legacy=native||(await db.query(`SELECT e#>'{context,sucursales}' AS branches,
    e#>>'{context,personalidadIA}' AS personality,e#>>'{context,energiaIA}' AS energy
    FROM panel_motor_snapshot, jsonb_array_elements(snapshot->'empresas') e
    WHERE e->>'idEmpresa'=$1 AND e->>'phoneNumberId'=$2 LIMIT 1`,[company.company_id,company.phone_number_id])).rows[0]||{};
  const source=Array.isArray(legacy.branches)?legacy.branches:[];
  if(source.length>100)throw Error('Hay más de 100 locales sincronizados. Revisá la importación antes de continuar.');
  const branches=source.map((b,i)=>validateBranch({
    ...b,nombre:String(b.nombre||'Local '+(i+1)),direccion:String(b.direccion||''),telefono:String(b.telefono||''),horarios:String(b.horarios||''),
    activa:legacyFlag(b.activa),retiroHabilitado:legacyFlag(b.retiroHabilitado),principal:legacyFlag(b.principal,false),orden:Number(b.orden??i)
  },'LEGACY-'+i));
  // Un único principal; se conserva el orden del snapshot en los datos antiguos.
  let principal=false;for(const b of branches)if(b.principal){b.principal=!principal&&b.activa;principal=principal||b.principal;}
  const cfg=company.config||{};
  const personalidad=cfg.PERSONALIDAD_VENDEDOR||legacy.personality||'COMERCIAL';
  const energia=Number(cfg.NIVEL_ENERGIA_VENTAS??legacy.energy??75);
  const cierre=cfg.ORIENTACION_CIERRE||'ALTA';
  return {branches,style:{personalidad:['COMERCIAL','EQUILIBRADA','INFORMATIVA'].includes(personalidad)?personalidad:'COMERCIAL',energia:Number.isInteger(energia)&&energia>=0&&energia<=100?energia:75,cierre:['ALTA','MEDIA','BAJA'].includes(cierre)?cierre:'ALTA'}};
}
export async function readBusinessAdmin(db,company) {
  const row=(await db.query(`SELECT branches,style,revision,logo_mime,logo_name,(logo_data IS NOT NULL) AS has_logo
    FROM panel_business_admin WHERE company_id=$1`,[company.company_id])).rows[0];
  const legacy=row?.branches!=null&&row?.style!=null?{}:await legacyData(db,company);
  return {companyId:company.company_id,revision:row?.revision??0,branches:row?.branches??legacy.branches??[],branchesNative:row?.branches!=null,
    style:row?.style??legacy.style,styleNative:row?.style!=null,
    logo:{available:row?.has_logo===true,mime:row?.logo_mime||'',name:row?.logo_name||''}};
}
export async function changeBusinessAdmin(db,company,input) {
  const client=await db.connect();try{
    await client.query('BEGIN');
    await client.query('INSERT INTO panel_business_admin(company_id) VALUES($1) ON CONFLICT DO NOTHING',[company.company_id]);
    const row=(await client.query('SELECT branches,style,revision FROM panel_business_admin WHERE company_id=$1 FOR UPDATE',[company.company_id])).rows[0];
    if(!Number.isInteger(input.revision)||input.revision!==row.revision)throw Error('Los datos cambiaron en otra sesión. Recargá antes de guardar.');
    if(input.action==='branch-save'||input.action==='branches-import') {
      const branches=row.branches??(await legacyData(client,company)).branches;
      if(input.action==='branch-save') {
        const id=input.branch?.idSucursal;
        if(id&&!branches.some(b=>b.idSucursal===id))throw Error('El local no pertenece a esta empresa.');
        if(!id&&branches.length>=100)throw Error('Se admiten hasta 100 locales por empresa.');
        const saved=validateBranch(input.branch||{},id||randomUUID());
        if(!saved.activa)saved.principal=false;
        if(saved.principal)for(const b of branches)b.principal=false;
        const index=branches.findIndex(b=>b.idSucursal===saved.idSucursal);
        if(index<0)branches.push(saved);else branches[index]=saved;
      }
      await client.query('UPDATE panel_business_admin SET branches=$2 WHERE company_id=$1',[company.company_id,JSON.stringify(branches)]);
    } else if(input.action==='style-save') {
      const style=validateStyle(input.style||{});
      await client.query('UPDATE panel_business_admin SET style=$2 WHERE company_id=$1',[company.company_id,JSON.stringify(style)]);
    } else if(input.action==='logo-upload') {
      if(!['image/png','image/jpeg','image/webp'].includes(input.mime))throw Error('El logo debe ser PNG, JPG o WEBP.');
      if(typeof input.base64!=='string'||input.base64.length>Math.ceil(2*1024*1024/3)*4)throw Error('El logo supera 2 MB.');
      const bytes=decodeMedia(input.mime,input.base64);
      if(bytes.length>2*1024*1024)throw Error('El logo supera 2 MB.');
      const name=text(input.name||'Logo',150);
      await client.query('UPDATE panel_business_admin SET logo_data=$2,logo_mime=$3,logo_name=$4 WHERE company_id=$1',[company.company_id,bytes,input.mime,name]);
    } else if(input.action==='logo-remove') {
      await client.query('UPDATE panel_business_admin SET logo_data=NULL,logo_mime=NULL,logo_name=NULL WHERE company_id=$1',[company.company_id]);
    } else throw Error('Operación de negocio inválida.');
    await client.query('UPDATE panel_business_admin SET revision=revision+1,updated_at=NOW() WHERE company_id=$1',[company.company_id]);
    const result=await readBusinessAdmin(client,company);
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function businessLogo(db,id) {
  return (await db.query('SELECT logo_data,logo_mime FROM panel_business_admin WHERE company_id=$1 AND logo_data IS NOT NULL',[id])).rows[0]||null;
}
export async function businessRuntime(db,company) {
  const row=(await db.query('SELECT branches,style FROM panel_business_admin WHERE company_id=$1',[company.company_id])).rows[0];
  return {branchesNative:row?.branches!=null,branches:(row?.branches||[]).filter(b=>b.activa&&b.retiroHabilitado).sort((a,b)=>Number(b.principal)-Number(a.principal)||a.orden-b.orden),style:row?.style||null};
}
