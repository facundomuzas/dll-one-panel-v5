import {getSettings,saveSettings,bookings,writeBooking,calendar} from './lodging_operations.js';
import {Router} from 'express';
import {lodgingCatalog,saveCabins} from './lodging.js';
// Company authentication, membership and module guard are applied before this router.
export function lodgingRouter(db){
 const router=Router({mergeParams:true});
 router.use(async(req,res,next)=>{res.set('Cache-Control','no-store');try{
  const access=req.session?.role==='SUPERADMIN'?{permissions:{}}:(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];
  const canView=!!access&&access.permissions?.view!==false;
  const isSuperadmin=String(req.session?.role||'').toUpperCase()==='SUPERADMIN';
  req.lodgingCanEdit=canView&&(isSuperadmin||access.permissions?.editCatalog!==false);
  req.lodgingCanOperate=canView&&(isSuperadmin||access.permissions?.operate!==false);
  req.lodgingCanConfigure=canView&&isSuperadmin;
  next();
 }catch{res.status(503).json({ok:false,error:'No se pudieron verificar los permisos.'});}});
 const writable=permission=>(req,res,next)=>{if(!req[permission]||req.moduleCompany?.service_state!=='ACTIVE')return res.status(403).json({ok:false,error:'No tenés permiso o el servicio está pausado.'});next();};
 router.get('/calendar',async(req,res)=>{try{res.json({ok:true,entries:await calendar(db,req.params.companyId,req.query.month)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo cargar el calendario.':e.message});}});
 router.get('/operations',async(req,res)=>{try{res.json({ok:true,canOperate:req.lodgingCanOperate,canConfigure:req.lodgingCanConfigure,...await getSettings(db,req.params.companyId),bookings:await bookings(db,req.params.companyId)});}catch{res.status(503).json({ok:false,error:'No se pudo cargar la agenda.'});}});
 router.post('/settings',writable('lodgingCanConfigure'),async(req,res)=>{try{res.json({ok:true,...await saveSettings(db,req.params.companyId,req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar.':e.message});}});
 router.post('/bookings',writable('lodgingCanOperate'),async(req,res)=>{try{res.json({ok:true,booking:await writeBooking(db,req.params.companyId,req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar.':e.message});}});
 router.get('/',async(req,res)=>{try{res.json({ok:true,canEdit:req.lodgingCanEdit,canOperate:req.lodgingCanOperate,canConfigure:req.lodgingCanConfigure,...await lodgingCatalog(db,req.params.companyId)});}catch{res.status(503).json({ok:false,error:'No se pudo consultar el catálogo.'});}});
 router.post('/',async(req,res)=>{
  if(!req.lodgingCanEdit)return res.status(403).json({ok:false,error:'No tenés permiso para editar.'});
  if(req.moduleCompany?.service_state!=='ACTIVE')return res.status(403).json({ok:false,error:'Servicio pausado.'});
  try{res.json({ok:true,...await saveCabins(db,req.params.companyId,req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar el catálogo.':e.message});}
 });return router;
}
