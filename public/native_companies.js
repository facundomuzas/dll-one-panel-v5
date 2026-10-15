let nativeLoadSequence=0,metaWebhookBusy=false;
let nativeCreateBusy=false,nativeCreateAttempt=null,nativeConnectionRevision=null,nativeConnectionBusy=false,nativeConnectionTarget='';
async function createCompany(){
 if(nativeCreateBusy)return;
 const body={nombreEmpresa:$('adminCompanyName').value.trim(),tipoNegocio:$('adminCompanyType').value,webSlug:$('adminCompanySlug').value.trim(),phoneNumberId:$('adminCompanyPhoneId').value.trim(),modules:{ventas:$('adminModVentas').checked,gastro:$('adminModGastro').checked,eventos:$('adminModEventos').checked,servicios:$('adminModServicios').checked}};
 if(!body.nombreEmpresa){$('nativeCreateStatus').textContent='Ingresá el nombre de la empresa.';return;}
 const serialized=JSON.stringify(body);
 if(nativeCreateAttempt?.serialized!==serialized)nativeCreateAttempt={serialized,requestId:crypto.randomUUID()};
 nativeCreateBusy=true;$('nativeCreateButton').disabled=true;$('nativeCreateStatus').textContent='Creando empresa…';
 try{
  const r=await api('/api/admin/companies',{method:'POST',body:JSON.stringify({...body,requestId:nativeCreateAttempt.requestId})});
  $('nativeCreateStatus').textContent=`Empresa creada: ${body.nombreEmpresa}. Los pedidos están pausados. Cargá productos, ubicación y cobros; después configurá WhatsApp.`;
  $('adminCompanyName').value='';$('adminCompanySlug').value='';$('adminCompanyPhoneId').value='';nativeCreateAttempt=null;
  try{await refreshCompanies();$('adminConnectionCompany').value=r.idEmpresa;await loadNativeConnection();}
  catch{$('nativeCreateStatus').textContent+=' No pude actualizar la lista. Recargá el panel; la empresa ya quedó creada.';}
 }catch(err){$('nativeCreateStatus').textContent='No se pudo completar el alta: '+err.message+'. Podés reintentar con los mismos datos.';}
 finally{nativeCreateBusy=false;$('nativeCreateButton').disabled=false;}
}
async function loadNativeConnection(){
 const id=$('adminConnectionCompany').value,sequence=++nativeLoadSequence;
 $('nativeImportButton').hidden=true;$('nativeCheckStatus').textContent='';$('nativePhone').value='';$('nativeConnected').checked=false;
 nativeConnectionTarget=id;nativeConnectionRevision=null;$('nativeConnectionFields').disabled=true;$('nativeToken').value='';
 if(!id){$('nativeConnectionStatus').textContent='Seleccioná una empresa.';return;}
 $('nativeConnectionStatus').textContent='Cargando configuración…';
 try{
  const r=await api(`/api/admin/companies/${encodeURIComponent(id)}/connection`);if(id!==$('adminConnectionCompany').value||sequence!==nativeLoadSequence)return;
  if(!r.native){$('nativeConnectionStatus').textContent='Esta empresa usa su conexión anterior. Traela al panel para administrarla aquí, conservando el número, token y configuración del bot.';$('nativeImportButton').hidden=false;return;}
  nativeConnectionRevision=r.revision;$('nativePhone').value=r.phoneNumberId||'';$('nativeGraphVersion').value=r.graphVersion;$('nativeConnected').checked=r.connected;
  $('nativeToken').placeholder=r.hasToken?'Token guardado; dejá vacío para conservarlo':'Token de acceso de Meta';
  $('nativeConnectionFields').disabled=false;$('nativeConnectionStatus').textContent=r.connected?'Configuración habilitada para el motor. Comprobá que WhatsApp responda.':'Conexión pendiente o deshabilitada. Podés preparar el negocio desde el panel.';
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeConnectionStatus').textContent='No se pudo cargar: '+err.message;}
}
async function saveNativeConnectionForm(){
 if(nativeConnectionBusy||nativeConnectionRevision===null)return;
 const id=$('adminConnectionCompany').value;if(id!==nativeConnectionTarget)return;
 const body={revision:nativeConnectionRevision,phoneNumberId:$('nativePhone').value.trim(),accessToken:$('nativeToken').value.trim(),graphVersion:$('nativeGraphVersion').value.trim(),connected:$('nativeConnected').checked};
 nativeConnectionBusy=true;$('adminConnectionCompany').disabled=true;$('nativeCheckStatus').textContent='';$('nativeConnectionFields').disabled=true;$('nativeConnectionStatus').textContent='Guardando configuración…';
 try{
  const r=await api(`/api/admin/companies/${encodeURIComponent(id)}/connection`,{method:'POST',body:JSON.stringify(body)});
  if(id!==$('adminConnectionCompany').value)return;
  nativeConnectionRevision=r.revision;$('nativeToken').value='';$('nativeToken').placeholder=r.hasToken?'Token guardado; dejá vacío para conservarlo':'Token de acceso de Meta';
  $('nativeConnectionStatus').textContent=r.connected?'Configuración guardada. El motor la leerá en aproximadamente 30 segundos. Comprobá WhatsApp; el guardado no valida el token con Meta.':'Configuración guardada y conexión deshabilitada. El motor se actualizará en aproximadamente 30 segundos.';
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeConnectionStatus').textContent='No se guardó: '+err.message;}
 finally{nativeConnectionBusy=false;$('adminConnectionCompany').disabled=false;if(id===$('adminConnectionCompany').value)$('nativeConnectionFields').disabled=nativeConnectionRevision===null;}
}

async function importNativeConnectionForm(){
 if(nativeConnectionBusy)return;
 const id=$('adminConnectionCompany').value;if(!id)return;
 nativeConnectionBusy=true;$('adminConnectionCompany').disabled=true;$('nativeImportButton').disabled=true;
 $('nativeConnectionStatus').textContent='Leyendo la conexión actual del motor…';
 try{
  await api(`/api/admin/companies/${encodeURIComponent(id)}/connection/import`,{method:'POST',body:'{}'});
  if(id!==$('adminConnectionCompany').value)return;
  await loadNativeConnection();
  $('nativeConnectionStatus').textContent='Conexión importada. Conservamos el número, token y configuración del bot. Ya podés administrarla desde el panel.';
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeConnectionStatus').textContent='No se importó: '+err.message;}
 finally{nativeConnectionBusy=false;$('adminConnectionCompany').disabled=false;$('nativeImportButton').disabled=false;}
}
async function checkNativeConnectionForm(){
 if(nativeConnectionBusy||nativeConnectionRevision===null)return;
 const id=$('adminConnectionCompany').value;
 if($('nativeToken').value.trim()){$('nativeCheckStatus').textContent='Guardá primero el nuevo token. La comprobación usa los datos guardados.';return;}
 nativeConnectionBusy=true;$('adminConnectionCompany').disabled=true;$('nativeConnectionFields').disabled=true;
 $('nativeCheckStatus').textContent='Consultando el número en Meta con las credenciales guardadas…';
 try{
  const r=await api(`/api/admin/companies/${encodeURIComponent(id)}/connection/check`,{method:'POST',body:JSON.stringify({revision:nativeConnectionRevision})});
  if(id!==$('adminConnectionCompany').value)return;
  $('nativeCheckStatus').textContent=`Meta permite consultar el número guardado ${r.displayPhoneNumber||r.phoneNumberId}${r.verifiedName?' ('+r.verifiedName+')':''}. Esto no comprueba recepción del webhook ni envío de mensajes. Para verificar el circuito completo, escribile al bot por WhatsApp.`;
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeCheckStatus').textContent='Comprobación: '+err.message;}
 finally{nativeConnectionBusy=false;$('adminConnectionCompany').disabled=false;if(id===$('adminConnectionCompany').value)$('nativeConnectionFields').disabled=nativeConnectionRevision===null;}
}
async function loadMetaWebhook(){
 if(metaWebhookBusy)return;metaWebhookBusy=true;
 $('metaCallbackUrl').value='';$('metaVerifyToken').value='';$('metaWebhookStatus').textContent='Consultando motor…';
 try{
  const r=await api('/api/admin/meta/webhook',{method:'POST',body:'{}'});
  $('metaCallbackUrl').value=r.callbackUrl||'';$('metaVerifyToken').value=r.verifyToken||'';
  $('metaWebhookStatus').textContent=!r.publicUrlConfigured?'Falta la URL pública HTTPS. Configurá MOTOR_PUBLIC_URL en Railway, servicio del panel (URL del motor sin /webhook).':!r.verifyToken?'Falta META_VERIFY_TOKEN en Railway, servicio del motor.':'Datos consultados. Si WhatsApp ya funciona, no cambies su webhook.';
 }catch(err){$('metaWebhookStatus').textContent=err.message;}
 finally{metaWebhookBusy=false;}
}
async function copyMetaField(id){
 const value=$(id).value;if(!value){$('metaWebhookStatus').textContent='Consultá los datos primero y revisá si falta configuración.';return;}
 try{await navigator.clipboard.writeText(value);$('metaWebhookStatus').textContent=id==='metaCallbackUrl'?'URL copiada.':'Token de verificación copiado.';}
 catch{$('metaWebhookStatus').textContent='El navegador no permitió copiar. Seleccioná el campo y usá Ctrl+C.';$(id).focus();$(id).select();}
}
