import {randomUUID,createHash} from 'node:crypto';
import {defaultHours} from './order_hours.js';
import {validateMotorSnapshot,readMotorSnapshot} from './motor_snapshot.js';
export async function initNativeCompanies(db){await db.query(`CREATE TABLE IF NOT EXISTS panel_native_companies(company_id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,web_slug TEXT UNIQUE,runtime JSONB,connected BOOLEAN NOT NULL DEFAULT FALSE,revision INTEGER NOT NULL DEFAULT 0,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);await db.query(`ALTER TABLE panel_native_companies ADD COLUMN IF NOT EXISTS bot_instructions TEXT, ADD COLUMN IF NOT EXISTS instructions_revision INTEGER NOT NULL DEFAULT 0`);}
function clean(v,max){const s=String(v??'').trim();if(s.length>max)throw Error('Un campo supera el largo permitido.');return s;}
function phone(v){const p=clean(v,30);if(p&&!/^\d{5,30}$/.test(p))throw Error('Phone Number ID inválido.');return p;}
export async function createNativeCompany(db,input,actor){
 const name=clean(input.nombreEmpresa,150),type=clean(input.tipoNegocio||'MIXTO',30).toUpperCase(),slug=clean(input.webSlug,100).toLowerCase(),phoneId=phone(input.phoneNumberId);
 if(!name)throw Error('Ingresá el nombre de la empresa.');
 if(!['PRODUCTOS','SERVICIOS','MIXTO'].includes(type))throw Error('Tipo de negocio inválido.');
 if(slug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw Error('Usá letras minúsculas, números y guiones para el slug.');
 const modules=Object.fromEntries(['ventas','gastro','eventos','servicios'].map(k=>[k,input.modules?.[k]===true]));
 if(!Object.values(modules).some(Boolean))throw Error('Elegí al menos un módulo.');
 const requestId=clean(input.requestId,100);if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw Error('Recargá el formulario para crear la empresa.');
 const hash=createHash('sha256').update(JSON.stringify({name,type,slug,phoneId,modules})).digest('hex');
 const client=await db.connect();try{
  await client.query('BEGIN');await client.query('LOCK TABLE panel_companies IN SHARE ROW EXCLUSIVE MODE');
  const previous=(await client.query('SELECT * FROM panel_native_companies WHERE request_id=$1',[requestId])).rows[0];
  if(previous){if(previous.request_hash!==hash)throw Error('El intento anterior tenía otros datos. Recargá antes de crear otra empresa.');await client.query('COMMIT');return {idEmpresa:previous.company_id,created:false,connectionStatus:'PENDING'};}
  if(phoneId&&(await client.query('SELECT 1 FROM panel_companies WHERE phone_number_id=$1',[phoneId])).rows.length)throw Error('Ese Phone Number ID ya pertenece a otra empresa.');
  if(phoneId&&(await readMotorSnapshot(client))?.empresas?.some(x=>String(x.phoneNumberId)===phoneId))throw Error('Ese Phone Number ID ya está registrado en el motor.');
  if(slug&&(await client.query("SELECT 1 FROM panel_native_companies WHERE web_slug=$1 UNION ALL SELECT 1 FROM panel_companies WHERE config->>'WEB_SLUG'=$1",[slug])).rows.length)throw Error('Ese slug ya está en uso.');
  const id='ONE-'+randomUUID(),config={NOMBRE_EMPRESA:name,TIPO_NEGOCIO:type,WEB_SLUG:slug,DIRECCION:'',TELEFONO:'',EMAIL:''};
  await client.query(`INSERT INTO panel_companies(company_id,company_name,phone_number_id,modules,config,snapshot,source_version) VALUES($1,$2,$3,$4,$5,'{}','PANEL_V575')`,[id,name,phoneId,JSON.stringify(modules),JSON.stringify(config)]);
  await client.query('INSERT INTO panel_native_companies(company_id,request_id,request_hash,web_slug,created_by) VALUES($1,$2,$3,$4,$5)',[id,requestId,hash,slug||null,clean(actor,200)]);
  await client.query('INSERT INTO panel_business_profiles(company_id,config,modules,phone_number_id) VALUES($1,$2,$3,$4)',[id,JSON.stringify(config),JSON.stringify(modules),phoneId]);
  await client.query("INSERT INTO panel_pickup_settings(company_id,address) VALUES($1,'')",[id]);
  await client.query('INSERT INTO panel_order_hours(company_id,settings) VALUES($1,$2)',[id,JSON.stringify({...defaultHours(),mode:'PAUSED',closedMessage:'Estamos preparando la atención de pedidos.'})]);
  // Seed both empty catalogs so enabling a module later never needs a legacy sheet.
  await client.query('INSERT INTO panel_sales_catalog(company_id,items) VALUES($1,$2)',[id,'[]']);
  await client.query('INSERT INTO panel_gastro_catalog(company_id,catalog) VALUES($1,$2)',[id,JSON.stringify({categorias:[],productos:[],variantes:[],extras:[]})]);
  await client.query('INSERT INTO panel_gastro_settings(company_id,settings) VALUES($1,$2)',[id,JSON.stringify({menu:{auto:true,imagenes:[]},pagos:{efectivoHabilitado:true,transferenciaHabilitada:false,items:[]},entrega:{retiroHabilitado:true,deliveryHabilitado:false,zonas:[],tiempoPreparacion:''}})]);
  await client.query('COMMIT');return {idEmpresa:id,created:true,connectionStatus:'PENDING'};
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export async function nativeConnectionStatus(db,id){
 const row=(await db.query('SELECT n.connected,n.revision,n.runtime,c.phone_number_id FROM panel_native_companies n JOIN panel_companies c ON c.company_id=n.company_id WHERE n.company_id=$1',[id])).rows[0];
 if(!row)return {native:false};
 return {native:true,connected:row.connected,revision:row.revision,phoneNumberId:row.phone_number_id,hasToken:!!row.runtime?.accessToken,graphVersion:row.runtime?.graphVersion||'v26.0'};
}
export async function saveNativeConnection(db,id,input){
 const client=await db.connect();try{
  await client.query('BEGIN');await client.query('LOCK TABLE panel_companies IN SHARE ROW EXCLUSIVE MODE');
  const row=(await client.query('SELECT * FROM panel_native_companies WHERE company_id=$1 FOR UPDATE',[id])).rows[0];
  const company=(await client.query('SELECT * FROM panel_companies WHERE company_id=$1',[id])).rows[0];
  if(!row||!company)throw Error('Esta conexión se administra por el sistema anterior.');
  if(!Number.isInteger(input.revision)||input.revision!==row.revision)throw Error('La conexión cambió. Recargá antes de guardar.');
  if(typeof input.connected!=='boolean')throw Error('Estado de conexión inválido.');
  const phoneId=phone(input.phoneNumberId),token=clean(input.accessToken,4000)||row.runtime?.accessToken||'',version=clean(input.graphVersion||'v26.0',20);
  if(!/^v\d{1,3}\.\d{1,2}$/.test(version))throw Error('Versión de Meta inválida.');
  if(input.connected&&(!phoneId||!token))throw Error('Completá Phone Number ID y token antes de habilitar la conexión.');
  if(phoneId&&(await client.query('SELECT 1 FROM panel_companies WHERE phone_number_id=$1 AND company_id<>$2',[phoneId,id])).rows.length)throw Error('Ese Phone Number ID ya pertenece a otra empresa.');
  if(phoneId&&(await readMotorSnapshot(client))?.empresas?.some(x=>x.idEmpresa!==id&&String(x.phoneNumberId)===phoneId))throw Error('Ese Phone Number ID ya está registrado en el motor.');
  const runtime={...(row.runtime||{}),idEmpresa:id,nombre:company.company_name,phoneNumberId:phoneId,accessToken:token,graphVersion:version,managedNatively:true,context:row.runtime?.context||{empresa:{nombre:company.company_name},catalogo:{categorias:[],productos:[],variantes:[],extras:[]},menu:{auto:true,imagenes:[]},pagos:{efectivo:true,transferencia:false,medios:[]},entrega:{retiroHabilitado:true,deliveryHabilitado:false,zonas:[]},instruccionesIA:''}};
  await client.query('UPDATE panel_native_companies SET runtime=$2,connected=$3,revision=revision+1 WHERE company_id=$1',[id,JSON.stringify(runtime),input.connected]);
  await client.query('UPDATE panel_companies SET phone_number_id=$2 WHERE company_id=$1',[id,phoneId]);
  await client.query('UPDATE panel_business_profiles SET phone_number_id=$2,revision=revision+1 WHERE company_id=$1',[id,phoneId]);
  const result=await nativeConnectionStatus(client,id);await client.query('COMMIT');return result;
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export async function effectiveMotorSnapshot(db,base){
 const rows=(await db.query('SELECT n.company_id,n.runtime,n.connected,n.bot_instructions,c.company_name,c.phone_number_id FROM panel_native_companies n JOIN panel_companies c ON c.company_id=n.company_id ORDER BY n.company_id')).rows;
 if(!rows.length)return base;
 const ids=new Set(rows.map(x=>x.company_id));
 const empresas=[...(base?.empresas||[]).filter(x=>!ids.has(x.idEmpresa))];
 for(const row of rows){if(row.connected&&row.runtime?.accessToken&&row.phone_number_id){empresas.push({...row.runtime,nombre:row.company_name,phoneNumberId:row.phone_number_id,context:{...row.runtime.context,...(row.bot_instructions!==null?{instruccionesIA:row.bot_instructions}:{})}});}}
 if(empresas.length)validateMotorSnapshot({empresas});
 return {...base,empresas,managedByPanel:true,nativeCompanyIds:[...ids]};
}
