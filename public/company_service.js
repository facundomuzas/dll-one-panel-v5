let serviceBusy=false;
const serviceNames={ACTIVE:'Activo',PAUSED:'Bot pausado',SUSPENDED:'Servicio suspendido',ARCHIVED:'Baja archivada'};
async function loadCompanyServices(){
 const box=$('companyServiceList');box.textContent='Cargando empresas…';
 try{
  const r=await api('/api/admin/company-services');box.replaceChildren();
  for(const c of r.items||[]){
   const section=document.createElement('section');section.style.marginBottom='20px';
   const title=document.createElement('p');title.textContent=c.company_name+' — '+(serviceNames[c.service_state]||c.service_state);section.appendChild(title);
   for(const [state,label] of Object.entries({ACTIVE:'Reactivar',PAUSED:'Pausar bot',SUSPENDED:'Suspender servicio',ARCHIVED:'Dar de baja'})){
    if(state===c.service_state)continue;
    const b=document.createElement('button');b.className='btn btn-light';b.textContent=label;b.onclick=()=>changeCompanyService(c,state);section.appendChild(b);
   }
   const voice=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='Adicional ElevenLabs';voice.appendChild(legend);
   const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=c.voice?.enabled===true;label.append(enabled,document.createTextNode(' Habilitar audios para esta empresa'));voice.appendChild(label);
   const voiceId=document.createElement('input');voiceId.placeholder='ID de voz de ElevenLabs';voiceId.setAttribute('aria-label','ID de voz de ElevenLabs');voiceId.value=c.voice?.voiceId||'';voice.appendChild(voiceId);
   const save=document.createElement('button');save.className='btn btn-primary';save.textContent='Guardar adicional';save.onclick=async()=>{save.disabled=true;try{const r=await api('/api/admin/companies/'+encodeURIComponent(c.company_id)+'/voice',{method:'POST',body:JSON.stringify({enabled:enabled.checked,voiceId:voiceId.value,revision:c.voice?.revision||0})});c.voice=r.voice;$('companyServiceStatus').textContent='Adicional guardado. Requiere ELEVENLABS_API_KEY en el motor y una voz válida.';}catch(e){$('companyServiceStatus').textContent=e.message;}finally{save.disabled=false;}};voice.appendChild(save);section.appendChild(voice);
   box.appendChild(section);
  }
  if(!r.items?.length)box.textContent='No hay empresas.';
 }catch(e){box.textContent='No pude cargar las empresas: '+e.message;}
}
async function changeCompanyService(c,state){
 if(serviceBusy)return;
 if(state==='ARCHIVED'&&!confirm('Dar de baja a “'+c.company_name+'”: se detiene el bot y se oculta la empresa del uso diario. Los datos se conservan y podés reactivarla. ¿Continuar?'))return;
 serviceBusy=true;
 const box=$('companyServiceList');box.querySelectorAll('button').forEach(b=>b.disabled=true);
 $('companyServiceStatus').textContent='Guardando el estado de '+c.company_name+'…';
 try{
  const r=await api('/api/admin/companies/'+encodeURIComponent(c.company_id)+'/service',{method:'POST',body:JSON.stringify({state,revision:c.service_revision,...(state==='ARCHIVED'?{confirmName:c.company_name}:{})})});
  $('companyServiceStatus').textContent=c.company_name+': '+serviceNames[r.company.service_state]+'. '+(r.motorApplied?'Estado recibido por el motor.':'Guardado en el panel; falta confirmar la actualización del motor. Volvé a Revisar migración.');
  await refreshCompanies();
 }catch(e){$('companyServiceStatus').textContent='No se pudo completar el cambio: '+e.message;}
 finally{serviceBusy=false;await loadCompanyServices();}
}
