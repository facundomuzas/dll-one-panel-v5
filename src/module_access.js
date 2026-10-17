const keys=['ventas','gastro','eventos','servicios','salud'];
export const moduleFlag=(modules,key)=>{const value=modules?.[key]??modules?.['MODULO_'+key.toUpperCase()];return value===true||['SI','TRUE','1'].includes(String(value).toUpperCase());};
export function configuredModule(company,key){
 const m=company?.modules||{};
 if(!moduleFlag(m,key))return false;
 // Health and Events cannot inherit commercial screens, even with an old mixed configuration.
 if(['salud','eventos'].some(k=>moduleFlag(m,k))&&keys.filter(k=>moduleFlag(m,k)).length!==1)return false;
 // Historical Gastro+Ventas plans keep their existing Gastro behavior until the admin edits the plan.
 return key!=='ventas'||!moduleFlag(m,'gastro');
}
export function validateSingleModule(modules){if(keys.filter(k=>moduleFlag(modules,k)).length!==1)throw Error('Elegí una sola configuración por empresa. ONE Salud y ONE Eventos requieren una empresa separada.');}
export function requestedModule(path){const segment=String(path).toLowerCase().split('/').filter(Boolean)[0];return {health:'salud',gastro:'gastro',catalog:'ventas',events:'eventos',eventos:'eventos'}[segment]||null;}
export function requireConfiguredModule(getCompany){return async(req,res,next)=>{
 const key=requestedModule(req.path);if(!key)return next();
 try{const company=await getCompany(req.params.companyId);if(!company)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});
 if(!configuredModule(company,key))return res.status(403).json({ok:false,error:'Esta empresa no está configurada para ONE '+{salud:'Salud',gastro:'Gastro',ventas:'Ventas',eventos:'Eventos'}[key]+'. Seleccioná la empresa correspondiente.'});
 req.moduleCompany=company;return next();
 }catch{return res.status(503).json({ok:false,error:'No se pudo verificar la configuración de la empresa.'});}
};}
