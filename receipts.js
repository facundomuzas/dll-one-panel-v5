let receiptList=[];
function receiptFileLink(r,company=companyId){
 return r.available?`<a class="btn btn-light" target="_blank" rel="noopener" href="/api/company/${encodeURIComponent(company)}/receipts/${encodeURIComponent(r.id)}/file">${r.mime==='application/pdf'?'Descargar PDF':'Abrir imagen'}</a>`:`<span class="status bad">Archivo no disponible: pedí que lo reenvíen</span>`;
}
async function loadReceipts(){
 const company=companyId;
 const r=await api(`/api/company/${encodeURIComponent(company)}/receipts`);
 if(company!==companyId)return;
 receiptList=r.items||[];
 const labels={PENDIENTE:'Por revisar',SIN_PEDIDO:'Elegir pedido',DESCARGA_FALLIDA:'No se pudo descargar',ARCHIVO:'Archivo sin asociar',ACEPTADO:'Pago confirmado',RECHAZADO:'Rechazado',ARCHIVADO:'Archivado',CERRADO_PAGO:'Pago resuelto desde el pedido'};
 $('receiptsTable').innerHTML=receiptList.length?receiptList.map(item=>{
  const active=['PENDIENTE','SIN_PEDIDO','DESCARGA_FALLIDA','ARCHIVO'].includes(item.state);
  return `<article class="order-card"><strong>${esc(item.customer_name||item.client_id)}</strong>
   <div>${esc(labels[item.state]||item.state)} · ${esc(new Date(item.created_at).toLocaleString('es-AR'))}</div>
   <p>Pedido: ${esc(item.order_id||'Sin vincular')}</p><p>${esc(item.caption||'Sin texto adjunto')}</p>
   <div class="mini-actions">${receiptFileLink(item,company)}
    ${active&&item.available?`<button class="btn btn-light" onclick="chooseReceiptOrder('${esc(item.id)}')">Elegir / corregir pedido</button>`:''}
    ${active&&item.available&&item.order_id?`<button class="btn btn-primary" onclick="receiptAction('${esc(item.id)}','ACEPTAR')">Confirmar pago</button>`:''}
    ${active?`<button class="btn btn-light" onclick="receiptAction('${esc(item.id)}','RECHAZAR')">Rechazar</button><button class="btn btn-light" onclick="receiptAction('${esc(item.id)}','ARCHIVAR')">Archivar</button>`:''}
   </div><div id="receiptOrders${esc(item.id)}"></div>
   ${item.reviewed_by?`<small>Revisado por ${esc(item.reviewed_by)}</small>`:''}</article>`;
 }).join(''):'<div class="empty">Todavía no hay archivos recibidos.</div>';
}
async function chooseReceiptOrder(id){
 try{
  const company=companyId;const r=await api(`/api/company/${encodeURIComponent(company)}/receipts/${encodeURIComponent(id)}/orders`);
  if(company!==companyId)return;
  const box=$('receiptOrders'+id);if(!box)return;
  box.innerHTML=(r.items||[]).length?`<p>Elegí el pedido de este cliente:</p><select id="receiptSelect${esc(id)}">${r.items.map(x=>`<option value="${esc(x.order_id)}">${esc(x.order_id)} · ${esc(money(x.total))}</option>`).join('')}</select><button class="btn btn-light" onclick="receiptAction('${esc(id)}','VINCULAR',$('receiptSelect${esc(id)}').value)">Vincular</button>`:'<p>No hay pedidos por transferencia pendientes para este cliente. Podés archivar el archivo o revisarlo desde Conversaciones.</p>';
 }catch(err){showNotice(err.message);}
}
let receiptActionBusy=false;
async function receiptAction(id,action,orderId=''){
 if(receiptActionBusy)return;
 if(action==='ACEPTAR'&&!confirm('¿Verificaste el archivo y el ingreso del dinero? Esto confirmará el pago del pedido y avisará al cliente.'))return;
 if(action==='RECHAZAR'&&!confirm('¿Rechazar este archivo como comprobante? Si corresponde, se avisará al cliente que debe reenviarlo.'))return;
 const company=companyId;receiptActionBusy=true;
 try{
  const r=await api(`/api/company/${encodeURIComponent(company)}/receipts/${encodeURIComponent(id)}/review`,{method:'POST',body:JSON.stringify({action,orderId})});
  if(company===companyId){await loadReceipts();pollNotifications();if(r.warning)showNotice(r.warning);}
 }catch(err){showNotice(err.message);}finally{receiptActionBusy=false;}
}
