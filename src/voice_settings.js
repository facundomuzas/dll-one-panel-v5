export async function initVoiceSettings(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_voice_settings(company_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,voice_id TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_by TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_voice_audit(id BIGSERIAL PRIMARY KEY,company_id TEXT NOT NULL,enabled BOOLEAN NOT NULL,voice_id TEXT NOT NULL,actor TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_voice_preferences(company_id TEXT NOT NULL,contact TEXT NOT NULL,mode TEXT NOT NULL,PRIMARY KEY(company_id,contact))`);
}
export async function getVoiceSettings(db,id){const r=(await db.query('SELECT enabled,voice_id,revision FROM panel_voice_settings WHERE company_id=$1',[id])).rows[0];return {enabled:r?.enabled===true,voiceId:r?.voice_id||'',revision:r?.revision||0};}
export async function saveVoiceSettings(db,id,input,user){
 if(user?.role!=='SUPERADMIN')throw Error('Solo Super Admin puede configurar ElevenLabs.');
 if(typeof input.enabled!=='boolean'||!Number.isInteger(input.revision)||input.revision<0)throw Error('Configuración inválida.');
 const voiceId=String(input.voiceId||'').trim();if((voiceId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(voiceId))||(input.enabled&&!voiceId))throw Error('Ingresá un ID de voz válido.');
 const cx=await db.connect();try{await cx.query('BEGIN');
 const company=(await cx.query('SELECT company_id FROM panel_companies WHERE company_id=$1 FOR UPDATE',[id])).rows[0];if(!company)throw Error('Empresa no encontrada.');
 const old=await getVoiceSettings(cx,id);if(old.revision!==input.revision)throw Error('La configuración cambió. Recargá las empresas.');
 const actor=String(user.sub||'SUPERADMIN').slice(0,200);
 await cx.query(`INSERT INTO panel_voice_settings(company_id,enabled,voice_id,revision,updated_by) VALUES($1,$2,$3,1,$4) ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled,voice_id=EXCLUDED.voice_id,revision=panel_voice_settings.revision+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[id,input.enabled,voiceId,actor]);
 await cx.query('INSERT INTO panel_voice_audit(company_id,enabled,voice_id,actor) VALUES($1,$2,$3,$4)',[id,input.enabled,voiceId,actor]);
 const result=await getVoiceSettings(cx,id);await cx.query('COMMIT');return result;
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
export async function voicePreference(db,id,contact,mode){
 if(!contact||String(contact).length>120)throw Error('Contacto inválido.');
 if(mode!==undefined){if(!['audio','text'].includes(mode))throw Error('Preferencia inválida.');await db.query('INSERT INTO panel_voice_preferences(company_id,contact,mode) VALUES($1,$2,$3) ON CONFLICT(company_id,contact) DO UPDATE SET mode=EXCLUDED.mode',[id,contact,mode]);}
 return (await db.query('SELECT mode FROM panel_voice_preferences WHERE company_id=$1 AND contact=$2',[id,contact])).rows[0]?.mode||null;
}
