export async function initMotorSnapshot(db){await db.query(`CREATE TABLE IF NOT EXISTS panel_motor_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),snapshot JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);}
export function validateMotorSnapshot(snapshot){
 if(!snapshot||!Array.isArray(snapshot.empresas)||!snapshot.empresas.length)throw new Error('La configuración del motor está vacía.');
 const ids=new Set(),phones=new Set();
 for(const c of snapshot.empresas){
  if(!c?.idEmpresa||!/^\d+$/.test(String(c.phoneNumberId||''))||!c.context||typeof c.context!=='object'||Array.isArray(c.context))throw new Error('Configuración de empresa incompleta.');
  if(ids.has(c.idEmpresa)||phones.has(String(c.phoneNumberId)))throw new Error('Empresas o números duplicados.');
  ids.add(c.idEmpresa);phones.add(String(c.phoneNumberId));
 }
 return snapshot;
}
export async function saveMotorSnapshot(db,snapshot){validateMotorSnapshot(snapshot);await db.query(`INSERT INTO panel_motor_snapshot(id,snapshot) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=NOW()`,[JSON.stringify(snapshot)]);return {companies:snapshot.empresas.length};}
export async function readMotorSnapshot(db){return (await db.query('SELECT snapshot FROM panel_motor_snapshot WHERE id=1')).rows[0]?.snapshot||null;}
