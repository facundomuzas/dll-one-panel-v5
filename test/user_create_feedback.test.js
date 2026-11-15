import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('  async function createPanelUser(){'),html.indexOf("\n  if('serviceWorker'"));
function setup(){
 const dom=new JSDOM(html,{runScripts:'outside-only'});const w=dom.window;
 w.$=id=>w.document.getElementById(id);w.showNotice=()=>{};w.loadAdmin=async()=>{};
 w.eval(code);w.$('adminUserLogin').value='test-user';w.$('adminUserCompany').innerHTML='<option value="A">A</option>';
 return {dom,w};
}
test('short password shows visible feedback and does not send a request',async()=>{
 const {dom,w}=setup();let calls=0;w.api=async()=>calls++;w.$('adminUserPassword').value='abcd';
 await w.createPanelUser();assert.equal(calls,0);assert.match(w.$('adminUserCreateStatus').textContent,/12 caracteres/);
 assert.equal(w.document.activeElement.id,'adminUserPassword');assert.equal(w.$('adminUserPassword').getAttribute('aria-invalid'),'true');dom.window.close();
});
test('server errors remain visible, preserve input and allow retry; refresh failure does not report creation failure',async()=>{
 const {dom,w}=setup();w.$('adminUserPassword').value='test-passphrase';w.api=async()=>{throw Error('Ya existe un usuario con ese acceso.');};
 await w.createPanelUser();assert.match(w.$('adminUserCreateStatus').textContent,/Ya existe/);assert.equal(w.$('adminUserPassword').value,'test-passphrase');assert.equal(w.$('adminUserCreateButton').disabled,false);
 w.api=async()=>({ok:true});w.loadAdmin=async()=>{throw Error('network');};await w.createPanelUser();
 assert.match(w.$('adminUserCreateStatus').textContent,/usuario fue creado/);assert.equal(w.$('adminUserPassword').value,'');dom.window.close();
});
