import {isGastro,ensureGastroCatalog} from './gastro_catalog.js';
import {getGastroSettings,getMenuFile} from './gastro_settings.js';

// Only read local state here: opening the status must never contact Apps Script.
export async function gastroMigrationStatus(db,company){
 if(!isGastro(company))throw new Error('Esta empresa no tiene ONE Gastro habilitado.');
 const id=company.company_id;
 const catalog=(await db.query('SELECT revision FROM panel_gastro_catalog WHERE company_id=$1',[id])).rows[0];
 const config=(await db.query('SELECT settings FROM panel_gastro_settings WHERE company_id=$1',[id])).rows[0];
 const stored=new Set((await db.query('SELECT image_id FROM panel_gastro_images WHERE company_id=$1',[id])).rows.map(x=>x.image_id));
 const images=(config?.settings?.menu?.imagenes||[]).map(x=>({id:x.idImagen,name:String(x.nombre||'Imagen del menú'),ready:stored.has(x.idImagen)}));
 return {companyId:id,catalogReady:!!catalog,settingsReady:!!config,images,
  imagesReady:images.filter(x=>x.ready).length,
  complete:!!catalog&&!!config&&images.every(x=>x.ready)};
}

// One bounded operation per request; retries reuse prior imports without replacing edits.
export async function migrateGastroStep(db,company,input,readLegacy){
 if(!isGastro(company))throw new Error('Esta empresa no tiene ONE Gastro habilitado.');
 if(input.step==='catalog')await ensureGastroCatalog(db,company,()=>readLegacy('gastro_get',{}));
 else if(input.step==='settings')await getGastroSettings(db,company,()=>readLegacy('gastro_settings_get',{}));
 else if(input.step==='image'){
  const id=String(input.imageId||'');if(!id)throw new Error('Seleccioná una imagen del menú.');
  // getMenuFile validates company ownership and keeps images already stored locally.
  await getMenuFile(db,company,id,imageId=>readLegacy('gastro_menu_preview',{idImagen:imageId}));
 }else throw new Error('Paso de migración inválido.');
 return gastroMigrationStatus(db,company);
}
