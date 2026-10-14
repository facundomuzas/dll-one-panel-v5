let gastroMigrationBusy=false;
function renderGastroMigration(status){
 const container=$('gMigrationDetails');container.replaceChildren();
 const lines=[['Productos, precios, variantes y extras',status.catalogReady],['Cobro, delivery y configuración del menú',status.settingsReady]];
 for(const [name,ready] of lines){const p=document.createElement('p');p.textContent=(ready?'✓ ':'Pendiente: ')+name;container.appendChild(p);}
 const p=document.createElement('p');p.textContent=`Fotos guardadas en el panel: ${status.imagesReady} de ${status.images.length}`;container.appendChild(p);
 for(const img of status.images){const row=document.createElement('div');row.textContent=(img.ready?'✓ ':'Pendiente: ')+img.name;container.appendChild(row);}
 $('gMigrationStatus').textContent=status.complete?'Los datos y las fotos de Gastro ya están guardados en el panel.':'Hay datos o fotos pendientes de copiar al panel.';
 $('gMigrationStart').textContent=status.complete?'Verificar y copiar pendientes':'Copiar datos y fotos pendientes';
}
async function loadGastroMigration(){
 const target=companyId;
 if(!target)return;
 try{const r=await api(`/api/company/${encodeURIComponent(target)}/gastro/migration`);if(target===companyId&&!gastroMigrationBusy)renderGastroMigration(r);}
 catch(err){if(target===companyId&&!gastroMigrationBusy)$('gMigrationStatus').textContent='No se pudo verificar la copia: '+err.message;}
}
async function runGastroMigration(){
 if(gastroMigrationBusy||!companyId)return;
 const target=companyId,base=`/api/company/${encodeURIComponent(target)}/gastro/migration`,errors=[];
 gastroMigrationBusy=true;$('gMigrationStart').disabled=true;
 const current=()=>target===companyId;
 const step=async(input,label)=>{
  if(!current())return;
  $('gMigrationStatus').textContent='Copiando: '+label+'…';
  try{await api(base,{method:'POST',body:JSON.stringify(input)});}
  catch(err){errors.push(label+': '+err.message);}
 };
 try{
  let status=await api(base);if(!current())return;
  if(!status.catalogReady)await step({step:'catalog'},'productos y precios');
  if(!current())return;
  if(!status.settingsReady)await step({step:'settings'},'cobro y entrega');
  if(!current())return;
  status=await api(base);if(!current())return;
  for(const img of status.images.filter(x=>!x.ready)){
   if(!current())return;
   await step({step:'image',imageId:img.id},img.name);
  }
  if(!current())return;
  status=await api(base);if(!current())return;
  renderGastroMigration(status);
  if(errors.length){const p=document.createElement('p');p.textContent='No se pudo copiar: '+errors.join(' · ')+'. Podés reintentar; lo ya copiado se conserva.';$('gMigrationDetails').appendChild(p);}
  else if(!status.complete)$('gMigrationStatus').textContent='Quedan datos pendientes. Volvé a intentar la copia.';
 }catch(err){if(current())$('gMigrationStatus').textContent='No se completó la copia: '+err.message+'. Podés reintentar.';}
 finally{gastroMigrationBusy=false;$('gMigrationStart').disabled=false;if(!current())await loadGastroMigration();}
}
