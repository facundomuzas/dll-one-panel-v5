let orderHoursRevision=null,orderHoursCompany='',orderHoursBusy=false;
const orderHoursDays=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
function renderOrderHoursDays(days){
 $('orderHoursDays').innerHTML=orderHoursDays.map((name,index)=>`<div class="hours-day" data-hours-day="${index}"><strong>${name}</strong><div class="hours-slots"></div><button type="button" class="btn btn-light" onclick="addOrderHoursSlot(${index})">+ Turno</button></div>`).join('');
 days.forEach((slots,day)=>slots.forEach(slot=>addOrderHoursSlot(day,slot)));
 updateOrderHoursMode();
}
function addOrderHoursSlot(day,slot={start:'09:00',end:'18:00'}){
 const box=$('orderHoursDays').querySelector(`[data-hours-day="${day}"] .hours-slots`);if(!box||box.children.length>=4)return;
 const row=document.createElement('div');row.className='hours-slot';
 row.innerHTML='<label>Desde <input type="time" data-hour-start required></label><label>Hasta <input type="time" data-hour-end required></label><button type="button" class="btn btn-light">Quitar</button>';
 row.querySelector('[data-hour-start]').value=slot.start;row.querySelector('[data-hour-end]').value=slot.end;
 row.querySelector('button').onclick=()=>row.remove();box.appendChild(row);
}
function updateOrderHoursMode(){
 $('orderHoursDays').hidden=$('orderHoursMode').value!=='SCHEDULED';
}
function resetOrderHours(){
 orderHoursCompany=companyId;orderHoursRevision=null;$('orderHoursFields').disabled=true;$('orderHoursStatus').textContent='';
 $('orderHoursMode').value='ALWAYS';$('orderHoursZone').value='America/Argentina/Buenos_Aires';$('orderHoursMessage').value='';renderOrderHoursDays(Array.from({length:7},()=>[]));
}
async function loadOrderHours(){
 const target=companyId;resetOrderHours();$('orderHoursStatus').textContent='Cargando horarios…';
 try{const r=await api(`/api/company/${encodeURIComponent(target)}/order-hours`);if(target!==companyId)return;
  orderHoursRevision=r.revision;orderHoursCompany=target;
  $('orderHoursMode').value=r.settings.mode;$('orderHoursZone').value=r.settings.timeZone;$('orderHoursMessage').value=r.settings.closedMessage||'';
  renderOrderHoursDays(r.settings.days);$('orderHoursFields').disabled=false;
  $('orderHoursStatus').textContent=r.status.open?'Ahora: recepción de pedidos habilitada.':'Ahora: recepción de pedidos cerrada.';
 }catch(err){if(target===companyId)$('orderHoursStatus').textContent='No se pudieron cargar los horarios: '+err.message;}
}
async function saveOrderHoursForm(){
 if(orderHoursBusy||orderHoursRevision===null||orderHoursCompany!==companyId)return;
 const target=companyId;
 const settings={mode:$('orderHoursMode').value,timeZone:$('orderHoursZone').value.trim(),closedMessage:$('orderHoursMessage').value.trim(),days:orderHoursDays.map((_,day)=>[...$('orderHoursDays').querySelectorAll(`[data-hours-day="${day}"] .hours-slot`)].map(row=>({start:row.querySelector('[data-hour-start]').value,end:row.querySelector('[data-hour-end]').value})))};
 orderHoursBusy=true;$('orderHoursFields').disabled=true;$('orderHoursStatus').textContent='Guardando horarios…';
 try{const r=await api(`/api/company/${encodeURIComponent(target)}/order-hours`,{method:'POST',body:JSON.stringify({settings,revision:orderHoursRevision})});if(target!==companyId)return;
  orderHoursRevision=r.revision;$('orderHoursStatus').textContent='Horarios guardados. '+(r.status.open?'Ahora se aceptan pedidos.':'Ahora no se aceptan pedidos nuevos.');
 }catch(err){if(target===companyId)$('orderHoursStatus').textContent='No se guardó: '+err.message;}
 finally{orderHoursBusy=false;if(target===companyId)$('orderHoursFields').disabled=orderHoursRevision===null;}
}
