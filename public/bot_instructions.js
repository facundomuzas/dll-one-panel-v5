const botInstructionsDrafts=new Map(),botInstructionsSaving=new Set();
let botInstructionsSequence=0,botInstructionsTarget='';
function resetBotInstructions(){
 botInstructionsSequence++;botInstructionsTarget=companyId;
 $('botInstructionsFields').disabled=true;$('botInstructionsText').value='';$('botInstructionsStatus').textContent='';
}
function renderBotInstructionsDraft(id,draft){
 if(id!==companyId)return;
 botInstructionsTarget=id;$('botInstructionsText').value=draft.instructions||'';
 $('botInstructionsFields').disabled=!draft.native||botInstructionsSaving.has(id);
 $('reloadBotInstructionsButton').disabled=botInstructionsSaving.has(id);
}
function markBotInstructionsDirty(){
 if(botInstructionsTarget!==companyId)return;
 const draft=botInstructionsDrafts.get(companyId);if(!draft)return;
 draft.instructions=$('botInstructionsText').value;draft.dirty=true;
 $('botInstructionsStatus').textContent='Cambios sin guardar. Se conserva el borrador si cambiás de sección o empresa.';
}
async function loadBotInstructions(discard=false){
 const id=companyId,sequence=++botInstructionsSequence,cached=botInstructionsDrafts.get(id);
 if(cached&&(botInstructionsSaving.has(id)||cached.dirty&&!discard)){
  renderBotInstructionsDraft(id,cached);$('botInstructionsStatus').textContent=botInstructionsSaving.has(id)?'Guardando instrucciones…':'Tenés un borrador sin guardar. Para descartarlo, usá Recargar instrucciones guardadas.';return;
 }
 botInstructionsTarget=id;$('botInstructionsFields').disabled=true;$('botInstructionsStatus').textContent='Cargando instrucciones…';
 try{
  const result=await api(`/api/company/${encodeURIComponent(id)}/bot-instructions`);
  if(id!==companyId||sequence!==botInstructionsSequence)return;
  const draft={native:result.native===true,revision:result.revision,instructions:result.instructions||'',dirty:false};
  botInstructionsDrafts.set(id,draft);renderBotInstructionsDraft(id,draft);
  $('botInstructionsStatus').textContent=draft.native?'Estas son las instrucciones guardadas de esta empresa. Dejar el texto vacío elimina las indicaciones personalizadas.':'Primero, el Super Admin debe traer la conexión actual al panel desde Conexión con Meta / WhatsApp.';
 }catch(err){if(id===companyId&&sequence===botInstructionsSequence){if(cached)renderBotInstructionsDraft(id,cached);$('botInstructionsStatus').textContent='No se pudieron cargar: '+err.message;}}
}
async function saveBotInstructionsForm(){
 const id=companyId,draft=botInstructionsDrafts.get(id);
 if(botInstructionsTarget!==id||!draft?.native||botInstructionsSaving.has(id))return;
 const text=$('botInstructionsText').value;
 if(text.length>12000){$('botInstructionsStatus').textContent='Usá hasta 12.000 caracteres.';return;}
 draft.instructions=text;draft.dirty=true;botInstructionsSaving.add(id);renderBotInstructionsDraft(id,draft);
 $('botInstructionsStatus').textContent='Guardando instrucciones…';
 try{
  const result=await api(`/api/company/${encodeURIComponent(id)}/bot-instructions`,{method:'POST',body:JSON.stringify({revision:draft.revision,instructions:text})});
  botInstructionsDrafts.set(id,{native:true,revision:result.revision,instructions:result.instructions,dirty:false});
  if(id===companyId)$('botInstructionsStatus').textContent='Instrucciones guardadas. El motor 4.3.12 las usa en los próximos mensajes que procese con IA.';
 }catch(err){if(id===companyId)$('botInstructionsStatus').textContent='No se guardó: '+err.message+' El borrador se conserva; copialo antes de recargar si querés mantenerlo.';}
 finally{botInstructionsSaving.delete(id);if(id===companyId)renderBotInstructionsDraft(id,botInstructionsDrafts.get(id));}
}
