import {dateMs,formatDateAr} from './dates.js';
export async function liveCustomers(db,companyId,legacy=[]) {
  const result=await db.query(`WITH activity AS (
    SELECT client_id, customer_name, wa_id, last_message_at AS at FROM panel_chat_state WHERE company_id=$1
    UNION ALL
    SELECT client_id, customer_name, wa_id, created_at AS at FROM panel_orders WHERE company_id=$1
  ) SELECT DISTINCT ON(client_id) client_id,customer_name,wa_id,at FROM activity
    WHERE client_id<>'' ORDER BY client_id,at DESC NULLS LAST`,[companyId]);
  const map=new Map();
  for(const row of legacy) {
    const id=String(row.ID_CLIENTE || row.idCliente || '').trim();
    if(id) map.set(id,{...row,ID_CLIENTE:id});
  }
  for(const row of result.rows) {
    const old=map.get(row.client_id)||{};
    map.set(row.client_id,{...old,ID_CLIENTE:row.client_id,
      NOMBRE:row.customer_name || old.NOMBRE || '',TELEFONO:row.wa_id || old.TELEFONO || '',
      ULTIMA_INTERACCION:dateMs(row.at)>=dateMs(old.ULTIMA_INTERACCION)?formatDateAr(row.at,true):old.ULTIMA_INTERACCION});
  }
  return [...map.values()].sort((a,b)=>dateMs(b.ULTIMA_INTERACCION)-dateMs(a.ULTIMA_INTERACCION));
}
