import bcrypt from 'bcryptjs';

// Do not return, print or store plaintext passwords. Bcrypt truncates input
// after 72 UTF-8 bytes, so reject longer passwords instead of silently losing entropy.
export function validateNewPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value,'utf8') > 72) {
    throw Error('La contraseña nueva debe tener al menos 12 caracteres y no superar 72 bytes.');
  }
  return value;
}

export async function resetUserPassword(pool,{actorId,userId,newPassword}) {
  if (!/^[1-9]\d*$/.test(String(userId)) || !Number.isSafeInteger(Number(userId))) {
    throw Error('Usuario inválido.');
  }
  if (!Number.isSafeInteger(Number(actorId)) || Number(actorId) < 0) {
    throw Error('Administrador inválido.');
  }
  if (Number(actorId) === Number(userId)) {
    throw Error('No podés restablecer tu propia contraseña desde la administración de usuarios.');
  }
  validateNewPassword(newPassword);
  const passwordHash=await bcrypt.hash(newPassword,12);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows}=await client.query(
      `UPDATE panel_users
       SET password_hash=$2,
           session_version=session_version+1,
           updated_at=NOW()
       WHERE user_id=$1
       RETURNING user_id, role, active, session_version`,
      [Number(userId),passwordHash]
    );
    if (!rows.length) throw Error('Usuario no encontrado.');
    await client.query(
      "INSERT INTO panel_user_security_log (actor_user_id,target_user_id,action) VALUES ($1,$2,'RESET_PASSWORD')",
      [Number(actorId),Number(userId)]
    );
    await client.query('COMMIT');
    return {ok:true,userId:Number(rows[0].user_id),sessionsRevoked:true,active:rows[0].active};
  } catch(err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function registerPasswordResetRoutes(app,{pool,authRequired,requireSuperadmin}) {
  app.post('/api/admin/users/:userId/password',authRequired,requireSuperadmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      const result=await resetUserPassword(pool,{
        actorId:req.session?.uid,
        userId:req.params.userId,
        newPassword:req.body?.newPassword
      });
      return res.json(result);
    } catch(err) {
      if (/contraseña nueva|Usuario inválido|Administrador inválido|propia contraseña|Usuario no encontrado/.test(err.message||'')) {
        return res.status(400).json({ok:false,error:err.message});
      }
      return res.status(503).json({ok:false,error:'No se pudo restablecer la contraseña. Reintentá.'});
    }
  });
}
