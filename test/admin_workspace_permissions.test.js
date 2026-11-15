import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {JSDOM} from 'jsdom';
import {businessAdminRouter} from '../src/business_admin_routes.js';
import {paymentRouter} from '../src/payment_routes.js';

test('una cuenta cliente no puede alterar configuración aun si tiene editBusiness', async () => {
  let writes = 0;
  const db = {query:async()=>{writes++; return {rows:[{permissions:{editBusiness:true}}]};}};
  const app = express();
  app.use(express.json());
  app.use('/api/company/:companyId',(req,_res,next)=>{
    req.session={uid:17,role:'ADMIN_EMPRESA'};
    next();
  });
  app.use('/api/company/:companyId/business-admin',businessAdminRouter(db,async()=>({company_id:'A'})));
  app.use('/api/company/:companyId/payments',paymentRouter(db));
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    for (const path of ['business-admin','payments']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/company/A/${path}`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'logo-remove',revision:0})
      });
      assert.equal(response.status,403,path);
    }
    assert.equal(writes,0,'la denegación no debe escribir en la base');
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});

test('todas las escrituras de configuración central exigen SUPERADMIN en el servidor',async()=>{
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  for (const path of ['order-hours','bot-instructions','profile']) {
    assert.ok(source.includes(`app.post('/api/company/:companyId/${path}',authRequired,requireSuperadmin,`),path);
  }
});

test('los controles administrativos están ocultos a clientes y existe vista expandida',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../public/workspace-layout.css',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/workspace-layout.js',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'outside-only'});
  try {
    const d=dom.window.document;
    assert.ok(d.querySelector('.nav [data-tab="business"]').classList.contains('admin-only'));
    assert.ok(d.querySelector('#more button[onclick="go(\'business\')"]').classList.contains('hidden-admin'));
    assert.match(html,/\['business','products','admin'\]\.includes\(tab\)/);
    assert.ok(html.includes('/workspace-layout.css'));
    assert.ok(css.includes('max-height: none'));
    assert.ok(css.includes('focus-mode'));
    dom.window.eval(js);
    dom.window.toggleWorkspaceMode();
    assert.equal(d.getElementById('app').classList.contains('focus-mode'),true);
    assert.equal(d.getElementById('workspaceModeButton').getAttribute('aria-pressed'),'true');
    dom.window.toggleWorkspaceMode();
    assert.equal(d.getElementById('app').classList.contains('focus-mode'),false);
    dom.window.toggleWorkspaceMode();
    dom.window.resetWorkspaceMode();
    assert.equal(d.getElementById('app').classList.contains('focus-mode'),false);
    assert.equal(d.getElementById('workspaceModeButton').getAttribute('aria-pressed'),'false');
    assert.match(html,/if\(typeof resetWorkspaceMode==='function'\)resetWorkspaceMode\(\)/);
  } finally {dom.window.close();}
});
