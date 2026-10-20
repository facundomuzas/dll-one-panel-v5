let salesToolsSequence=0,salesToolsView=0,salesToolsPreview=null,salesToolsBusy=false;
function setupSalesTools(){
 if($('salesPriceFields'))return;
 $('salesTools').innerHTML=`<h3 class="card-title">Exportación y precios masivos</h3>
 <p>Exportá todos los productos y servicios, incluidos los inactivos. El ajuste sólo afecta items activos con precio fijo, no los que están a cotizar.</p>
 <p class="mini-note">El CSV es para consulta y respaldo, no para restauración automática: el importador actual no conserva todos los estados e identificadores.</p>
 <button id="salesExport" class="btn btn-light">Descargar catálogo CSV</button>
 <fieldset id="salesPriceFields" disabled style="border:0;padding:0;margin-top:16px;min-width:0"><legend>Ajuste de precios</legend><div class="form-grid">
 <div class="form-field"><label for="salesPriceOperation">Operación</label><select id="salesPriceOperation"><option value="AUMENTAR">Aumentar</option><option value="DISMINUIR">Disminuir</option></select></div>
 <div class="form-field"><label for="salesPricePercent">Porcentaje</label><input id="salesPricePercent" type="number" min="0.01" max="1000" step="0.01" required></div>
 <div class="form-field"><label for="salesPriceRound">Redondear al más cercano</label><select id="salesPriceRound"><option value="0">Centavos</option><option value="1">$1</option><option value="10">$10</option><option value="100">$100</option><option value="1000">$1000</option></select></div>
 <div class="form-field"><label for="salesPriceScope">Alcance</label><select id="salesPriceScope"><option value="TODO">Todo el catálogo elegible</option><option value="CATEGORIA">Categoría</option><option value="MARCA">Marca</option></select></div>
 <div class="form-field"><label for="salesPriceValue">Categoría o marca exacta</label><input id="salesPriceValue" maxlength="200" placeholder="Sólo para categoría o marca"></div>
 </div><button id="salesPricePreview" class="btn btn-light">Calcular vista previa</button><button id="salesPriceApply" class="btn btn-primary" disabled>Aplicar ajuste</button></fieldset>
 <p id="salesToolsStatus" role="status" aria-live="polite"></p><div id="salesPriceRows" style="overflow:auto"></div>`;
 $('salesPriceFields').addEventListener('input',invalidateSalesPricePreview);
 $('salesPricePreview').onclick=previewSalesPriceChange;$('salesPriceApply').onclick=applySalesPriceChange;$('salesExport').onclick=downloadSalesCatalog;
}
function invalidateSalesPricePreview(){
 salesToolsSequence++;salesToolsPreview=null;
 if($('salesPriceApply')){$('salesPriceApply').disabled=true;$('salesPriceRows').replaceChildren();$('salesToolsStatus').textContent='Calculá una vista previa antes de aplicar.';}
}
function resetSalesTools(){
 setupSalesTools();salesToolsView++;invalidateSalesPricePreview();salesToolsBusy=false;
 $('salesPriceFields').disabled=true;$('salesExport').disabled=true;
 $('salesPricePercent').value='';$('salesPriceValue').value='';$('salesPriceScope').value='TODO';$('salesPriceOperation').value='AUMENTAR';$('salesPriceRound').value='0';$('salesToolsStatus').textContent='';
}
async function loadSalesTools(){
 resetSalesTools();const target=companyId,sequence=salesToolsSequence;
 try{const result=await api(`/api/company/${encodeURIComponent(target)}/catalog/tools`);
  if(target!==companyId||sequence!==salesToolsSequence)return;
  $('salesPriceFields').disabled=!result.canEdit;$('salesExport').disabled=false;
  $('salesToolsStatus').textContent=result.canEdit?'Calculá una vista previa antes de aplicar.':'Acceso de consulta: podés exportar, pero no ajustar precios.';
 }catch(e){if(target===companyId&&sequence===salesToolsSequence)$('salesToolsStatus').textContent=e.message;}
}
async function previewSalesPriceChange(){
 if(salesToolsBusy)return;
 invalidateSalesPricePreview();const target=companyId,sequence=salesToolsSequence;
 const cfg={operacion:$('salesPriceOperation').value,porcentaje:Number($('salesPricePercent').value),redondeo:Number($('salesPriceRound').value),alcance:$('salesPriceScope').value,valor:$('salesPriceValue').value};
 $('salesToolsStatus').textContent='Calculando…';
 try{const result=await api(`/api/company/${encodeURIComponent(target)}/catalog/tools/preview`,{method:'POST',body:JSON.stringify(cfg)});
  if(target!==companyId||sequence!==salesToolsSequence)return;
  salesToolsPreview={...result,companyId:target};
  const table=document.createElement('table');const header=document.createElement('tr');
  for(const title of ['Código','Nombre','Anterior','Nuevo']){const cell=document.createElement('th');cell.textContent=title;header.append(cell);}table.append(header);
  for(const row of result.preview){const tr=document.createElement('tr');for(const value of [row.codigo,row.nombre,money(row.anterior),money(row.nuevo)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}
  $('salesPriceRows').replaceChildren(table);$('salesPriceApply').disabled=!result.modificados;
  $('salesToolsStatus').textContent=`${result.cantidad} items elegibles; ${result.modificados} precios cambiarán. Mostrando hasta 20. Revisión ${result.revision}. Todavía no se guardó ningún cambio.`;
 }catch(e){if(target===companyId&&sequence===salesToolsSequence)$('salesToolsStatus').textContent=e.message;}
}
async function applySalesPriceChange(){
 const preview=salesToolsPreview;if(salesToolsBusy||!preview||preview.companyId!==companyId)return;
 if(!confirm(`¿Aplicar ${preview.cfg.operacion.toLowerCase()} ${preview.cfg.porcentaje}% a ${preview.modificados} precios de esta empresa?`))return;
 const target=companyId,sequence=salesToolsSequence,view=salesToolsView;salesToolsBusy=true;$('salesPriceFields').disabled=true;$('salesToolsStatus').textContent='Aplicando ajuste…';
 try{const result=await api(`/api/company/${encodeURIComponent(target)}/catalog/tools/apply`,{method:'POST',body:JSON.stringify({revision:preview.revision,cfg:preview.cfg,token:preview.token})});
  if(target!==companyId||sequence!==salesToolsSequence)return;
  catalogItems=result.items;salesRevision=result.revision;renderCatalog();clearCatalogForm();
  invalidateSalesPricePreview();$('salesToolsStatus').textContent=`Ajuste guardado: ${result.modificados} precios modificados. Se conservó un registro de precios anteriores.`;
 }catch(e){if(target===companyId&&sequence===salesToolsSequence){invalidateSalesPricePreview();$('salesToolsStatus').textContent='No se pudo confirmar el ajuste: '+e.message+' Recargá la lista antes de reintentar.';}}
 finally{if(target===companyId&&view===salesToolsView){salesToolsBusy=false;$('salesPriceFields').disabled=false;}}
}
async function downloadSalesCatalog(){
 const target=companyId,sequence=salesToolsView;$('salesExport').disabled=true;
 try{const result=await api(`/api/company/${encodeURIComponent(target)}/catalog/tools/export`);
  if(target!==companyId||sequence!==salesToolsView)return;
  const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download=`catalogo-${String(target).replace(/[^a-zA-Z0-9_-]/g,'_')}-r${result.revision}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('salesToolsStatus').textContent=`Exportados ${result.cantidad} items, revisión ${result.revision}. Los textos con apariencia de fórmula llevan un apóstrofo de seguridad.`;
 }catch(e){if(target===companyId&&sequence===salesToolsView)$('salesToolsStatus').textContent=e.message;}
 finally{if(target===companyId&&sequence===salesToolsView)$('salesExport').disabled=false;}
}
