let migrationAuditBusy=false;
async function loadMigrationAudit(){
 if(migrationAuditBusy)return;
 migrationAuditBusy=true;$('migrationAuditButton').disabled=true;$('migrationAuditButton').textContent='Revisando…';
 $('migrationAuditStatus').textContent='Leyendo datos del panel y pendientes del motor…';$('migrationAuditResults').replaceChildren();
 try{
  const r=await api('/api/admin/migration-audit');
  const box=$('migrationAuditResults');
  function line(parent,text){const p=document.createElement('p');p.textContent=text;parent.appendChild(p);return p;}
  const time=new Date(r.checkedAt).toLocaleString();
  $('migrationAuditStatus').textContent=r.reviewClear?`Revisión del ${time}: datos evaluados preparados y sin pendientes detectados. Mantené Apps Script activo hasta completar la prueba de desconexión.`:`Revisión del ${time}: quedan puntos por revisar. Seguí las indicaciones de abajo.`;
  if(!r.motor.available)line(box,'⚠ No pude consultar el motor. Verificá que esté activo, actualizado a 4.3.15 y conectado al panel. Los pendientes no se consideran resueltos.');
  else{
   line(box,`Motor ${r.motor.version}. Pendientes globales de todas las empresas:`);
   if(r.motor.storage){
    const storage=r.motor.storage;
    line(box,'Panel: datos, comprobantes e imágenes del menú en PostgreSQL.');
    line(box,'Motor: '+storage.runtimeFile+' (conversaciones en curso y pendientes); '+storage.configFile+' (configuración local).');
    const mount=String(storage.volumeMount||'').replace(/\/+$/,'');
    const inVolume=mount&&[storage.runtimeFile,storage.configFile].every(p=>String(p).startsWith(mount+'/'));
    line(box,inVolume?'El motor declara un volumen en '+mount+'. Falta comprobar recuperación tras reinicio y respaldos.':'⚠ No se confirmó un volumen para ambos archivos del motor. Revisá almacenamiento antes de desconectar Apps Script.');
   }
   line(box,`Copias antiguas hacia Apps Script: ${r.motor.legacyMirrors}. Mensajes por procesar: ${r.motor.messagesPending}. Registros de conversación por guardar: ${r.motor.conversationEventsPending}.`);
   if(r.motor.legacyMirrors)line(box,'Mantené Apps Script activo para que el motor complete las copias antiguas. No borres la cola. Si el número no baja, revisá los logs del motor.');
   if(r.motor.messagesPending||r.motor.conversationEventsPending)line(box,'Esperá a que termine el procesamiento y volvé a revisar. Estos contadores no significan necesariamente que falten datos por migrar.');
   if(r.motor.unknownCompanies.length)line(box,'⚠ Hay empresas en el motor sin ficha en el panel: '+r.motor.unknownCompanies.join(', ')+'. Revisá esas empresas antes de desconectar el sistema anterior.');
  }
  if(!r.companies.length)line(box,'No hay empresas para evaluar.');
  for(const c of r.companies){
   const section=document.createElement('section');section.style.marginTop='18px';const title=document.createElement('h4');title.textContent=c.name;section.appendChild(title);
   for(const check of c.checks){line(section,(check.ready?'✓ ':'⚠ ')+check.label);if(check.action)line(section,check.action);}
   line(section,c.motorObserved?'✓ El motor reconoce la conexión del panel y su estado habilitado/deshabilitado.':'⚠ La conexión del panel todavía no está comprobada en el motor. Si recién la migraste, esperá unos 30 segundos y volvé a revisar.');
   box.appendChild(section);
  }
  line(box,'Alcance: conexión, instrucciones, catálogos de ONE Gastro/ONE Ventas y archivos del menú. Esta revisión no comprueba que el bot responda, no certifica otros módulos ni la persistencia de los archivos locales del motor. Probá WhatsApp antes del cierre de la migración.');
 }catch(err){$('migrationAuditStatus').textContent='No se pudo completar la revisión: '+err.message;}
 finally{migrationAuditBusy=false;$('migrationAuditButton').disabled=false;$('migrationAuditButton').textContent='Revisar migración';}
}
