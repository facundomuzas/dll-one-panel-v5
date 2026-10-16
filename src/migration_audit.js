import {isGastro} from './gastro_catalog.js';
import {isSales} from './sales_catalog.js';
import {gastroMigrationStatus} from './gastro_migration.js';

// Read-only. No import, bridge call, credential export or change to company data.
export async function auditCompanyMigration(db,company){
 const id=company.company_id,checks=[];
 if(company.service_state&&company.service_state!=='ACTIVE')return {companyId:id,name:company.company_name,phoneNumberId:String(company.phone_number_id||''),connected:false,checks:[{key:'paused',ready:true,label:'Servicio pausado/suspendido: datos conservados; reactivación pendiente de revisión',action:''}],dataPrepared:true};
 const native=(await db.query('SELECT connected,runtime,bot_instructions FROM panel_native_companies WHERE company_id=$1',[id])).rows[0];
 checks.push({key:'connection',ready:!!native,label:'Conexión administrada por el panel',action:native?'':'Super Admin → Conexión con Meta / WhatsApp → Traer conexión actual al panel.'});
 const credentialsReady=!!native&&(!native.connected||!!native.runtime?.accessToken&&String(native.runtime?.phoneNumberId)===String(company.phone_number_id));
 checks.push({key:'credentials',ready:credentialsReady,label:'Configuración de conexión guardada',action:credentialsReady?'':native?'Revisá y guardá la conexión en Super Admin.':'Primero importá la conexión. Esta revisión no consulta Meta.'});
 if(isGastro(company)){
  const gastro=await gastroMigrationStatus(db,company);
  checks.push({key:'catalog',ready:gastro.catalogReady,label:'Catálogo Gastro guardado en el panel',action:gastro.catalogReady?'':'Gastro → Verificar y copiar pendientes.'});
  checks.push({key:'settings',ready:gastro.settingsReady,label:'Pagos, entrega y configuración Gastro',action:gastro.settingsReady?'':'Gastro → Verificar y copiar pendientes.'});
  const missing=gastro.images.filter(x=>!x.ready);
  checks.push({key:'images',ready:gastro.settingsReady&&missing.length===0,label:`Imágenes del menú copiadas: ${gastro.imagesReady}/${gastro.images.length}`,action:missing.length?'Gastro → Verificar y copiar pendientes. Faltan: '+missing.map(x=>x.name).join(', '):gastro.settingsReady?'':'Primero copiá la configuración Gastro.'});
 }else if(isSales(company)){
  const exists=(await db.query('SELECT revision FROM panel_sales_catalog WHERE company_id=$1',[id])).rows.length>0;
  checks.push({key:'catalog',ready:exists,label:'Catálogo ONE Ventas guardado en el panel',action:exists?'':'Abrí Catálogo para importar la lista inicial y volvé a revisar.'});
 }else checks.push({key:'module',ready:false,label:'Módulo comercial evaluado',action:'Esta revisión cubre ONE Gastro y ONE Ventas. Revisá los demás módulos por separado.'});
 checks.push({key:'instructions',ready:!!native,label:'Instrucciones disponibles sin Apps Script',action:native?'':'Importá la conexión para conservar las instrucciones actuales. Después podés editarlas en Mi negocio.'});
 return {companyId:id,name:company.company_name,phoneNumberId:String(company.phone_number_id||''),connected:native?native.connected:null,checks,dataPrepared:checks.every(x=>x.ready)};
}

export function combineMigrationAudit(companies,motor){
 const available=motor?.ok===true&&Array.isArray(motor.companies)&&Array.isArray(motor.nativeCompanyIds)&&['legacyMirrors','messagesPending','conversationEventsPending'].every(k=>Number.isInteger(motor[k])&&motor[k]>=0);
 const ids=new Set(companies.map(x=>x.companyId));
 const unknownCompanies=available?motor.companies.filter(x=>!ids.has(x.companyId)).map(x=>String(x.companyId)):[];
 const rows=companies.map(c=>{
  const found=available?motor.companies.find(x=>x.companyId===c.companyId):null;
  const observed=available&&motor.nativeCompanyIds.includes(c.companyId)&&(c.connected===true?!!found&&String(found.phoneNumberId)===c.phoneNumberId:c.connected===false&&!found);
  return {...c,motorObserved:observed};
 });
 return {checkedAt:new Date().toISOString(),companies:rows,motor:available?{
  available:true,storage:motor.storage||null,version:String(motor.version||''),legacyMirrors:motor.legacyMirrors,messagesPending:motor.messagesPending,conversationEventsPending:motor.conversationEventsPending,unknownCompanies
 }:{available:false},
 reviewClear:available&&rows.length>0&&rows.every(x=>x.dataPrepared&&x.motorObserved)&&unknownCompanies.length===0&&motor.legacyMirrors===0&&motor.messagesPending===0&&motor.conversationEventsPending===0};
}
