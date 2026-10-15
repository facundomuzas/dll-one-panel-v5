export const MAX_MEDIA_BYTES=5*1024*1024;
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
export function decodeMedia(mime,base64){
  if(!types[mime])throw Error('Se admiten JPG, PNG, WEBP y PDF.');
  if(typeof base64!=='string'||base64.length>Math.ceil(MAX_MEDIA_BYTES/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('Archivo inválido o supera 5 MB.');
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)throw Error('Archivo vacío o supera 5 MB.');
  const valid=mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):
    mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes.toString('ascii',0,5)==='%PDF-';
  if(!valid)throw Error('El contenido no corresponde al tipo de archivo.');
  return bytes;
}
export async function initReceipts(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_receipts (
  id BIGSERIAL PRIMARY KEY, company_id TEXT NOT NULL, client_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL, wa_id TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
  wamid TEXT NOT NULL, media_id TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '', data BYTEA, download_error TEXT NOT NULL DEFAULT '',
  order_id TEXT, state TEXT NOT NULL, reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,wamid))`);
 await db.query('CREATE INDEX IF NOT EXISTS panel_receipts_company_state ON panel_receipts(company_id,state,created_at DESC)');
 await db.query('CREATE INDEX IF NOT EXISTS panel_receipts_thread ON panel_receipts(company_id,client_id,created_at DESC)');
}
const columns="id::text,company_id,client_id,customer_name,wamid,mime,caption,order_id,state,download_error,created_at,reviewed_by,reviewed_at,(data IS NOT NULL) AS available";
export async function candidates(db,companyId,clientId){
 return (await db.query(`SELECT order_id,total,created_at FROM panel_orders WHERE company_id=$1 AND client_id=$2
  AND payment_method='TRANSFERENCIA' AND payment_state IN ('PENDIENTE','RECHAZADO','COMPROBANTE_RECIBIDO')
  AND order_state<>'CANCELADO' ORDER BY created_at DESC`,[companyId,clientId])).rows;
}
export async function storeReceipt(db,body){
 const {companyId,phoneNumberId,wamid,mediaId}=body;
 const waId=String(body.waId||'').replace(/\D/g,'');const clientId='WA_'+waId;
 if(!companyId||!phoneNumberId||!wamid||!mediaId||!waId)throw Error('Faltan datos del archivo.');
 const caption=String(body.caption||'').slice(0,4096),mime=String(body.mime||'');
 const data=body.base64?decodeMedia(mime,body.base64):null;
 if(!data&&!body.downloadError)throw Error('Falta el contenido del archivo.');
 const cx=await db.connect();
 try{
  await cx.query('BEGIN');
  const company=(await cx.query('SELECT company_id FROM panel_companies WHERE company_id=$1 AND phone_number_id=$2 FOR UPDATE',[companyId,phoneNumberId])).rows[0];
  if(!company)throw Error('Empresa o número incorrectos.');
  // Evita asociar dos archivos concurrentes a pedidos distintos durante la selección.
  const existing=(await cx.query(`SELECT ${columns} FROM panel_receipts WHERE company_id=$1 AND wamid=$2`,[companyId,wamid])).rows[0];
  if(existing){await cx.query('COMMIT');return {receipt:existing,duplicate:true};}
  const options=await candidates(cx,companyId,clientId);
  const explicit=caption.toUpperCase().match(/\bPED-[A-Z0-9-]+\b/)?.[0];
  const order=explicit?options.find(x=>x.order_id.toUpperCase()===explicit):options.length===1?options[0]:null;
  const receiptIntent=!!order||options.length>0||/comprobante|transfer|pago|pagu[eé]|abon[eé]/i.test(caption);
  const state=!data?'DESCARGA_FALLIDA':!receiptIntent?'ARCHIVO':order?'PENDIENTE':'SIN_PEDIDO';
  const result=await cx.query(`INSERT INTO panel_receipts(company_id,client_id,phone_number_id,wa_id,customer_name,wamid,media_id,mime,caption,data,download_error,order_id,state)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${columns}`,
   [companyId,clientId,phoneNumberId,waId,String(body.customerName||'').slice(0,200),wamid,mediaId,mime,caption,data,
    data?'':String(body.downloadError||'No se pudo descargar.').slice(0,300),order?.order_id||null,state]);
  if(order&&data)await cx.query(`UPDATE panel_orders SET payment_state='COMPROBANTE_RECIBIDO',updated_at=NOW()
   WHERE company_id=$1 AND order_id=$2 AND payment_state IN ('PENDIENTE','RECHAZADO','COMPROBANTE_RECIBIDO')`,[companyId,order.order_id]);
  await cx.query('COMMIT');return {receipt:result.rows[0],duplicate:false};
 }catch(err){await cx.query('ROLLBACK');throw err;}finally{cx.release();}
}
export async function listReceipts(db,companyId,clientId=null){
 return (await db.query(`WITH selected AS (SELECT * FROM panel_receipts WHERE company_id=$1 AND ($2::text IS NULL OR client_id=$2))
  SELECT ${columns} FROM selected WHERE state IN ('PENDIENTE','SIN_PEDIDO','DESCARGA_FALLIDA')
   OR id IN (SELECT id FROM selected ORDER BY created_at DESC LIMIT 100)
  ORDER BY CASE WHEN state IN ('PENDIENTE','SIN_PEDIDO','DESCARGA_FALLIDA') THEN 0 ELSE 1 END,created_at DESC`,[companyId,clientId])).rows;
}
export async function reviewReceipt(db,companyId,id,action,orderId,actor){
 if(!['VINCULAR','ACEPTAR','RECHAZAR','ARCHIVAR'].includes(action))throw Error('Acción inválida.');
 const cx=await db.connect();
 try{
  await cx.query('BEGIN');
  const r=(await cx.query('SELECT * FROM panel_receipts WHERE company_id=$1 AND id=$2 FOR UPDATE',[companyId,id])).rows[0];
  if(!r)throw Error('Archivo no encontrado.');
  if(['ACEPTADO','RECHAZADO','ARCHIVADO','CERRADO_PAGO'].includes(r.state))throw Error('Este archivo ya fue revisado.');
  let order=r.order_id;
  if(action==='VINCULAR'){
   if(!r.data)throw Error('No se puede vincular: falta descargar el archivo. Pedile al cliente que lo reenvíe.');
   const options=await candidates(cx,companyId,r.client_id);
   if(!options.some(x=>x.order_id===orderId))throw Error('El pedido no corresponde al cliente o no tiene transferencia pendiente.');
   // Si se corrige un vínculo previo, no dejar el pedido anterior con un estado falso.
   if(order && order!==orderId)await cx.query(`UPDATE panel_orders SET payment_state='PENDIENTE',updated_at=NOW() WHERE company_id=$1 AND order_id=$2
     AND payment_state='COMPROBANTE_RECIBIDO' AND NOT EXISTS(SELECT 1 FROM panel_receipts WHERE company_id=$1 AND order_id=$2 AND state='PENDIENTE' AND id<>$3)`,[companyId,order,id]);
   order=orderId;
   await cx.query(`UPDATE panel_orders SET payment_state='COMPROBANTE_RECIBIDO',updated_at=NOW() WHERE company_id=$1 AND order_id=$2 AND payment_state IN ('PENDIENTE','RECHAZADO','COMPROBANTE_RECIBIDO')`,[companyId,order]);
  }
  if(action==='ACEPTAR'){
   if(!r.data||!order)throw Error('Primero abrí el archivo y vinculalo a un pedido.');
   const changed=await cx.query(`UPDATE panel_orders SET payment_state='CONFIRMADO',
    order_state=CASE WHEN order_state='ESPERANDO_PAGO' THEN 'PENDIENTE_PREPARACION' ELSE order_state END,updated_at=NOW()
    WHERE company_id=$1 AND order_id=$2 AND client_id=$3 AND order_state<>'CANCELADO'
    AND payment_method='TRANSFERENCIA' AND payment_state IN ('PENDIENTE','RECHAZADO','COMPROBANTE_RECIBIDO') RETURNING order_id`,[companyId,order,r.client_id]);
   if(!changed.rows.length)throw Error('El pedido ya no tiene ese pago pendiente. Recargá antes de continuar.');
   await cx.query(`UPDATE panel_receipts SET state='CERRADO_PAGO',reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW()
    WHERE company_id=$1 AND order_id=$2 AND state='PENDIENTE' AND id<>$4`,[companyId,order,actor,id]);
  }
  if((action==='RECHAZAR'||action==='ARCHIVAR')&&order){
   await cx.query(`UPDATE panel_orders SET payment_state=$3,updated_at=NOW() WHERE company_id=$1 AND order_id=$2
    AND payment_state='COMPROBANTE_RECIBIDO' AND NOT EXISTS(SELECT 1 FROM panel_receipts
     WHERE company_id=$1 AND order_id=$2 AND state='PENDIENTE' AND id<>$4)`,[companyId,order,action==='RECHAZAR'?'RECHAZADO':'PENDIENTE',id]);
  }
  const state={VINCULAR:'PENDIENTE',ACEPTAR:'ACEPTADO',RECHAZAR:'RECHAZADO',ARCHIVAR:'ARCHIVADO'}[action];
  const updated=await cx.query(`UPDATE panel_receipts SET order_id=$3,state=$4,reviewed_by=$5,
   reviewed_at=CASE WHEN $4='PENDIENTE' THEN NULL ELSE NOW() END,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING ${columns}`,[companyId,id,order,state,actor]);
  await cx.query('COMMIT');return updated.rows[0];
 }catch(err){await cx.query('ROLLBACK');throw err;}finally{cx.release();}
}
