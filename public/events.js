let eventDetailReady=false;
let eventList=[],eventRows=[],eventSelected='',eventsCompany='',eventsEpoch=0,eventLoadSeq=0,eventDetailSeq=0,eventRevision=null,eventDraftId='',eventAttempt=null,eventBusy=false,eventPermissions={manage:false,operate:false};
const eventLabels={OPEN:'Inscripción abierta',CLOSED:'Inscripción cerrada',CANCELLED:'Evento cancelado'};
const eventPaymentLabels={FREE:'Sin cargo',PENDING:'Pendiente',APPROVED:'Confirmado',REVOKED:'Revertido'};
const attendeeLabels={REGISTERED:'Inscripto',CHECKED_IN:'Ingresó',CANCELLED:'Cancelado'};
function eventsUrl(company=companyId,path=''){return '/api/company/'+encodeURIComponent(company)+'/events'+path;}
function eventMessage(message){$('eventsStatus').textContent=message;}
function resetEvents(){
 eventDetailReady=false;eventsEpoch++;eventLoadSeq++;eventDetailSeq++;eventList=[];eventRows=[];eventSelected='';eventsCompany='';eventAttempt=null;eventBusy=false;eventPermissions={manage:false,operate:false};
 $('eventSelect').replaceChildren();$('eventAttendees').replaceChildren();$('eventSummary').textContent='';$('eventEditor').disabled=true;$('eventRegistration').disabled=true;$('eventPrint').disabled=true;$('eventSave').disabled=true;$('eventRegister').disabled=true;$('eventNew').disabled=true;
 for(const id of ['eventPersonName','eventDni','eventContact','eventSearch','eventPaymentNote','eventScanInput'])$(id).value='';eventMessage('');$('eventTicketStatus').textContent='';
}
function eventWallClock(value){const d=new Date(new Date(value).getTime()-3*3600000);return d.toISOString().slice(0,16);}
function editSelectedEvent(){
 const e=eventList.find(x=>x.id===eventSelected);eventRevision=e?.revision??null;eventDraftId=e?.id||crypto.randomUUID();
 $('eventName').value=e?.name||'';$('eventStart').value=e?eventWallClock(e.starts_at):'';$('eventLocation').value=e?.location||'';$('eventCapacity').value=e?.capacity||100;$('eventPrice').value=Number(e?.price_cents||0)/100;$('eventState').value=e?.status||'OPEN';$('eventNotes').value=e?.notes||'';
 $('eventEditorTitle').textContent=e?'Editar evento':'Nuevo evento';$('eventEditor').disabled=!eventPermissions.manage;$('eventSave').disabled=!eventPermissions.manage;
}
function newEvent(){if(!eventPermissions.manage||eventBusy)return;eventDetailReady=false;eventSelected='';$('eventSelect').value='';eventRows=[];eventAttempt=null;eventDetailSeq++;editSelectedEvent();renderEventAttendees();eventMessage('Completá el evento y guardalo para empezar a inscribir asistentes.');}
async function loadEvents(){
 const id=companyId,epoch=eventsEpoch,seq=++eventLoadSeq;eventMessage('Cargando eventos…');
 try{const r=await api(eventsUrl(id));if(companyId!==id||epoch!==eventsEpoch||seq!==eventLoadSeq)return;
  eventsCompany=id;eventList=r.items||[];eventPermissions=r.permissions||{manage:false,operate:false};
  $('eventNew').disabled=!eventPermissions.manage;
  const select=$('eventSelect');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Elegí un evento';select.appendChild(empty);
  for(const e of eventList){const option=document.createElement('option');option.value=e.id;option.textContent=e.name+' · '+new Date(e.starts_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})+' · '+eventLabels[e.status];select.appendChild(option);}
  if(!eventList.some(e=>e.id===eventSelected))eventSelected=eventList[0]?.id||'';select.value=eventSelected;editSelectedEvent();
  if(eventSelected)await loadEventAttendees();else{eventRows=[];renderEventAttendees();eventMessage('Todavía no hay eventos. Creá el primero con el formulario.');}
 }catch(e){if(companyId===id&&epoch===eventsEpoch&&seq===eventLoadSeq){eventPermissions={manage:false,operate:false};$('eventEditor').disabled=true;$('eventRegistration').disabled=true;eventMessage('No se pudo cargar: '+e.message);}}
}
async function selectEvent(){if(eventBusy)return;eventDetailReady=false;eventSelected=$('eventSelect').value;eventAttempt=null;$('eventSearch').value='';editSelectedEvent();eventRows=[];renderEventAttendees();if(eventSelected)await loadEventAttendees();}
async function loadEventAttendees(){
 const id=companyId,eventId=eventSelected,epoch=eventsEpoch,seq=++eventDetailSeq;if(!eventId)return;
 eventDetailReady=false;$('eventRegistration').disabled=true;
 try{const r=await api(eventsUrl(id,'/'+encodeURIComponent(eventId)+'/attendees'));if(id!==companyId||eventId!==eventSelected||epoch!==eventsEpoch||seq!==eventDetailSeq)return;
  const index=eventList.findIndex(e=>e.id===eventId);if(index>=0)eventList[index]={...eventList[index],...r.event};eventRows=r.items||[];eventDetailReady=true;renderEventAttendees();eventMessage('Lista actualizada.');
 }catch(e){if(id===companyId&&eventId===eventSelected&&epoch===eventsEpoch){eventRows=[];$('eventAttendees').replaceChildren();$('eventSummary').textContent='No se pudo actualizar la lista.';$('eventRegistration').disabled=true;$('eventPrint').disabled=true;eventMessage(e.message);}}
}
function renderEventAttendees(){
 const e=eventList.find(x=>x.id===eventSelected),live=eventRows.filter(x=>x.state!=='CANCELLED').length,entered=eventRows.filter(x=>x.state==='CHECKED_IN').length;
 $('eventSummary').textContent=e&&!eventDetailReady?'Actualizá el listado para consultar cupos y asistentes.':e?`${eventLabels[e.status]} · Cupo: ${e.capacity} · Inscriptos: ${live} · Disponibles: ${Math.max(0,e.capacity-live)} · Ingresaron: ${entered}`:'Seleccioná o creá un evento.';
 $('eventRegistration').disabled=eventBusy||!eventDetailReady||!e||!eventPermissions.operate||e.status!=='OPEN'||live>=e.capacity;$('eventRegister').disabled=eventBusy||!eventPermissions.operate;$('eventPrint').disabled=!e||!eventDetailReady;
 const q=$('eventSearch').value.trim().toLowerCase(),items=eventRows.filter(a=>[a.name,a.dni,a.contact,a.code].some(v=>String(v).toLowerCase().includes(q))),box=$('eventAttendees');box.replaceChildren();
 for(const a of items){const row=document.createElement('div');row.className='data-row';const main=document.createElement('div');main.className='data-row-main';const name=document.createElement('strong');name.textContent=a.name+' · DNI '+a.dni;const detail=document.createElement('p');detail.textContent=attendeeLabels[a.state]+' · Pago: '+(eventPaymentLabels[a.payment_state||'FREE']||'Revisar')+(a.contact?' · '+a.contact:'')+' · '+a.code;detail.style.overflowWrap='anywhere';main.append(name,detail);row.appendChild(main);
  if(a.state==='REGISTERED'&&eventPermissions.operate){const actions=document.createElement('div');actions.className='actions-row';for(const [state,label] of [['CHECKED_IN','Registrar ingreso'],['CANCELLED','Cancelar inscripción']]){const b=document.createElement('button');b.className='btn btn-light';b.textContent=label;b.disabled=eventBusy||!eventDetailReady||(state==='CHECKED_IN'&&(e?.status==='CANCELLED'||!['FREE','APPROVED'].includes(a.payment_state||'FREE')));b.onclick=()=>eventStateAction(a,state);actions.appendChild(b);}row.appendChild(actions);}
  if(a.state!=='CANCELLED'){const actions=document.createElement('div');actions.className='actions-row';
   if(['FREE','APPROVED'].includes(a.payment_state||'FREE')){const link=document.createElement('a');link.className='btn btn-light';link.textContent='Ver entrada QR';link.target='_blank';link.rel='noopener';link.href='/tickets/'+encodeURIComponent(companyId)+'/'+encodeURIComponent(a.code);actions.appendChild(link);}
   else if(eventPermissions.operate&&a.payment_state==='PENDING'){const b=document.createElement('button');b.className='btn btn-light';b.textContent=a.payment_mode==='MP'?'Obtener enlace de pago':'Confirmar pago manual';b.disabled=eventBusy;b.onclick=()=>eventPaymentAction(a);actions.appendChild(b);}
   row.appendChild(actions);
  }box.appendChild(row);
 }
 if(!items.length)box.textContent=q?'No hay coincidencias.':'Todavía no hay asistentes inscriptos.';
}
function eventSetBusy(busy){eventBusy=busy;$('eventSelect').disabled=busy;$('eventNew').disabled=busy||!eventPermissions.manage;$('eventSave').disabled=busy||!eventPermissions.manage;$('eventEditor').disabled=busy||!eventPermissions.manage;renderEventAttendees();}
async function saveEventForm(){
 if(eventBusy||!eventPermissions.manage)return;const id=companyId,epoch=eventsEpoch;
 const body={id:eventDraftId,revision:eventRevision,name:$('eventName').value,start:$('eventStart').value,location:$('eventLocation').value,capacity:Number($('eventCapacity').value),price:$('eventPrice').value,status:$('eventState').value,notes:$('eventNotes').value};
 eventSetBusy(true);eventMessage('Guardando evento…');
 try{const r=await api(eventsUrl(id),{method:'POST',body:JSON.stringify(body)});if(id!==companyId||epoch!==eventsEpoch)return;eventSelected=r.event.id;await loadEvents();if(id===companyId&&epoch===eventsEpoch)eventMessage('Evento guardado. Los cambios no envían avisos automáticos a los asistentes.');}
 catch(e){if(id===companyId&&epoch===eventsEpoch)eventMessage(e.message+' Si hubo un corte, podés reintentar o actualizar la lista.');}
 finally{if(id===companyId&&epoch===eventsEpoch)eventSetBusy(false);}
}
async function registerEventPerson(){
 if(eventBusy||!eventPermissions.operate||!eventSelected||$('eventRegistration').disabled)return;const id=companyId,eventId=eventSelected,epoch=eventsEpoch;
 const body={name:$('eventPersonName').value.trim(),dni:$('eventDni').value.trim(),contact:$('eventContact').value.trim()};
 if(body.name.length<2||!/^\d{7,8}$/.test(body.dni.replace(/[.\s]/g,''))){eventMessage('Ingresá nombre y DNI de 7 u 8 dígitos.');return;}
 const key=JSON.stringify({id,eventId,...body});if(eventAttempt?.key!==key)eventAttempt={key,requestId:crypto.randomUUID()};eventSetBusy(true);eventMessage('Registrando asistente…');
 try{const r=await api(eventsUrl(id,'/'+encodeURIComponent(eventId)+'/attendees'),{method:'POST',body:JSON.stringify({...body,requestId:eventAttempt.requestId})});if(id!==companyId||epoch!==eventsEpoch)return;eventAttempt=null;for(const field of ['eventPersonName','eventDni','eventContact'])$(field).value='';await loadEventAttendees();if(id===companyId&&epoch===eventsEpoch)eventMessage('Inscripción guardada. Código: '+r.attendee.code);}
 catch(e){if(id===companyId&&epoch===eventsEpoch)eventMessage(e.message+' Si hubo un corte, reintentá con los mismos datos.');}
 finally{if(id===companyId&&epoch===eventsEpoch)eventSetBusy(false);}
}
async function eventStateAction(a,state){
 if(eventBusy||!eventPermissions.operate)return;const id=companyId,eventId=eventSelected,epoch=eventsEpoch;eventSetBusy(true);
 try{await api(eventsUrl(id,'/'+encodeURIComponent(eventId)+'/state'),{method:'POST',body:JSON.stringify({id:a.id,revision:a.revision,state})});if(id!==companyId||epoch!==eventsEpoch)return;await loadEventAttendees();if(id===companyId&&epoch===eventsEpoch)eventMessage(state==='CHECKED_IN'?'Ingreso registrado.':'Inscripción cancelada. Se liberó el cupo.');}
 catch(e){if(id===companyId&&epoch===eventsEpoch)eventMessage(e.message);}
 finally{if(id===companyId&&epoch===eventsEpoch)eventSetBusy(false);}
}
function printEventList(){if(eventSelected)window.open(eventsUrl(companyId,'/'+encodeURIComponent(eventSelected)+'/print'),'_blank','noopener');}

