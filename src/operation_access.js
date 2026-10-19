// Debe ejecutarse después de autenticación y acceso a la empresa.
export function requireCompanyOperation(db) {
  return async function canOperate(req, res, next) {
    if (req.session?.role === 'SUPERADMIN') return next();
    const uid = req.session?.uid;
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      return res.status(403).json({ok:false,error:'No tenés permiso para operar.'});
    }
    try {
      const {rows} = await db.query(
        `SELECT uc.permissions FROM panel_user_companies uc
         JOIN panel_users u ON u.user_id=uc.user_id
         WHERE uc.user_id=$1 AND uc.company_id=$2 AND u.active=TRUE`,
        [uid, req.params.companyId]
      );
      const access = rows[0];
      if (!access || access.permissions?.view === false || access.permissions?.operate === false) {
        return res.status(403).json({ok:false,error:'No tenés permiso para operar.'});
      }
      return next();
    } catch {
      return res.status(503).json({ok:false,error:'No se pudo verificar el permiso.'});
    }
  };
}
