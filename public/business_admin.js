const businessAdminDrafts=new Map();
let businessAdminSequence=0;
const businessAdminPending=new Set();
function setupBusinessAdmin(){
  if(document.getElementById('adminBranchesList'))return;
  document.getElementById('businessAdmin').innerHTML=`
  <div class="card" style="grid-column:1/-1">
    <h3>Locales y sucursales</h3>
    <p>Administrá direcciones, horarios informativos y puntos de retiro. Desactivar un local conserva sus datos.</p>
    <p id="adminBranchesSource" class="mini-note"></p>
    <div id="adminBranchesList" class="compact-grid"></div>
    <fieldset id="adminBranchFields" disabled style="border:0;padding:0;margin-top:18px;min-width:0">
      <legend id="adminBranchTitle">Nuevo local</legend>
      <div class="form-grid">
        <div class="form-field"><label for="adminBranchName">Nombre del local</label><input id="adminBranchName" maxlength="150" required></div>
        <div class="form-field"><label for="adminBranchAddress">Dirección</label><input id="adminBranchAddress" maxlength="500" required></div>
        <div class="form-field"><label for="adminBranchPhone">Teléfono</label><input id="adminBranchPhone" maxlength="80"></div>
        <div class="form-field"><label for="adminBranchHours">Horarios del local</label><input id="adminBranchHours" maxlength="500" placeholder="Lunes a viernes de 9 a 18"><small>Informativos; los horarios para aceptar pedidos se configuran por separado.</small></div>
        <div class="form-field"><label for="adminBranchMap">Enlace al mapa (HTTPS)</label><input id="adminBranchMap" type="url" maxlength="1000"></div>
        <div class="form-field"><label for="adminBranchOrder">Orden</label><input id="adminBranchOrder" type="number" min="0" max="9999" step="1" value="100"></div>
      </div>
      <div class="actions-row"><label><input id="adminBranchActive" type="checkbox" checked> Local activo</label><label><input id="adminBranchPickup" type="checkbox" checked> Permite retiro</label><label><input id="adminBranchPrimary" type="checkbox"> Principal</label></div>
      <div class="actions-row"><button class="btn btn-primary" id="adminSaveBranch">Guardar local</button><button class="btn btn-light" id="adminNewBranch">Nuevo / limpiar formulario</button><button class="btn btn-light" id="adminImportBranches">Conservar locales sincronizados</button></div>
    </fieldset>
  </div>
  <div class="card"><h3>Logo del negocio</h3><p>Se muestra en Mi negocio. Usá PNG, JPG o WEBP de hasta 2 MB.</p>
    <img id="adminLogoPreview" alt="Logo del negocio" hidden style="max-width:180px;max-height:110px;object-fit:contain">
    <p id="adminLogoName"></p>
    <fieldset id="adminLogoFields" disabled style="border:0;padding:0;min-width:0"><label for="adminLogoFile">Elegir archivo</label><input id="adminLogoFile" type="file" accept="image/png,image/jpeg,image/webp">
    <div class="actions-row"><button id="adminUploadLogo" class="btn btn-primary">Guardar logo</button><button id="adminRemoveLogo" class="btn btn-light">Quitar logo</button></div></fieldset>
  </div>
  <div class="card"><h3>Estilo de las respuestas con IA</h3><p>Personalizá el tono comercial. Los pasos automáticos del pedido y la revisión de pagos mantienen sus reglas.</p>
    <fieldset id="adminStyleFields" disabled style="border:0;padding:0;min-width:0"><div class="form-grid">
    <div class="form-field"><label for="adminStylePersonality">Personalidad</label><select id="adminStylePersonality"><option value="COMERCIAL">Comercial</option><option value="EQUILIBRADA">Equilibrada</option><option value="INFORMATIVA">Informativa</option></select></div>
    <div class="form-field"><label for="adminStyleEnergy">Energía comercial (0 a 100)</label><input id="adminStyleEnergy" type="number" min="0" max="100" step="1"></div>
    <div class="form-field"><label for="adminStyleClosing">Orientación al cierre</label><select id="adminStyleClosing"><option value="ALTA">Alta</option><option value="MEDIA">Media</option><option value="BAJA">Baja</option></select></div>
    </div><button id="adminSaveStyle" class="btn btn-primary">Guardar estilo</button></fieldset>
  </div>
  <div style="grid-column:1/-1"><button id="adminReload" class="btn btn-light">Recargar datos guardados</button><p id="businessAdminStatus" role="status" aria-live="polite"></p></div>`;
  for(const id of ['adminBranchName','adminBranchAddress','adminBranchPhone','adminBranchHours','adminBranchMap','adminBranchOrder','adminBranchActive','adminBranchPickup','adminBranchPrimary'])$(id).addEventListener('input',()=>captureBusinessAdminDraft('branch'));
  for(const id of ['adminStylePersonality','adminStyleEnergy','adminStyleClosing'])$(id).addEventListener('input',()=>captureBusinessAdminDraft('style'));
  $('adminSaveBranch').onclick=()=>{captureBusinessAdminDraft('branch');const d=businessAdminDrafts.get(companyId);if(d)saveBusinessAdmin('branch-save',{branch:d.branch});};
  $('adminNewBranch').onclick=()=>{const d=businessAdminDrafts.get(companyId);if(!d)return;if(d.branchDirty&&!confirm('¿Descartar los cambios del formulario de local?'))return;d.branch=null;d.branchDirty=false;renderBusinessAdmin(companyId);};
  $('adminSaveStyle').onclick=()=>{captureBusinessAdminDraft('style');const d=businessAdminDrafts.get(companyId);if(d)saveBusinessAdmin('style-save',{style:d.style});};
  $('adminImportBranches').onclick=()=>saveBusinessAdmin('branches-import');
  $('adminRemoveLogo').onclick=()=>{if(confirm('¿Quitar el logo de esta empresa?'))saveBusinessAdmin('logo-remove');};
  $('adminUploadLogo').onclick=uploadBusinessLogo;
  $('adminReload').onclick=()=>loadBusinessAdmin(true);
}
function emptyBusinessBranch(){return {nombre:'',direccion:'',telefono:'',horarios:'',mapsUrl:'',orden:100,activa:true,retiroHabilitado:true,principal:false};}
function captureBusinessAdminDraft(kind){
  const d=businessAdminDrafts.get(companyId);if(!d||businessAdminPending.has(companyId))return;
  if(kind==='branch'){d.branch={...d.branch,nombre:$('adminBranchName').value,direccion:$('adminBranchAddress').value,telefono:$('adminBranchPhone').value,horarios:$('adminBranchHours').value,mapsUrl:$('adminBranchMap').value,orden:Number($('adminBranchOrder').value),activa:$('adminBranchActive').checked,retiroHabilitado:$('adminBranchPickup').checked,principal:$('adminBranchPrimary').checked};d.branchDirty=true;}
  else {d.style={personalidad:$('adminStylePersonality').value,energia:Number($('adminStyleEnergy').value),cierre:$('adminStyleClosing').value};d.styleDirty=true;}
  $('businessAdminStatus').textContent='Cambios sin guardar. El borrador se conserva al cambiar de empresa.';
}
function resetBusinessAdmin(){
  setupBusinessAdmin();businessAdminSequence++;
  for(const id of ['adminBranchFields','adminLogoFields','adminStyleFields'])$(id).disabled=true;
  for(const id of ['adminBranchName','adminBranchAddress','adminBranchPhone','adminBranchHours','adminBranchMap','adminBranchOrder','adminStyleEnergy','adminStylePersonality','adminStyleClosing'])$(id).value='';
  for(const id of ['adminBranchActive','adminBranchPickup','adminBranchPrimary'])$(id).checked=false;
  $('adminBranchesSource').textContent='';$('adminBranchTitle').textContent='Nuevo local';$('adminReload').disabled=false;
  $('adminBranchesList').replaceChildren();$('adminLogoPreview').hidden=true;$('adminLogoPreview').removeAttribute('src');$('adminLogoFile').value='';$('adminLogoName').textContent='';$('businessAdminStatus').textContent='Cargando datos del negocio…';
}
function renderBusinessAdmin(id){
  if(id!==companyId)return;const d=businessAdminDrafts.get(id);if(!d)return;
  const state=d.state,busy=businessAdminPending.has(id),disabled=!state.canEdit||busy;
  for(const key of ['adminBranchFields','adminLogoFields','adminStyleFields'])$(key).disabled=disabled;
  $('adminReload').disabled=busy;
  $('adminImportBranches').hidden=state.branchesNative||!state.branches.length;
  $('adminBranchesSource').textContent=state.branchesNative?'Locales guardados en este panel. El bot utiliza los activos que permiten retiro.':'Estos son los locales disponibles en la última sincronización. Conservalos para administrarlos aquí; podrían faltar locales que no se sincronizaron.';
  const list=$('adminBranchesList');list.replaceChildren();
  for(const b of state.branches){
    const card=document.createElement('div');card.className='mini-card';
    const title=document.createElement('strong');title.textContent=b.nombre+(b.principal?' · Principal':'');card.append(title);
    for(const value of [b.direccion,b.horarios,b.telefono,(b.activa?'Activo':'Inactivo')+' · '+(b.retiroHabilitado?'Permite retiro':'Sin retiro')]){const p=document.createElement('p');p.textContent=value;card.append(p);}
    const edit=document.createElement('button');edit.className='btn btn-light';edit.textContent='Editar';edit.disabled=disabled;edit.onclick=()=>{if(d.branchDirty&&!confirm('¿Descartar el formulario actual y editar este local?'))return;d.branch={...b};d.branchDirty=false;renderBusinessAdmin(id);$('adminBranchName').focus();};card.append(edit);list.append(card);
  }
  if(!state.branches.length){const p=document.createElement('p');p.textContent=state.branchesNative?'No hay locales cargados. Agregá uno para informar puntos de retiro.':'No hay locales sincronizados. Podés agregar el primero.';list.append(p);}
  const b=d.branch||emptyBusinessBranch();$('adminBranchTitle').textContent=b.idSucursal?'Editar local':'Nuevo local';
  for(const [key,field] of Object.entries({adminBranchName:'nombre',adminBranchAddress:'direccion',adminBranchPhone:'telefono',adminBranchHours:'horarios',adminBranchMap:'mapsUrl',adminBranchOrder:'orden'}))$(key).value=b[field]??'';
  for(const [key,field] of Object.entries({adminBranchActive:'activa',adminBranchPickup:'retiroHabilitado',adminBranchPrimary:'principal'}))$(key).checked=b[field];
  const style=d.style||state.style;$('adminStylePersonality').value=style.personalidad;$('adminStyleEnergy').value=style.energia;$('adminStyleClosing').value=style.cierre;
  $('adminLogoPreview').hidden=!state.logo.available;
  if(state.logo.available)$('adminLogoPreview').src=`/api/company/${encodeURIComponent(id)}/business-admin/logo?v=${state.revision}`;else $('adminLogoPreview').removeAttribute('src');
  $('adminLogoName').textContent=state.logo.available?state.logo.name:'Sin logo cargado.';
  $('adminRemoveLogo').disabled=disabled||!state.logo.available;
}
async function loadBusinessAdmin(discard=false){
  setupBusinessAdmin();const id=companyId,old=businessAdminDrafts.get(id);
  if(discard&&(old?.branchDirty||old?.styleDirty)&&!confirm('¿Descartar los borradores y recargar los datos guardados?'))return;
  resetBusinessAdmin();const sequence=businessAdminSequence;
  if(old&&!discard&&(old.branchDirty||old.styleDirty||businessAdminPending.has(id))){renderBusinessAdmin(id);$('businessAdminStatus').textContent='Borrador conservado.';return;}
  try{
    const state=await api(`/api/company/${encodeURIComponent(id)}/business-admin`);
    if(id!==companyId||sequence!==businessAdminSequence)return;
    businessAdminDrafts.set(id,{state,branch:null,style:null,branchDirty:false,styleDirty:false});renderBusinessAdmin(id);
    $('businessAdminStatus').textContent=state.canEdit?'Datos cargados.':'Tenés acceso de consulta a estos datos.';
  }catch(e){if(id===companyId&&sequence===businessAdminSequence)$('businessAdminStatus').textContent=e.message;}
}
async function saveBusinessAdmin(action,extra={},target=companyId){
  const d=businessAdminDrafts.get(target);if(!d||!d.state.canEdit||businessAdminPending.has(target))return;
  businessAdminPending.add(target);renderBusinessAdmin(target);
  if(target===companyId)$('businessAdminStatus').textContent='Guardando…';
  try{
    const result=await api(`/api/company/${encodeURIComponent(target)}/business-admin`,{method:'POST',body:JSON.stringify({action,revision:d.state.revision,...extra})});
    d.state=result;
    if(action==='branch-save'){d.branch=null;d.branchDirty=false;}
    if(action==='style-save'){d.style=null;d.styleDirty=false;}
    if(target===companyId){$('businessAdminStatus').textContent='Cambios guardados.';if(action.startsWith('logo-'))$('adminLogoFile').value='';}
  }catch(e){if(target===companyId)$('businessAdminStatus').textContent='No se pudo confirmar el guardado: '+e.message+' El borrador se conserva.';}
  finally{businessAdminPending.delete(target);renderBusinessAdmin(target);}
}
async function uploadBusinessLogo(){
  const target=companyId,file=$('adminLogoFile').files[0];if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){$('businessAdminStatus').textContent='Elegí un PNG, JPG o WEBP de hasta 2 MB.';return;}
  try{
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('No se pudo leer la imagen.'));reader.readAsDataURL(file);});
    if(target!==companyId)return;
    await saveBusinessAdmin('logo-upload',{mime:file.type,name:file.name,base64:String(data).split(',')[1]},target);
  }catch(e){if(target===companyId)$('businessAdminStatus').textContent=e.message;}
}
