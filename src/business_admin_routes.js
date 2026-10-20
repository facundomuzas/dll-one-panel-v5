import {Router} from 'express';
import {readBusinessAdmin,changeBusinessAdmin,businessLogo} from './business_admin.js';

// El servidor monta este router después del acceso global a la empresa.
export function businessAdminRouter(db,getCompany) {
  const router=Router({mergeParams:true});
  async function canEdit(req) {
    if(req.session?.role==='SUPERADMIN')return true;
    const access=(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session.uid])).rows[0];
    return !!access&&access.permissions?.view!==false&&access.permissions?.editBusiness!==false;
  }
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/',async(req,res)=>{try{
    const company=await getCompany(req.params.companyId);if(!company)return res.sendStatus(404);
    res.json({ok:true,...await readBusinessAdmin(db,company),canEdit:await canEdit(req)});
  }catch{res.status(503).json({ok:false,error:'No se pudieron cargar los datos del negocio. Revisá los locales sincronizados.'});}});
  router.post('/',async(req,res)=>{try{
    if(!await canEdit(req))return res.status(403).json({ok:false,error:'No tenés permiso para editar el negocio.'});
    const company=await getCompany(req.params.companyId);if(!company)return res.sendStatus(404);
    res.json({ok:true,...await changeBusinessAdmin(db,company,req.body||{}),canEdit:true});
  }catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar el negocio. Recargá los datos.':e.message});}});
  router.get('/logo',async(req,res)=>{try{
    const logo=await businessLogo(db,req.params.companyId);if(!logo)return res.sendStatus(404);
    res.set({'Content-Type':logo.logo_mime,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
    res.send(Buffer.from(logo.logo_data));
  }catch{res.sendStatus(503);}});
  return router;
}