async function eventPaymentAction(a){
 if(eventBusy||!eventPermissions.operate)return;
 const id=companyId,eventId=eventSelected,epoch=eventsEpoch;
 if(a.payment_mode!=='MP'){
  const note=$('eventPaymentNote').value.trim();if(!note){eventMessage('Completá la referencia del pago comprobado antes de confirmar.');return;}
 }
 eventSetBusy(true);
 try{const result=await api(eventsUrl(id,'/'+encodeURIComponent(eventId)+(a.payment_mode==='MP'?'/checkout':'/manual-payment')),{method:'POST',body:JSON.stringify({id:a.id,revision:a.revision,note:$('eventPaymentNote').value.trim()})});if(id!==companyId||epoch!==eventsEpoch)return;
  if(result.url){const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener';link.textContent=result.url;$('eventsStatus').replaceChildren('Enlace para pagar: ',link);}
  else{await loadEventAttendees();eventMessage(result.warning||(result.mode==='MANUAL'?'Mercado Pago está desactivado. Las inscripciones anteriores conservan su modalidad.':'Pago confirmado. QR habilitado.'));}
 }catch(e){if(id===companyId&&epoch===eventsEpoch)eventMessage(e.message);}finally{if(id===companyId&&epoch===eventsEpoch)eventSetBusy(false);}
}
async function lookupEventTicket(value=$('eventScanInput').value){
 try{$('eventSearch').value=value.trim();renderEventAttendees();$('eventTicketStatus').textContent='Buscando entrada…';let code=value.trim();if(code.includes('://')){const u=new URL(code);const params=new URLSearchParams(u.hash.slice(1));if(params.get('company')&&params.get('company')!==companyId)throw Error('El QR pertenece a otra empresa.');code=params.get('ticket')||u.pathname.split('/').pop();}
 const id=companyId,r=await api(eventsUrl(id,'/ticket/'+encodeURIComponent(code)));if(id!==companyId)return;eventSelected=r.attendee.event_id;await loadEvents();if(id!==companyId)return;$('eventSearch').value=code;renderEventAttendees();$('eventTicketStatus').textContent=r.attendee.name+' · DNI '+r.attendee.dni+' · '+attendeeLabels[r.attendee.state];
 }catch(e){$('eventTicketStatus').textContent=e.message;}
}
async function openTicketFromHash(){
 const params=new URLSearchParams(location.hash.slice(1)),code=params.get('ticket'),id=params.get('company');if(!code||!id)return false;
 if(!companies.some(c=>c.idEmpresa===id)){showNotice('No tenés acceso a la empresa de esta entrada.');return false;}
 $('companySelect').value=id;await changeCompany();if(!moduleEnabled('eventos'))return false;await go('events');await lookupEventTicket(code);return true;
}
window.addEventListener('hashchange',()=>{if(currentUser)openTicketFromHash().catch(e=>showNotice(e.message));});
