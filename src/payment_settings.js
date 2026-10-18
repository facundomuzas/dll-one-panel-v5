import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
export async function initPayments(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_payment_settings(company_id TEXT PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK(mode IN ('MANUAL','MP')),secrets TEXT,collector_id TEXT,live_mode BOOLEAN NOT NULL DEFAULT FALSE,revision INTEGER NOT NULL DEFAULT 0)`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_payment_intents(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,kind TEXT NOT NULL,event_id TEXT NOT NULL DEFAULT '',target_id TEXT NOT NULL,amount_cents BIGINT NOT NULL,currency TEXT NOT NULL DEFAULT 'ARS',collector_id TEXT NOT NULL,live_mode BOOLEAN NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',preference_id TEXT,checkout_url TEXT,payment_id TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(company_id,kind,target_id))`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_payment_notifications(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,client_id TEXT NOT NULL,message TEXT NOT NULL,sent BOOLEAN NOT NULL DEFAULT FALSE,attempts INTEGER NOT NULL DEFAULT 0,next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
function key(){const k=Buffer.from(process.env.MP_CREDENTIALS_KEY||'','base64');if(k.length!==32)throw Error('Falta configurar MP_CREDENTIALS_KEY en el servidor (32 bytes en base64).');return k;}
export function sealSecrets(company,value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(company));const data=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function openSecrets(company,value){try{const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const c=createDecipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(company));c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(data),c.final()]).toString());}catch{throw Error('No se pudieron abrir las credenciales. Revisá la clave de cifrado del servidor.');}}
export function publicBase(){const u=new URL(process.env.PUBLIC_PANEL_URL||'');if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('PUBLIC_PANEL_URL debe ser el origen HTTPS del panel, sin rutas.');return u.origin;}
export const webhookUrl=company=>publicBase()+'/payments/mercadopago/'+encodeURIComponent(company);
export async function paymentSettings(db,company){const r=(await db.query('SELECT * FROM panel_payment_settings WHERE company_id=$1',[company])).rows[0];let url='';try{url=webhookUrl(company);}catch{}return {mode:r?.mode||'MANUAL',configured:!!r?.secrets,collectorId:r?.collector_id||'',liveMode:r?.live_mode===true,revision:r?.revision||0,webhookUrl:url};}
export async function mpRequest(token,path,{method='GET',body,requestId,fetcher=fetch}={}){
 let response;try{response=await fetcher('https://api.mercadopago.com'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(requestId?{'X-Idempotency-Key':requestId}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}catch{throw Error('Mercado Pago no respondió. Reintentá en un momento.');}
 const data=await response.json().catch(()=>null);if(!response.ok||!data)throw Error('Mercado Pago rechazó la consulta (HTTP '+response.status+'). Revisá las credenciales o reintentá.');return data;
}
export async function savePaymentSettings(db,company,input,fetcher=fetch){
 if(!['MANUAL','MP'].includes(input.mode))throw Error('Elegí revisión manual o Mercado Pago.');
 const cx=await db.connect();try{await cx.query('BEGIN');await cx.query('INSERT INTO panel_payment_settings(company_id) VALUES($1) ON CONFLICT DO NOTHING',[company]);const old=(await cx.query('SELECT * FROM panel_payment_settings WHERE company_id=$1 FOR UPDATE',[company])).rows[0];
 if(!Number.isInteger(input.revision)||input.revision!==old.revision)throw Error('La configuración cambió. Recargá antes de guardar.');
 let encrypted=old.secrets,collector=old.collector_id,live=old.live_mode;
 if(input.mode==='MP'){
  publicBase();const prev=old.secrets?openSecrets(company,old.secrets):{};
  const token=String(input.accessToken||prev.accessToken||'').trim(),secret=String(input.webhookSecret||prev.webhookSecret||'').trim();
  if(!token||token.length>1000||secret.length<16||secret.length>1000)throw Error('Completá Access Token y secreto Webhook de Mercado Pago.');
  live=input.liveMode===true;
  const me=await mpRequest(token,'/users/me',{fetcher});
  if(!me.id||me.site_id!=='MLA'||(typeof me.id==='number'&&!Number.isSafeInteger(me.id)))throw Error('Se requiere una cuenta argentina válida de Mercado Pago.');
  collector=String(me.id);
  if(old.collector_id&&(old.collector_id!==collector||old.live_mode!==live)&&(await cx.query('SELECT 1 FROM panel_payment_intents WHERE company_id=$1 LIMIT 1',[company])).rows.length)throw Error('Hay cobros asociados a esta cuenta/entorno. Conservá la conexión para conciliar sus pagos. Usá otra empresa para pruebas.');
  encrypted=sealSecrets(company,{accessToken:token,webhookSecret:secret});
 }
 await cx.query('UPDATE panel_payment_settings SET mode=$2,secrets=$3,collector_id=$4,live_mode=$5,revision=revision+1 WHERE company_id=$1',[company,input.mode,encrypted,collector,live]);await cx.query('COMMIT');return paymentSettings(db,company);
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
export function cents(value){const s=String(value??'');if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Importe inválido. Usá hasta dos decimales.');const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n>10000000000)throw Error('Importe fuera de rango.');return n;}
