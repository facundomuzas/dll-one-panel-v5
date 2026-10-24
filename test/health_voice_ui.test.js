import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
test('agenda ofrece cancelación sin circuito profesional y muestra estado existente',async()=>{
 const dom=new JSDOM('<div id="healthAgenda"></div><input id="healthDate" value="2026-10-25"><input id="healthFilter"><input id="healthSpecialtyFilter"><input id="healthServiceFilter"><div id="healthStatus"></div>',{runScripts:'outside-only'});
 const w=dom.window;w.$=id=>w.document.getElementById(id);w.companyId='A';w.api=async url=>({items:[{id:'T1',patient:'Persona Prueba',dni:'12345678',doctor_name:'Doctor',mode:'FIXED',slot:'08:00',state:'BOOKED'}]});
 w.eval(readFileSync(new URL('../public/health_demo.js',import.meta.url),'utf8'));await w.eval('loadHealthAgendaData()');assert.equal(w.document.querySelectorAll('select').length,0);assert.equal(w.document.querySelector('button').textContent,'Cancelar turno');dom.window.close();
});
test('control del adicional carga desactivado y envía revisión y voz, sin claves',async()=>{
 const dom=new JSDOM('<div id="companyServiceList"></div><div id="companyServiceStatus"></div>',{runScripts:'outside-only'});const w=dom.window;w.$=id=>w.document.getElementById(id);let body;
 w.api=async(url,options)=>{if(!options)return {items:[{company_id:'A',company_name:'Empresa',service_state:'ACTIVE',voice:{enabled:false,voiceId:'',revision:0}}]};body=JSON.parse(options.body);return {voice:{...body,revision:1}};};
 w.eval(readFileSync(new URL('../public/company_service.js',import.meta.url),'utf8'));await w.eval('loadCompanyServices()');const field=w.document.querySelector('fieldset');assert.equal(field.querySelector('input[type=checkbox]').checked,false);field.querySelector('input[type=checkbox]').checked=true;field.querySelector('input:not([type=checkbox])').value='testvoice';await field.querySelector('button').onclick();assert.deepEqual(JSON.parse(JSON.stringify(body)),{enabled:true,voiceId:'testvoice',revision:0});dom.window.close();
});
