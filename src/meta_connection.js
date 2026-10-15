import {randomUUID} from 'node:crypto';
import {nativeConnectionStatus} from './native_companies.js';
import {validateMotorSnapshot} from './motor_snapshot.js';

// Import only the live motor's selected company, never browser-supplied credentials.
export async function importExistingConnection(db,id,runtime,actor){
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('LOCK TABLE panel_companies IN SHARE ROW EXCLUSIVE MODE');
  const existing=await nativeConnectionStatus(client,id);
  if(existing.native){await client.query('COMMIT');return existing;}
  const company=(await client.query('SELECT * FROM panel_companies WHERE company_id=$1',[id])).rows[0];
  if(!company||runtime?.idEmpresa!==id)throw Error('No se encontró esta empresa en el motor.');
  validateMotorSnapshot({empresas:[runtime]});
  if(!runtime.accessToken||typeof runtime.accessToken!=='string')throw Error('El motor no tiene un token para esta empresa.');
  if(String(company.phone_number_id)!==String(runtime.phoneNumberId))throw Error('El número del panel no coincide con el motor. Revisá la configuración antes de importar.');
  if((await client.query('SELECT 1 FROM panel_companies WHERE phone_number_id=$1 AND company_id<>$2',[String(runtime.phoneNumberId),id])).rows.length)throw Error('Ese número está asignado a otra empresa.');
  await client.query(`INSERT INTO panel_native_companies(company_id,request_id,request_hash,runtime,connected,created_by) VALUES($1,$2,'IMPORTED',$3,TRUE,$4)`,[id,'import-'+randomUUID(),JSON.stringify({...runtime,managedNatively:true}),String(actor||'')]);
  await client.query(`INSERT INTO panel_business_profiles(company_id,phone_number_id) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET phone_number_id=EXCLUDED.phone_number_id,revision=panel_business_profiles.revision+1`,[id,String(runtime.phoneNumberId)]);
  const result=await nativeConnectionStatus(client,id);
  await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function checkMetaCredentials(runtime,fetchImpl=fetch){
 const phone=String(runtime?.phoneNumberId||''),version=String(runtime?.graphVersion||'v26.0');
 if(!/^\d{5,30}$/.test(phone)||!/^v\d{1,3}\.\d{1,2}$/.test(version)||!runtime?.accessToken)throw Error('Faltan credenciales válidas guardadas.');
 let response,data;
 try{
  response=await fetchImpl(`https://graph.facebook.com/${version}/${phone}?fields=id,display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${runtime.accessToken}`},signal:AbortSignal.timeout(6000),redirect:'error'});
  data=await response.json();
 }catch{throw Error('No se pudo consultar Meta. Reintentá en unos segundos.');}
 if(!response.ok||data?.error){
  const code=Number(data?.error?.code);
  if(code===190)throw Error('Meta rechazó el token: puede estar vencido o ser inválido.');
  if(code===10||code===200)throw Error('El token no tiene permiso para consultar este número.');
  throw Error('Meta no permitió consultar el número. Revisá Phone Number ID, token, permisos y versión.');
 }
 if(String(data?.id)!==phone)throw Error('Meta devolvió un número diferente al configurado.');
 return {credentialsReadable:true,phoneNumberId:phone,displayPhoneNumber:String(data.display_phone_number||''),verifiedName:String(data.verified_name||''),checkedAt:new Date().toISOString()};
}
