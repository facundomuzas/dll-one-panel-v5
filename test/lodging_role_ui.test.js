import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const lodging=readFileSync(new URL('../public/lodging.js',import.meta.url),'utf8');
const operations=readFileSync(new URL('../public/lodging-operations.js',import.meta.url),'utf8');
function setup() {
 const w=new JSDOM(html,{runScripts:'outside-only'}).window;
 w.eval("var $=id=>document.getElementById(id);var companyId='A';var api=async()=>({settings:{},revision:0,bookings:[],canOperate:true,canConfigure:false});"
   +lodging.replace(/^let /,'var ')
   +operations.replace(/^let /,'var '));
 return w;
}
test('operador de cabañas puede confirmar reservas sin habilitar configuración central',async()=>{
 const w=setup();
 try {
   w.eval("lodgingSeq=1;lodgingCanEdit=false;lodgingItems=[]");
   await w.loadLodgingOperations();
   assert.equal(w.document.getElementById('lodgingBookingFields').disabled,false);
   assert.equal(w.document.getElementById('lodgingSettingsFields').disabled,true);
 } finally {w.close();}
});
test('el cambio de empresa revoca también permisos de reservas y configuración',()=>{
 const w=setup();
 try {
  w.eval("lodgingCanOperate=true;lodgingCanConfigure=true;resetLodging()");
  assert.equal(w.eval('lodgingCanOperate'),false);
  assert.equal(w.eval('lodgingCanConfigure'),false);
 } finally {w.close();}
});
