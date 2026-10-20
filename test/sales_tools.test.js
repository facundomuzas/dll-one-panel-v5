import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initSalesCatalog} from '../src/sales_catalog.js';
import {initSalesTools,priceConfig,previewSalesPrices,applySalesPrices,exportSalesCsv} from '../src/sales_tools.js';
import {salesToolsRouter} from '../src/sales_tools_routes.js';
import express from 'express';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const company={company_id:'A',modules:{ventas:true}};
const cfg={operacion:'AUMENTAR',porcentaje:10,redondeo:0,alcance:'TODO',valor:''};
const products=[
 {id:'1',codigo:'UNO',nombre:'Producto "Uno"',precio:100,activo:'SI',modoPrecio:'FIJO',categoria:'Bebidas',marca:'Marca A'},
 {id:'2',codigo:'DOS',nombre:'Dos',precio:200,activo:'NO',modoPrecio:'FIJO',categoria:'Bebidas'},
 {id:'3',codigo:'TRES',nombre:'Tres',precio:300,activo:'SI',modoPrecio:'A_COTIZAR'},
 {id:'4',codigo:'=1+1',nombre:'Cuatro\nsegunda línea',precio:10.05,activo:'SI',modoPrecio:'FIJO',categoria:'Otra',marca:'Marca A'}
];
test('precios y exportación con PostgreSQL real',async t=>{
 const pg=new PGlite();let failAudit=false;
 const query=(sql,args)=>{if(failAudit&&sql.startsWith('INSERT INTO panel_sales_price_changes'))throw Error('auditoría no disponible');return pg.query(sql,args);};
 const db={query,connect:async()=>({query,release(){}})};
 try{
 await initSalesCatalog(db);await initSalesTools(db);
 await pg.query('INSERT INTO panel_sales_catalog(company_id,items) VALUES ($1,$2),($3,$2)',['A',JSON.stringify(products),'B']);
 await t.test('preview no escribe, omite inactivos/cotizables y redondea centavos',async()=>{
  const p=await previewSalesPrices(db,company,cfg);assert.equal(p.cantidad,2);assert.deepEqual(p.preview.map(x=>x.nuevo),[110,11.06]);
  assert.equal((await pg.query('SELECT revision FROM panel_sales_catalog WHERE company_id=$1',['A'])).rows[0].revision,1);
 });
 await t.test('filtros exactos sin distinguir mayúsculas y redondeos',async()=>{
  const p=await previewSalesPrices(db,company,{...cfg,alcance:'CATEGORIA',valor:' bebidas ',redondeo:100});assert.equal(p.cantidad,1);assert.equal(p.preview[0].nuevo,100);
  const m=await previewSalesPrices(db,company,{...cfg,alcance:'MARCA',valor:'marca a'});assert.equal(m.cantidad,2);
  const none=await previewSalesPrices(db,company,{...cfg,alcance:'MARCA',valor:'inexistente'});assert.equal(none.modificados,0);
  await assert.rejects(applySalesPrices(db,company,none,7),/No hay precios/);
 });
 await t.test('validación estricta de operación, porcentaje y módulo',async()=>{
  for(const bad of [{porcentaje:0},{porcentaje:Infinity},{porcentaje:'10'},{operacion:'OTRA'},{redondeo:5},{alcance:'CATEGORIA',valor:''},{operacion:'DISMINUIR',porcentaje:101}])assert.throws(()=>priceConfig({...cfg,...bad}));
  await assert.rejects(previewSalesPrices(db,{...company,modules:{gastro:true}},cfg),/Ventas/);
  const free=await previewSalesPrices(db,company,{...cfg,operacion:'DISMINUIR',porcentaje:100});assert.equal(free.preview[0].nuevo,0);
 });
 await t.test('aplicación atómica, auditoría y bloqueo de reintento/vista previa modificada',async()=>{
  const p=await previewSalesPrices(db,company,cfg);
  await assert.rejects(applySalesPrices(db,company,{...p,cfg:{...p.cfg,porcentaje:20}},7),/no coincide/);
  await assert.rejects(applySalesPrices(db,{...company,company_id:'B'},p,7),/no coincide/);
  const result=await applySalesPrices(db,company,p,7);assert.equal(result.revision,2);assert.equal(result.items[1].precio,200);assert.equal(result.items[2].precio,300);
  await assert.rejects(applySalesPrices(db,company,p,7),/cambió/);
  const logs=(await pg.query('SELECT * FROM panel_sales_price_changes')).rows;assert.equal(logs.length,1);assert.equal(logs[0].actor,'7');assert.equal(logs[0].changes[0].anterior,100);
  assert.equal((await pg.query('SELECT items FROM panel_sales_catalog WHERE company_id=$1',['B'])).rows[0].items[0].precio,100);
 });
 await t.test('fallo de auditoría revierte precios y revisión',async()=>{
  const p=await previewSalesPrices(db,company,cfg);failAudit=true;
  await assert.rejects(applySalesPrices(db,company,p,7),/auditoría/);failAudit=false;
  const after=await previewSalesPrices(db,company,cfg);assert.equal(after.token,p.token);
 });
 await t.test('CSV completo, escapes y protección de fórmulas',async()=>{
  const result=await exportSalesCsv(db,company);assert.equal(result.cantidad,4);assert.ok(result.csv.startsWith('\uFEFF'));assert.match(result.csv,/"'\=1\+1"/);assert.match(result.csv,/Producto ""Uno""/);assert.match(result.csv,/Cuatro\nsegunda línea/);assert.match(result.csv,/A_COTIZAR/);
 });
 }finally{await pg.close();}
});

