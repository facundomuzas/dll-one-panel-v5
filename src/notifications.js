// Lectura por usuario y empresa. Los avisos no dependen de Apps Script.
export async function initNotifications(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS panel_notification_users (
    company_id TEXT NOT NULL, actor TEXT NOT NULL, baseline_id BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(company_id,actor))`);
  await db.query(`CREATE TABLE IF NOT EXISTS panel_notification_reads (
    company_id TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,
    last_message_id BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(company_id,actor,client_id))`);
}
export function notificationActor(session) {
  return Number(session?.uid) ? `USER:${session.uid}` : `ENV:${session?.sub || ''}`;
}
export async function getNotifications(db, companyId, actor) {
  // Primer ingreso: no considerar como nuevos los mensajes históricos.
  await db.query(`INSERT INTO panel_notification_users(company_id,actor,baseline_id)
    SELECT $1,$2,COALESCE(MAX(id),0) FROM panel_conversation_messages WHERE company_id=$1
    ON CONFLICT(company_id,actor) DO NOTHING`,[companyId,actor]);
  const [chats,orders,quotes,signals] = await Promise.all([
    db.query(`WITH messages AS (
      SELECT m.client_id, MAX(m.id) AS last_id,
        COUNT(*) FILTER (WHERE m.id>GREATEST(u.baseline_id,COALESCE(r.last_message_id,0))
          AND m.sender_type IN ('CLIENTE','BOT'))::int AS unread
      FROM panel_conversation_messages m
      JOIN panel_notification_users u ON u.company_id=m.company_id AND u.actor=$2
      LEFT JOIN panel_notification_reads r ON r.company_id=m.company_id AND r.actor=$2 AND r.client_id=m.client_id
      WHERE m.company_id=$1 GROUP BY m.client_id
    ) SELECT COALESCE(m.client_id,s.client_id) AS client_id, COALESCE(m.last_id,0)::text AS last_id,
       COALESCE(m.unread,0)::int AS unread, COALESCE(s.mode,'BOT')='HUMANO' AS human,
       COALESCE(s.customer_name,'') AS name
      FROM messages m FULL JOIN (SELECT * FROM panel_chat_state WHERE company_id=$1) s USING(client_id)
      WHERE COALESCE(m.unread,0)>0 OR s.mode='HUMANO'`,[companyId,actor]),
    db.query(`SELECT order_id, customer_name, order_state, payment_state FROM panel_orders
      WHERE company_id=$1 AND order_state<>'CANCELADO'
      AND (order_state<>'ENTREGADO' OR payment_state IN ('PENDIENTE','COMPROBANTE_RECIBIDO'))
      ORDER BY created_at ASC`,[companyId]),
    db.query(`SELECT quote_id,customer_name FROM panel_delivery_quotes
      WHERE company_id=$1 AND state='PENDIENTE' ORDER BY created_at ASC`,[companyId]),
    db.query(`SELECT
      (SELECT COALESCE(MAX(id),0)::text FROM panel_conversation_messages WHERE company_id=$1 AND sender_type IN ('CLIENTE','BOT')) AS messages,
      (SELECT COALESCE(MAX(id),0)::text FROM panel_orders WHERE company_id=$1) AS orders,
      (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at)*1000),0)::bigint::text FROM panel_delivery_quotes WHERE company_id=$1 AND state='PENDIENTE') AS delivery,
      (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at)*1000),0)::bigint::text FROM panel_chat_state WHERE company_id=$1 AND mode='HUMANO') AS human,
      (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at)*1000),0)::bigint::text FROM panel_orders WHERE company_id=$1 AND order_state<>'CANCELADO' AND payment_state='COMPROBANTE_RECIBIDO') AS receipts,
      (SELECT COALESCE(MAX(EXTRACT(EPOCH FROM updated_at)*1000),0)::bigint::text FROM panel_receipts WHERE company_id=$1 AND state IN ('PENDIENTE','SIN_PEDIDO','DESCARGA_FALLIDA')) AS files,
      (SELECT COUNT(*)::int FROM panel_receipts WHERE company_id=$1 AND state IN ('PENDIENTE','SIN_PEDIDO','DESCARGA_FALLIDA')) AS pending_receipts`,[companyId])
  ]);
  const items=chats.rows.map(x=>({clientId:x.client_id,lastMessageId:x.last_id,unread:Number(x.unread),human:x.human,name:x.name}));
  const counts={receipts:Number(signals.rows[0]?.pending_receipts||0),conversations:items.length,unread:items.filter(x=>x.unread>0).length,
    human:items.filter(x=>x.human).length, orders:orders.rows.length, delivery:quotes.rows.length,
    payments:orders.rows.filter(x=>['PENDIENTE','COMPROBANTE_RECIBIDO'].includes(x.payment_state)).length};
  return {counts,chats:items,signals:signals.rows[0],updatedAt:new Date().toISOString()};
}
export async function markThreadRead(db,companyId,actor,clientId,lastId) {
  if(!/^\d{1,19}$/.test(String(lastId))) throw new Error('Marca de lectura inválida.');
  // Sólo hasta el mensaje efectivamente mostrado. Nunca usa NOW(), para no
  // ocultar mensajes que llegaron entre la carga y la confirmación de lectura.
  await db.query(`INSERT INTO panel_notification_reads(company_id,actor,client_id,last_message_id)
    SELECT $1,$2,$3,COALESCE(MAX(id),0) FROM panel_conversation_messages
    WHERE company_id=$1 AND client_id=$3 AND id <= $4::bigint
    ON CONFLICT(company_id,actor,client_id) DO UPDATE SET
      last_message_id=GREATEST(panel_notification_reads.last_message_id,EXCLUDED.last_message_id)`,
    [companyId,actor,clientId,String(lastId)]);
}
