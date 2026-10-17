import {validateSingleModule,assignModule} from './module_access.js';
import {getPickup,savePickup} from './pickup.js';
export async function initBusinessProfiles(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_business_profiles(company_id TEXT PRIMARY KEY, config JSONB NOT NULL DEFAULT '{}', modules JSONB, phone_number_id TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
const fields=['NOMBRE_EMPRESA','TIPO_NEGOCIO','TELEFONO','DIRECCION','EMAIL'];
export async function getBusinessProfile(db,company){
 const saved=(await db.query('SELECT * FROM panel_business_profiles WHERE company_id=$1',[company.company_id])).rows[0];
 const config={...company.config,...saved?.config};
 const pickup=await getPickup(db,company);config.DIRECCION=pickup.address;
 return {empresa:{idEmpresa:company.company_id,nombreEmpresa:config.NOMBRE_EMPRESA||company.company_name,phoneNumberId:saved?.phone_number_id??company.phone_number_id,tipoNegocio:config.TIPO_NEGOCIO||'MIXTO'},config:Object.fromEntries(fields.map(k=>[k,String(config[k]||'')])),modulos:saved?.modules??company.modules,revision:saved?.revision??0,source:'POSTGRES_DIRECT'};
}
export async function saveBusinessProfile(db,companyId,data,allowModules){
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('LOCK TABLE panel_companies IN SHARE ROW EXCLUSIVE MODE');
  const company=(await client.query('SELECT * FROM panel_companies WHERE company_id=$1 FOR UPDATE',[companyId])).rows[0];
  if(!company)throw new Error('Empresa no encontrada.');
  await client.query('INSERT INTO panel_business_profiles(company_id) VALUES($1) ON CONFLICT DO NOTHING',[companyId]);
  const row=(await client.query('SELECT * FROM panel_business_profiles WHERE company_id=$1 FOR UPDATE',[companyId])).rows[0];
  if(!Number.isInteger(data.revision)||data.revision!==row.revision)throw new Error('La configuración cambió en otra sesión. Recargá antes de guardar.');
  const config={...row.config};
  for(const field of fields)if(Object.hasOwn(data,field)){
   if(typeof data[field]!=='string'||data[field].length>2000)throw new Error('Valor inválido: '+field);
   config[field]=data[field].trim();
  }
  if(!String(config.NOMBRE_EMPRESA||company.company_name).trim())throw new Error('Ingresá el nombre comercial.');
  if(config.EMAIL&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.EMAIL))throw new Error('Email inválido.');
  let modules=row.modules,phone=row.phone_number_id;
  if(Object.hasOwn(data,'module')&&!allowModules)throw Error('Solo el Super Admin puede asignar la configuración ONE.');
  if(allowModules){
   if(Object.hasOwn(data,'module')){
    if(Object.hasOwn(data,'modulos'))throw Error('Enviá una sola configuración.');
    modules=assignModule({...company.modules,...modules},data.module);
   }
   if(data.modulos){modules={...company.modules,...modules};for(const key of ['ventas','gastro','eventos','servicios','salud'])if(Object.hasOwn(data.modulos,key)){if(typeof data.modulos[key]!=='boolean')throw new Error('Módulos inválidos.');modules[key]=data.modulos[key];}}
   if(Object.hasOwn(data,'PHONE_NUMBER_ID')){phone=String(data.PHONE_NUMBER_ID||'').trim();if(phone&&!/^\d+$/.test(phone))throw new Error('Phone Number ID inválido.');
    if(phone&&(await client.query('SELECT company_id FROM panel_companies WHERE phone_number_id=$1 AND company_id<>$2',[phone,companyId])).rows.length)throw new Error('Ese número ya pertenece a otra empresa.');}
  }
  if(allowModules&&data.modulos&&JSON.stringify(modules)!==JSON.stringify(row.modules??company.modules))validateSingleModule(modules);
  await client.query('UPDATE panel_business_profiles SET config=$2,modules=$3,phone_number_id=$4,revision=revision+1,updated_at=NOW() WHERE company_id=$1',[companyId,JSON.stringify(config),modules===null?null:JSON.stringify(modules),phone]);
  const updated=(await client.query(`UPDATE panel_companies SET company_name=$2,config=config || $3::jsonb,modules=$4,phone_number_id=$5 WHERE company_id=$1 RETURNING *`,[companyId,config.NOMBRE_EMPRESA||company.company_name,JSON.stringify(config),JSON.stringify(modules??company.modules),phone??company.phone_number_id])).rows[0];
  if(Object.hasOwn(config,'DIRECCION'))await savePickup(client,companyId,config.DIRECCION);
  if(phone!==null&&phone!==company.phone_number_id)await client.query('UPDATE panel_native_companies SET connected=FALSE,revision=revision+1 WHERE company_id=$1',[companyId]);
  const result=await getBusinessProfile(client,updated);
  if(phone!==null&&phone!==company.phone_number_id)result.warning='Datos guardados. Si es una empresa creada en el panel, revisá y habilitá su conexión en Super Admin. Para empresas anteriores, sincronizá la configuración del motor.';
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