test('UI: aplicación exitosa actualiza lista y exportación conserva descarga al editar un filtro',async()=>{
 const dom=new JSDOM('<div id="salesTools"></div>',{runScripts:'outside-only'}),w=dom.window;
 w.$=id=>w.document.getElementById(id);w.companyId='A';w.money=String;w.confirm=()=>true;
 w.catalogItems=[];w.salesRevision=null;let renders=0,downloads=0;
 w.renderCatalog=()=>renders++;w.clearCatalogForm=()=>{};
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads++;};
 w.eval(readFileSync(new URL('../public/sales_tools.js',import.meta.url),'utf8'));
 const requests=[];w.api=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
 const loaded=w.loadSalesTools();requests[0].resolve({canEdit:true});await loaded;
 const preview=w.previewSalesPriceChange();requests[1].resolve({cfg,revision:1,token:'t',cantidad:1,modificados:1,preview:[]});await preview;
 const saving=w.applySalesPriceChange();requests[2].resolve({revision:2,items:products,modificados:1});await saving;
 assert.equal(w.salesRevision,2);assert.equal(renders,1);assert.equal(w.$('salesPriceApply').disabled,true);assert.equal(w.$('salesPriceFields').disabled,false);
 const exporting=w.downloadSalesCatalog();w.$('salesPricePercent').dispatchEvent(new w.Event('input',{bubbles:true}));
 requests[3].resolve({csv:'NOMBRE\r\nUno',revision:2,cantidad:1});await exporting;
 assert.equal(downloads,1);assert.equal(w.$('salesExport').disabled,false);
 dom.window.close();
});

test('rutas: consulta no ajusta, Gastro rechazado y control global antes del router',async()=>{
 const db={query:async()=>({rows:[{permissions:{view:true,editCatalog:false}}]})};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.session={uid:1,role:'USER'};next();});
 app.use('/api/company/:companyId/catalog/tools',salesToolsRouter(db,async id=>({company_id:id,modules:{[id==='G'?'gastro':'ventas']:true}})));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const access=await fetch(base+'/api/company/A/catalog/tools').then(r=>r.json());assert.equal(access.canEdit,false);
  for(const action of ['preview','apply'])assert.equal((await fetch(base+'/api/company/A/catalog/tools/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/company/G/catalog/tools/export')).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.ok(source.indexOf("app.use('/api/company/:companyId/catalog/tools'")>source.indexOf('  authRequired,\n  companyAccessRequired,\n  requireConfiguredModule(getCompany)'));
});

test('UI: preview se invalida al editar y no mezcla empresas ni interpreta HTML',async()=>{
 const dom=new JSDOM('<div id="salesTools"></div>',{runScripts:'outside-only'}),w=dom.window;
 w.$=id=>w.document.getElementById(id);w.companyId='A';w.money=x=>String(x);w.confirm=()=>true;
 w.eval(readFileSync(new URL('../public/sales_tools.js',import.meta.url),'utf8'));
 const requests=[];w.api=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
 const loading=w.loadSalesTools();requests[0].resolve({canEdit:true});await loading;
 w.$('salesPricePercent').value='10';const first=w.previewSalesPriceChange();
 w.$('salesPricePercent').value='20';w.$('salesPricePercent').dispatchEvent(new w.Event('input',{bubbles:true}));
 const p={cfg,revision:1,token:'token',cantidad:1,modificados:1,preview:[{codigo:'1',nombre:'<img src=x>',anterior:100,nuevo:110}]};
 requests[1].resolve(p);await first;assert.equal(w.$('salesPriceApply').disabled,true);
 const second=w.previewSalesPriceChange();requests[2].resolve(p);await second;assert.equal(w.$('salesPriceApply').disabled,false);assert.equal(w.$('salesPriceRows').querySelector('img'),null);
 const applying=w.applySalesPriceChange();assert.equal(w.$('salesPriceFields').disabled,true);
 await w.applySalesPriceChange();assert.equal(requests.length,4);
 w.companyId='B';const other=w.loadSalesTools();requests[4].resolve({canEdit:false});await other;
 requests[3].reject(Error('timeout'));await applying;assert.equal(w.$('salesPriceFields').disabled,true);assert.equal(w.$('salesPriceRows').textContent,'');assert.doesNotMatch(w.$('salesToolsStatus').textContent,/timeout/);
 dom.window.close();
});
