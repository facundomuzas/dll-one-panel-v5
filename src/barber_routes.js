import {Router} from 'express';
import {config,saveConfig,agenda,change} from './barber.js';
export function barberRouter(db){
 const router=Router({mergeParams:true});
 router.use(async(req,res,next)=>{res.set('Cache-Control','no-store');try{const a=req.session?.role==='SUPERADMIN'?{permissions:{}}:(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];const canView=!!a&&a.permissions?.view!==false;req.barberEdit=canView&&String(req.session?.role||'').toUpperCase()==='SUPERADMIN';req.barberOperate=canView&&a.permissions?.operate!==false;next();}catch{res.status(503).json({ok:false,error:'No se pudieron verificar los permisos.'});}});
 const gate=permission=>(req,res,next)=>req[permission]&&req.moduleCompany?.service_state==='ACTIVE'?next():res.status(403).json({ok:false,error:'No tenés permiso o el servicio está pausado.'});
 const fail=(res,e)=>res.status(e.code?503:400).json({ok:false,error:e.code?'No se pudo completar la operación.':e.message});
 router.get('/',async(req,res)=>{try{res.json({ok:true,...await config(db,req.params.companyId),canEdit:req.barberEdit,canOperate:req.barberOperate});}catch(e){fail(res,e);}});
 router.post('/',gate('barberEdit'),async(req,res)=>{try{res.json({ok:true,...await saveConfig(db,req.params.companyId,req.body||{})});}catch(e){fail(res,e);}});
 router.get('/agenda',async(req,res)=>{try{res.json({ok:true,items:await agenda(db,req.params.companyId,req.query.day)});}catch(e){fail(res,e);}});
 router.post('/appointment',gate('barberOperate'),async(req,res)=>{try{res.json({ok:true,item:await change(db,req.params.companyId,req.body||{})});}catch(e){fail(res,e);}});
 return router;
}
