import {Router} from 'express';
import {isSales} from './sales_catalog.js';
import {previewSalesPrices,applySalesPrices,exportSalesCsv} from './sales_tools.js';

// Montado detrás de autenticación, pertenencia a empresa y configuración de módulo.
export function salesToolsRouter(db,getCompany){
 const router=Router({mergeParams:true});
 router.use(async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try{
   req.salesCompany=await getCompany(req.params.companyId);
   if(!req.salesCompany)return res.status(404).json({ok:false,error:'Empresa no encontrada.'});
   if(!isSales(req.salesCompany))return res.status(403).json({ok:false,error:'Esta sección requiere ONE Ventas.'});
   const access=req.session?.role==='SUPERADMIN'?{permissions:{}}:(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session.uid])).rows[0];
   req.salesCanEdit=!!access&&access.permissions?.view!==false&&access.permissions?.editCatalog!==false;
   next();
  }catch{res.status(503).json({ok:false,error:'No se pudo verificar el acceso.'});}
 });
 router.get('/',(req,res)=>res.json({ok:true,canEdit:req.salesCanEdit}));
 router.get('/export',async(req,res)=>{try{res.json({ok:true,...await exportSalesCsv(db,req.salesCompany)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo exportar el catálogo.':e.message});}});
 router.use((req,res,next)=>req.salesCanEdit?next():res.status(403).json({ok:false,error:'No tenés permiso para editar el catálogo.'}));
 router.post('/preview',async(req,res)=>{try{res.json({ok:true,...await previewSalesPrices(db,req.salesCompany,req.body)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo calcular la vista previa.':e.message});}});
 router.post('/apply',async(req,res)=>{try{res.json({ok:true,...await applySalesPrices(db,req.salesCompany,req.body||{},req.session.uid)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo aplicar el ajuste. Recargá el catálogo.':e.message});}});
 return router;
}
