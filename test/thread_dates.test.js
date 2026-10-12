import test from 'node:test';
import assert from 'node:assert/strict';
import {dateMs,formatDateAr} from '../src/dates.js';
import {mergeThreadMessages} from '../src/thread_messages.js';
test('12/10 es octubre y 12:39 Argentina equivale a 15:39 UTC',()=>{
 assert.equal(dateMs('12/10/2026 12:39:42'),Date.parse('2026-10-12T15:39:42Z'));
 assert.equal(formatDateAr('12/10/2026 12:39:42',true),'12/10/2026 12:39:42');
});
test('reproducción de la captura: mensajes viejos antes de 14:34',()=>{
 const msgs=mergeThreadMessages([
 {fecha:'12/10/2026 12:39:42',tipo:'CLIENTE',mensaje:'Consulta vieja'},
 {fecha:'12/10/2026 12:39:44',tipo:'BOT',mensaje:'Dirección vieja'}
 ],[
 {created_at:'2026-10-12T17:34:06Z',sender_type:'BOT',message:'Respuesta nueva'},
 {created_at:'2026-10-12T17:34:03Z',sender_type:'CLIENTE',message:'Consulta nueva'}
 ]);
 assert.deepEqual(msgs.map(x=>x.mensaje),['Consulta vieja','Dirección vieja','Consulta nueva','Respuesta nueva']);
});
test('días mayores a 12, cambio de mes y de año',()=>{
 for(const [local,iso] of [['31/12/2026 23:59:00','2027-01-01T02:59:00Z'],['13/10/2026 00:00:00','2026-10-13T03:00:00Z'],['01/11/2026 00:01:00','2026-11-01T03:01:00Z']]){
  assert.equal(dateMs(local),Date.parse(iso));assert.equal(formatDateAr(iso,true),local);
 }
});
test('fuentes Date, epoch, ISO y fecha de planilla convergen',()=>{
 const expected=Date.parse('2026-10-12T15:39:42Z');
 for(const v of [expected,new Date(expected),'2026-10-12T12:39:42-03:00','2026-10-12 12:39:42']) assert.equal(dateMs(v),expected);
});
test('fechas inválidas no se convierten a otro día',()=>{
 for(const v of ['31/02/2026 12:00','12/10/2026 25:00','13/13/2026','sin fecha',null]) assert.equal(dateMs(v),0);
});
test('timestamp original tiene prioridad sobre texto formateado',()=>{
 const r=mergeThreadMessages([{fecha:'texto',timestamp:Date.parse('2026-10-12T15:00:00Z'),tipo:'BOT',mensaje:'Anterior'}],[{created_at:'2026-10-12T16:00:00Z',sender_type:'BOT',message:'Siguiente'}]);
 assert.deepEqual(r.map(x=>x.mensaje),['Anterior','Siguiente']);
});
test('misma copia en planilla y runtime aparece una sola vez',()=>{
 const r=mergeThreadMessages([{fecha:'12/10/2026 12:39:42',tipo:'BOT',mensaje:'Hola'}],[{created_at:'2026-10-12T15:39:42Z',sender_type:'BOT',message:'Hola',wamid:'w1'}]);
 assert.equal(r.length,1);
});
