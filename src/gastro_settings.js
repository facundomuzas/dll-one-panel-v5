import {randomUUID} from 'node:crypto';
import {enabled,isGastro} from './gastro_catalog.js';
import {decodeMedia} from './receipts.js';
const yes=(v,fallback=true)=>v==null?fallback:enabled(v);
const text=(v,n=500)=>String(v??'').trim().slice(0,n);
function amount(v,label){const n=Number(v);if(v===''||v==null||!Number.isFinite(n)||n<0||n>1e10)throw new Error(label+' inválido.');return n;}
export async function initGastroSettings(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_gastro_settings(company_id TEXT PRIMARY KEY,settings JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_gastro_images(company_id TEXT NOT NULL,image_id TEXT NOT NULL,mime TEXT NOT NULL,data BYTEA NOT NULL,PRIMARY KEY(company_id,image_id))`);
}
export function paymentFields(item){
 let detail=String(item.detalle||'');
 const take=(pattern)=>{let found='';detail=detail.replace(pattern,(_all,value)=>{found=value.trim();return '';});return found;};
 const alias=take(/(?:^|\n)\s*Alias(?: Mercado Pago)?\s*:\s*([^\r\n]+)(?=\r?\n|$)/i);
 const cbu=take(/(?:^|\n)\s*(?:CBU|CVU|CBU\s*\/\s*CVU)\s*:\s*(\d{22})(?=\s*$|\r?\n)/i);
 const titular=take(/(?:^|\n)\s*Titular\s*:\s*([^\r\n]+)(?=\r?\n|$)/i);
 return {...item,alias:item.alias||alias,cbu:item.cbu||cbu,titular:item.titular||titular,detalle:detail.trim()};
}
export function normalizedSettings(raw){
 const s=raw?.settings||raw;
 if(!s||!Array.isArray(s.menu?.imagenes)||!Array.isArray(s.pagos?.items)||!Array.isArray(s.entrega?.zonas))throw new Error('La copia de cobro, entrega e imágenes está incompleta. Reintentá importar los datos existentes.');
 return {
  variantesHabilitadas:yes(s.variantesHabilitadas),
  extrasHabilitados:yes(s.extrasHabilitados),
  menu:{...s.menu,auto:yes(s.menu.auto),imagenes:s.menu.imagenes.map((x,i)=>({...x,idImagen:text(x.idImagen||x.id||'LEGACY-'+i,100),activa:yes(x.activa),posicion:Number(x.posicion||i+1)}))},
  pagos:{...s.pagos,efectivoHabilitado:yes(s.pagos.efectivoHabilitado),transferenciaHabilitada:yes(s.pagos.transferenciaHabilitada),items:s.pagos.items.map((x,i)=>({...paymentFields(x),idPago:text(x.idPago||'LEGACY-'+(x.fila||i+1),100),activo:yes(x.activo),preferido:yes(x.preferido,false)}))},
  entrega:{...s.entrega,deliveryHabilitado:yes(s.entrega.deliveryHabilitado),retiroHabilitado:yes(s.entrega.retiroHabilitado),zonas:s.entrega.zonas.map((x,i)=>({...x,idZona:text(x.idZona||'LEGACY-'+i,100),activa:yes(x.activa)}))}
 };
}
export async function getGastroSettings(db,company,readLegacy){
 if(!isGastro(company))throw new Error('Esta empresa no tiene ONE Gastro habilitado.');
 let row=(await db.query('SELECT * FROM panel_gastro_settings WHERE company_id=$1',[company.company_id])).rows[0];
 if(row)return row;
 let settings;
 try{settings=normalizedSettings(company.snapshot?.data?.gastroBundle);}catch{
  if(!readLegacy)throw new Error('Falta importar la configuración Gastro. Abrí Gastro en el panel.');
  settings=normalizedSettings(await readLegacy());
 }
 await db.query(`INSERT INTO panel_gastro_settings(company_id,settings) VALUES($1,$2) ON CONFLICT(company_id) DO NOTHING`,[company.company_id,JSON.stringify(settings)]);
 return (await db.query('SELECT * FROM panel_gastro_settings WHERE company_id=$1',[company.company_id])).rows[0];
}
export function imageBytes(mime,base64){
 if(!['image/jpeg','image/png'].includes(mime))throw new Error('Usá una imagen JPG o PNG de hasta 5 MB.');
 return decodeMedia(mime,String(base64||'').replace(/^data:[^;]+;base64,/,''));
}
export async function changeSettings(db,company,operation,input={},id=''){
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const row=(await client.query('SELECT * FROM panel_gastro_settings WHERE company_id=$1 FOR UPDATE',[company.company_id])).rows[0];
  if(!row)throw new Error('Primero importá la configuración de Gastro.');
  if(Number(input.revision)!==row.revision)throw new Error('La configuración cambió. Recargá Gastro antes de guardar.');
  const s=row.settings;
  if(operation==='config'){
   if(input.extrasHabilitados!==undefined){if(typeof input.extrasHabilitados!=='boolean')throw Error('Opción de extras inválida.');s.extrasHabilitados=input.extrasHabilitados;}
   if(input.variantesHabilitadas!==undefined){if(typeof input.variantesHabilitadas!=='boolean')throw Error('Opción de variantes inválida.');s.variantesHabilitadas=input.variantesHabilitadas;}
   for(const k of ['deliveryHabilitado','retiroHabilitado']){if(typeof input[k]!=='boolean')throw new Error('Opción de entrega inválida.');s.entrega[k]=input[k];}
   for(const k of ['efectivoHabilitado','transferenciaHabilitada']){if(typeof input[k]!=='boolean')throw new Error('Opción de pago inválida.');s.pagos[k]=input[k];}
   if(!s.entrega.deliveryHabilitado&&!s.entrega.retiroHabilitado)throw new Error('Habilitá al menos una forma de entrega.');
   if(!s.pagos.efectivoHabilitado&&!s.pagos.transferenciaHabilitada)throw new Error('Habilitá al menos una forma de pago.');
   s.entrega.tiempoPreparacion=text(input.tiempoPreparacion??s.entrega.tiempoPreparacion,120);
  }else if(operation==='payment'){
   const old=input.idPago?s.pagos.items.find(x=>x.idPago===input.idPago):null;
   if(input.idPago&&!old)throw new Error('Medio de pago no encontrado en esta empresa.');
   const x={...old,idPago:old?.idPago||'PAY-'+randomUUID(),medio:text(input.medio,100),alias:text(input.alias,100),cbu:text(input.cbu,22),titular:text(input.titular,150),detalle:text(input.detalle,1500),activo:input.activo!==false,preferido:input.preferido===true,orden:amount(input.orden??100,'Orden')};
   if(!x.medio)throw new Error('Ingresá el medio de pago.');
   if(x.cbu&&!/^\d{22}$/.test(x.cbu))throw new Error('El CBU/CVU debe contener 22 dígitos.');
   if(x.preferido)s.pagos.items.forEach(p=>p.preferido=false);
   if(old)s.pagos.items[s.pagos.items.indexOf(old)]=x;else s.pagos.items.push(x);
   s.pagos.items.sort((a,b)=>Number(a.orden||0)-Number(b.orden||0));
  }else if(operation==='payment/toggle'){
   const x=s.pagos.items.find(x=>x.idPago===id);if(!x)throw new Error('Medio de pago no encontrado.');x.activo=input.activo===true;
  }else if(operation==='zone'){
   const old=input.idZona?s.entrega.zonas.find(x=>x.idZona===input.idZona):null;
   if(input.idZona&&!old)throw new Error('Zona no encontrada en esta empresa.');
   const x={...old,idZona:old?.idZona||'ZONE-'+randomUUID(),nombre:text(input.nombre,120),costo:amount(input.costo,'Costo'),posicion:amount(input.posicion??100,'Posición'),referencias:text(input.referencias,700),activa:input.activa!==false};
   if(!x.nombre)throw new Error('Ingresá el nombre de la zona.');
   if(old)s.entrega.zonas[s.entrega.zonas.indexOf(old)]=x;else s.entrega.zonas.push(x);
   s.entrega.zonas.sort((a,b)=>a.posicion-b.posicion);
  }else if(operation==='zone/delete'){
   if(!s.entrega.zonas.some(x=>x.idZona===id))throw new Error('Zona no encontrada.');s.entrega.zonas=s.entrega.zonas.filter(x=>x.idZona!==id);
  }else if(operation==='menu/config'){
   if(typeof input.auto!=='boolean')throw new Error('Opción de menú inválida.');s.menu.auto=input.auto;
  }else if(operation==='menu/upload'){
   if(s.menu.imagenes.length>=30)throw new Error('Máximo 30 imágenes. Eliminá las que ya no uses.');
   const bytes=imageBytes(input.mime,input.base64),imageId='IMG-'+randomUUID();
   await client.query('INSERT INTO panel_gastro_images(company_id,image_id,mime,data) VALUES($1,$2,$3,$4)',[company.company_id,imageId,input.mime,bytes]);
   s.menu.imagenes.push({idImagen:imageId,nombre:text(input.name||'Menú',150),posicion:s.menu.imagenes.length+1,activa:true,native:true});
  }else if(operation.startsWith('menu/')){
   const x=s.menu.imagenes.find(x=>x.idImagen===id);if(!x)throw new Error('Imagen no encontrada.');
   if(operation==='menu/toggle')x.activa=input.activa===true;
   else if(operation==='menu/delete'){
    s.menu.imagenes=s.menu.imagenes.filter(item=>item.idImagen!==id);
    await client.query('DELETE FROM panel_gastro_images WHERE company_id=$1 AND image_id=$2',[company.company_id,id]);
   }else if(operation==='menu/move'){
    if(!['SUBIR','BAJAR'].includes(input.direccion))throw new Error('Dirección inválida.');
    const i=s.menu.imagenes.indexOf(x),j=i+(input.direccion==='SUBIR'?-1:1);
    if(j>=0&&j<s.menu.imagenes.length)[s.menu.imagenes[i],s.menu.imagenes[j]]=[s.menu.imagenes[j],s.menu.imagenes[i]];
   }else throw new Error('Operación inválida.');
   s.menu.imagenes.forEach((x,i)=>x.posicion=i+1);
  }else throw new Error('Operación desconocida.');
  const result=(await client.query('UPDATE panel_gastro_settings SET settings=$2,revision=revision+1,updated_at=NOW() WHERE company_id=$1 RETURNING *',[company.company_id,JSON.stringify(s)])).rows[0];
  await client.query('COMMIT');return result;
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export async function getMenuFile(db,company,id,readLegacy){
 const settings=await getGastroSettings(db,company);
 const item=settings.settings.menu.imagenes.find(x=>x.idImagen===id);
 if(!item)throw new Error('Imagen no encontrada en esta empresa.');
 let row=(await db.query('SELECT mime,data FROM panel_gastro_images WHERE company_id=$1 AND image_id=$2',[company.company_id,id])).rows[0];
 if(!row){
  if(!readLegacy)throw new Error('Imagen pendiente de importación.');
  const result=await readLegacy(id);const match=String(result?.dataUrl||'').match(/^data:(image\/(?:jpeg|png));base64,(.+)$/s);
  if(!match)throw new Error('No se pudo importar la imagen. Volvé a subir el archivo JPG/PNG.');
  const bytes=imageBytes(match[1],match[2]);
  await db.query('INSERT INTO panel_gastro_images(company_id,image_id,mime,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[company.company_id,id,match[1],bytes]);
  row={mime:match[1],data:bytes};
 }
 return {mime:row.mime,base64:Buffer.from(row.data).toString('base64')};
}
export function motorSettings(settings){
 const s=settings;
 const medios=s.pagos.items.filter(x=>x.activo).sort((a,b)=>Number(b.preferido)-Number(a.preferido)||Number(a.orden||0)-Number(b.orden||0)).map(x=>({medio:x.medio,detalle:[x.alias&&'Alias: '+x.alias,x.cbu&&'CBU/CVU: '+x.cbu,x.titular&&'Titular: '+x.titular,x.detalle].filter(Boolean).join('\n')}));
 return {extrasHabilitados:s.extrasHabilitados!==false,variantesHabilitadas:s.variantesHabilitadas!==false,pagos:{efectivo:s.pagos.efectivoHabilitado,transferencia:s.pagos.transferenciaHabilitada,medios},entrega:{...s.entrega,zonas:s.entrega.zonas.filter(x=>x.activa)},menu:{auto:s.menu.auto,imagenes:s.menu.imagenes.filter(x=>x.activa).map(x=>({idImagen:x.idImagen,nombre:x.nombre,native:true}))}};
}
