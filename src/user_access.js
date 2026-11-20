// Access changes preserve business data and memberships in unrelated companies.
export async function changeUserAccess(pool, {userId, actorId, active, companyId, restore=false, remove=false}) {
  if (!/^[1-9]\d*$/.test(String(userId)) || !Number.isSafeInteger(Number(userId))) throw Error('Usuario inválido.');
  if (Number(userId) === Number(actorId)) throw Error('No podés modificar tu propio acceso.');
  if (!remove && companyId === undefined && typeof active !== 'boolean') throw Error('El estado debe ser verdadero o falso.');
  if (companyId !== undefined && (typeof companyId !== 'string' || !companyId.trim())) throw Error('Empresa inválida.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize lifecycle mutations, including concurrent attempts to remove administrators.
    await client.query('LOCK TABLE panel_users IN SHARE ROW EXCLUSIVE MODE');
    const {rows} = await client.query('SELECT user_id, role, active FROM panel_users WHERE user_id=$1 FOR UPDATE', [Number(userId)]);
    if (!rows[0]) throw Error('Usuario no encontrado.');
    if (String(rows[0].role).toUpperCase() === 'SUPERADMIN') {
      if (companyId !== undefined) throw Error('Las cuentas SUPERADMIN tienen acceso global; no se asignan a una empresa.');
      // Other SUPERADMINs can be suspended, restored or deleted, but the
      // last active DB superadministrator must never be disabled or removed.
      if (remove || (active === false && rows[0].active)) {
        const others=await client.query("SELECT user_id FROM panel_users WHERE role='SUPERADMIN' AND active=TRUE AND user_id<>$1",[Number(userId)]);
        if (!others.rows.length) throw Error('No se puede suspender ni eliminar el último superadministrador activo.');
      }
    }
    if (remove) {
      await client.query('DELETE FROM panel_user_companies WHERE user_id=$1', [Number(userId)]);
      await client.query('DELETE FROM panel_users WHERE user_id=$1', [Number(userId)]);
    } else if (companyId !== undefined && restore) {
      const company=await client.query("SELECT company_id FROM panel_companies WHERE company_id=$1 AND service_state<>'ARCHIVED'",[companyId]);
      if (!company.rows.length) throw Error('Empresa no encontrada o archivada.');
      await client.query('INSERT INTO panel_user_companies (user_id,company_id) VALUES ($1,$2) ON CONFLICT (user_id,company_id) DO NOTHING',[Number(userId),companyId]);
    } else if (companyId !== undefined) {
      await client.query('DELETE FROM panel_user_companies WHERE user_id=$1 AND company_id=$2', [Number(userId), companyId]);
    } else {
      await client.query('UPDATE panel_users SET active=$2, session_version=session_version+1, updated_at=NOW() WHERE user_id=$1', [Number(userId), active]);
    }
    await client.query('COMMIT');
    return {ok:true};
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

export function registerUserAccessRoutes(app, {pool, authRequired, requireSuperadmin}) {
  const handler = (company, restore=false, remove=false) => async (req, res) => {
    try {
      const result = await changeUserAccess(pool, {userId:req.params.userId, actorId:req.session?.uid, restore, remove,
        ...(company ? {companyId:req.params.companyId} : {active:req.body?.active})});
      return res.json(result);
    } catch (err) { return res.status(400).json({ok:false,error:err.message}); }
  };
  app.post('/api/admin/users/:userId/companies/:companyId', authRequired, requireSuperadmin, handler(true,true));
  app.delete('/api/admin/users/:userId', authRequired, requireSuperadmin, handler(false,false,true));
  app.post('/api/admin/users/:userId/active', authRequired, requireSuperadmin, handler(false));
  app.delete('/api/admin/users/:userId/companies/:companyId', authRequired, requireSuperadmin, handler(true));
}
