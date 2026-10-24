let healthDoctors=[],healthCompany='',healthChatId='',healthChatBusy=false,healthBookBusy=false,healthEditRevision=0,healthBookAttempt=null,healthSlotsSequence=0,healthChatAttempt=null;
const healthNextStates={BOOKED:['ARRIVED','ABSENT','CANCELLED'],ARRIVED:['IN_CONSULTATION','CANCELLED'],IN_CONSULTATION:['ATTENDED'],ATTENDED:[],ABSENT:[],CANCELLED:[]};
const healthStates={BOOKED:'Reservado',ARRIVED:'En sala',IN_CONSULTATION:'En consulta',ATTENDED:'Atendido',ABSENT:'No asistió',CANCELLED:'Cancelado'};
function healthUrl(id,path){return '/api/company/'+encodeURIComponent(id)+'/health/'+path;}
function resetHealthDemo(){healthChatAttempt=null;healthCompany='';healthDoctors=[];healthBookAttempt=null;healthSlotsSequence++;healthChatId=crypto.randomUUID();if($('healthChatLog'))$('healthChatLog').replaceChildren();}
async function createHealthDemo(){
 const b=$('healthDemoCreate');b.disabled=true;$('healthDemoCreateStatus').textContent='Preparando empresa y especialistas de demostración…';
 try{const r=await api('/api/admin/health-demo',{method:'POST',body:'{}'});await refreshCompanies();if(!companies.some(c=>c.idEmpresa===r.idEmpresa))throw Error('La demo está archivada. Reactivala desde Control de empresas.');$('companySelect').value=r.idEmpresa;await changeCompany();$('healthDemoCreateStatus').textContent='Demo preparada.';}
 catch(e){$('healthDemoCreateStatus').textContent=e.message;}finally{b.disabled=false;}
}
async function loadHealth(){
 $('healthStatus').textContent='Cargando agenda y especialistas…';
 try{await loadHealthData();$('healthStatus').textContent='Agenda lista. Podés probar el bot, reservar o editar especialistas.';}
 catch(e){$('healthStatus').textContent='No se pudo cargar ONE Salud: '+e.message+' Usá Actualizar agenda y especialistas para reintentar.';$('healthBookButton').disabled=true;}
}
async function loadHealthData(){
 const id=companyId;const r=await api(healthUrl(id,'doctors'));if(companyId!==id)return;
 const changed=healthCompany!==id;if(changed)resetHealthDemo();healthCompany=id;healthDoctors=r.items||[];
 if(changed||!$('healthDate').value)$('healthDate').value=r.today;
 const opts=healthDoctors.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} · ${esc(d.specialty)}</option>`).join('');
 for(const [field,prefix] of [['healthFilter','<option value="">Todos los especialistas</option>'],['healthBookDoctor',''],['healthDoctorEdit','<option value="">Nuevo especialista</option>']]){
  const previous=$(field).value;$(field).innerHTML=prefix+opts;if(healthDoctors.some(d=>d.id===previous)||previous==='')$(field).value=previous;
 }
 if(!$('healthBookDoctor').value&&healthDoctors.length)$('healthBookDoctor').value=healthDoctors[0].id;
 $('healthDoctorFields').disabled=currentUser?.role!=='SUPERADMIN';
 editHealthDoctor();await Promise.all([loadHealthAgenda(),healthSlots()]);
}
function editHealthDoctor(){
 const d=healthDoctors.find(d=>d.id===$('healthDoctorEdit').value)||{name:'',specialty:'',room:'',mode:'FIXED',start:'08:00',end:'12:00',minutes:20,capacity:8,days:[1,2,3,4,5],blockedDates:[],active:true,revision:0};healthEditRevision=d.revision;
 for(const [field,key] of [['healthDoctorName','name'],['healthSpecialty','specialty'],['healthRoom','room'],['healthAddress','address'],['healthService','service'],['healthMode','mode'],['healthStart','start'],['healthEnd','end'],['healthMinutes','minutes'],['healthCapacity','capacity']])$(field).value=d[key]??'';
 $('healthBlocked').value=d.blockedDates.join(', ');$('healthDoctorActive').checked=d.active;
 $('healthDays').innerHTML=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((n,i)=>`<label class="module-check"><input type="checkbox" value="${i}" ${d.days.includes(i)?'checked':''}>${n}</label>`).join('');
}
async function saveHealthDoctor(){
 const id=companyId,b=$('healthDoctorSave');if(b.disabled)return;b.disabled=true;
 const body={id:$('healthDoctorEdit').value,revision:healthEditRevision,name:$('healthDoctorName').value,specialty:$('healthSpecialty').value,room:$('healthRoom').value,address:$('healthAddress').value,service:$('healthService').value,mode:$('healthMode').value,start:$('healthStart').value,end:$('healthEnd').value,minutes:Number($('healthMinutes').value),capacity:Number($('healthCapacity').value),days:[...$('healthDays').querySelectorAll('input:checked')].map(x=>Number(x.value)),blockedDates:$('healthBlocked').value.split(',').map(x=>x.trim()).filter(Boolean),active:$('healthDoctorActive').checked};
 try{await api(healthUrl(id,'doctors'),{method:'POST',body:JSON.stringify(body)});if(companyId!==id)return;$('healthStatus').textContent='Especialista guardado.';await loadHealth();}catch(e){if(companyId===id)$('healthStatus').textContent=e.message;}finally{b.disabled=false;}
}
async function loadHealthAgenda(){try{await loadHealthAgendaData();}catch(e){$('healthStatus').textContent=e.message;}}
async function loadHealthAgendaData(){
 const id=companyId,date=$('healthDate').value,doctor=$('healthFilter').value;if(!date)return;
 const r=await api(healthUrl(id,'agenda')+'?date='+encodeURIComponent(date)+'&doctorId='+encodeURIComponent(doctor)+'&specialty='+encodeURIComponent($('healthSpecialtyFilter').value)+'&service='+encodeURIComponent($('healthServiceFilter').value));if(companyId!==id||date!==$('healthDate').value||doctor!==$('healthFilter').value)return;
 const box=$('healthAgenda');box.replaceChildren();
 for(const a of r.items||[]){const row=document.createElement('div');row.className='data-row';const text=document.createElement('div');text.className='data-row-main';text.textContent=a.patient+' · DNI: '+(a.dni||'Sin registrar')+' · '+a.doctor_name+' · '+(a.mode==='FIXED'?a.slot:'Llegada, cupo '+a.slot+' ('+a.start_time+'–'+a.end_time+')')+' · '+healthStates[a.state]+' · '+a.id;row.appendChild(text);
  if(a.state==='BOOKED'){const cancel=document.createElement('button');cancel.className='btn btn-light';cancel.textContent='Cancelar turno';cancel.onclick=async()=>{if(!confirm('¿Cancelar el turno de '+a.patient+'?'))return;cancel.disabled=true;try{await api(healthUrl(id,'state'),{method:'POST',body:JSON.stringify({id:a.id,state:'CANCELLED'})});if(companyId===id){await loadHealthAgenda();await healthSlots();}}catch(e){if(companyId===id)$('healthStatus').textContent=e.message;}finally{cancel.disabled=false;}};row.appendChild(cancel);}box.appendChild(row);
 }
 if(!r.items?.length)box.textContent='No hay turnos para esta fecha y especialista.';
}
async function healthSlots(){
 const id=companyId,doctor=$('healthBookDoctor').value,date=$('healthDate').value,sequence=++healthSlotsSequence;
 $('healthBookSlot').replaceChildren();$('healthBookButton').disabled=true;$('healthSlotInfo').textContent='';if(!doctor||!date)return;
 try{const r=await api(healthUrl(id,'availability')+'?date='+encodeURIComponent(date)+'&doctorId='+encodeURIComponent(doctor));if(id!==companyId||sequence!==healthSlotsSequence)return;
 const slots=r.doctor.mode==='QUEUE'?(r.slots.length?['QUEUE']:[]):r.slots;
 for(const value of slots){const opt=document.createElement('option');opt.value=value;opt.textContent=value==='QUEUE'?'Reservar un cupo por llegada':value;$('healthBookSlot').appendChild(opt);}
 $('healthSlotInfo').textContent=r.doctor.mode==='QUEUE'?r.slots.length+' cupos disponibles. Atención '+r.doctor.start+'–'+r.doctor.end+'. No se asigna hora ni prioridad.':r.slots.length+' horarios disponibles.';
 $('healthBookButton').disabled=!slots.length;if(!slots.length)$('healthSlotInfo').textContent+=' Elegí otra fecha en Agenda diaria o revisá los días y horarios del especialista.';
 }catch(e){if(id===companyId&&sequence===healthSlotsSequence)$('healthSlotInfo').textContent=e.message;}
}
async function bookHealth(){
 if(healthBookBusy)return;const id=companyId,body={doctorId:$('healthBookDoctor').value,date:$('healthDate').value,slot:$('healthBookSlot').value,patient:$('healthPatient').value,dni:$('healthDni').value,contact:'MANUAL-'+$('healthContact').value.trim()};
 if(!/^[0-9]{7,8}$/.test(body.dni.replace(/[.\s]/g,''))){$('healthStatus').textContent='Ingresá un DNI ficticio de 7 u 8 dígitos.';return;}
 if(!$('healthContact').value.trim()){$('healthStatus').textContent='Ingresá un código de paciente demo.';return;}
 const serialized=JSON.stringify(body);if(healthBookAttempt?.serialized!==serialized)healthBookAttempt={serialized,requestId:crypto.randomUUID()};healthBookBusy=true;$('healthBookButton').disabled=true;
 try{const r=await api(healthUrl(id,'book'),{method:'POST',body:JSON.stringify({...body,requestId:healthBookAttempt.requestId})});if(companyId!==id)return;healthBookAttempt=null;$('healthStatus').textContent='Turno demo registrado: '+r.appointment.id;await loadHealthAgenda();}
 catch(e){if(companyId===id)$('healthStatus').textContent=e.message;}finally{healthBookBusy=false;if(companyId===id)await healthSlots();}
}
function newHealthChat(){if(healthChatBusy)return;healthChatAttempt=null;healthChatId=crypto.randomUUID();$('healthChatLog').replaceChildren();$('healthChatInput').value='TURNOS';}
async function sendHealthChat(){
 if(healthChatBusy)return;const text=$('healthChatInput').value.trim()||'TURNOS';const id=companyId,sessionId=healthChatId||(healthChatId=crypto.randomUUID());healthChatBusy=true;$('healthChatSend').disabled=true;$('healthChatSend').textContent='Enviando…';
 const key=JSON.stringify({id,sessionId,text});if(healthChatAttempt?.key!==key)healthChatAttempt={key,messageId:crypto.randomUUID()};
 const line=(who,value)=>{const p=document.createElement('p');p.textContent=who+': '+value;$('healthChatLog').appendChild(p);$('healthChatLog').scrollTop=$('healthChatLog').scrollHeight;};
 try{const r=await api(healthUrl(id,'chat'),{method:'POST',body:JSON.stringify({sessionId,text,messageId:healthChatAttempt.messageId})});if(companyId!==id||healthChatId!==sessionId)return;healthChatAttempt=null;line('Paciente demo',text);line('ONE Salud',r.response);if(r.qrBase64){const img=document.createElement('img');img.src='data:image/png;base64,'+r.qrBase64;img.alt='QR del turno';img.width=180;$('healthChatLog').appendChild(img);}$('healthChatInput').value='';await loadHealthAgenda();await healthSlots();}
 catch(e){if(companyId===id)line('Aviso',e.message+' Podés escribir TURNOS para comenzar de nuevo.');}finally{healthChatBusy=false;$('healthChatSend').disabled=false;$('healthChatSend').textContent='Enviar prueba';}
}
function printHealthAgenda(){const q='?date='+encodeURIComponent($('healthDate').value)+'&doctorId='+encodeURIComponent($('healthFilter').value)+'&specialty='+encodeURIComponent($('healthSpecialtyFilter').value)+'&service='+encodeURIComponent($('healthServiceFilter').value);window.open(healthUrl(companyId,'print')+q,'_blank','noopener');}
