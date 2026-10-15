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
 const id=$('adminConnectionCompany').value;
 nativeConnectionTarget=id;nativeConnectionRevision=null;$('nativeConnectionFields').disabled=true;$('nativeToken').value='';
 if(!id){$('nativeConnectionStatus').textContent='Seleccioná una empresa.';return;}
 $('nativeConnectionStatus').textContent='Cargando configuración…';
 try{
  const r=await api(`/api/admin/companies/${encodeURIComponent(id)}/connection`);if(id!==$('adminConnectionCompany').value)return;
  if(!r.native){$('nativeConnectionStatus').textContent='Esta empresa conserva su conexión anterior. No necesita cambios en esta sección.';return;}
  nativeConnectionRevision=r.revision;$('nativePhone').value=r.phoneNumberId||'';$('nativeGraphVersion').value=r.graphVersion;$('nativeConnected').checked=r.connected;
  $('nativeToken').placeholder=r.hasToken?'Token guardado; dejá vacío para conservarlo':'Token de acceso de Meta';
  $('nativeConnectionFields').disabled=false;$('nativeConnectionStatus').textContent=r.connected?'Configuración habilitada para el motor. Comprobá que WhatsApp responda.':'Conexión pendiente o deshabilitada. Podés preparar el negocio desde el panel.';
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeConnectionStatus').textContent='No se pudo cargar: '+err.message;}
}
async function saveNativeConnectionForm(){
 if(nativeConnectionBusy||nativeConnectionRevision===null)return;
 const id=$('adminConnectionCompany').value;if(id!==nativeConnectionTarget)return;
 const body={revision:nativeConnectionRevision,phoneNumberId:$('nativePhone').value.trim(),accessToken:$('nativeToken').value.trim(),graphVersion:$('nativeGraphVersion').value.trim(),connected:$('nativeConnected').checked};
 nativeConnectionBusy=true;$('nativeConnectionFields').disabled=true;$('nativeConnectionStatus').textContent='Guardando configuración…';
 try{
  const r=await api(`/api/admin/companies/${encodeURIComponent(id)}/connection`,{method:'POST',body:JSON.stringify(body)});
  if(id!==$('adminConnectionCompany').value)return;
  nativeConnectionRevision=r.revision;$('nativeToken').value='';$('nativeToken').placeholder=r.hasToken?'Token guardado; dejá vacío para conservarlo':'Token de acceso de Meta';
  $('nativeConnectionStatus').textContent=r.connected?'Configuración guardada. El motor la leerá en aproximadamente 30 segundos. Comprobá WhatsApp; el guardado no valida el token con Meta.':'Configuración guardada y conexión deshabilitada. El motor se actualizará en aproximadamente 30 segundos.';
 }catch(err){if(id===$('adminConnectionCompany').value)$('nativeConnectionStatus').textContent='No se guardó: '+err.message;}
 finally{nativeConnectionBusy=false;if(id===$('adminConnectionCompany').value)$('nativeConnectionFields').disabled=nativeConnectionRevision===null;}
}
