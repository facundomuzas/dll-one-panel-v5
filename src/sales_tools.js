import {createHash} from 'node:crypto';
import {getSalesCatalog,isSales} from './sales_catalog.js';

export async function initSalesTools(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_sales_price_changes (
  id BIGSERIAL PRIMARY KEY,company_id TEXT NOT NULL,actor TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,new_revision INTEGER NOT NULL,
  config JSONB NOT NULL,changes JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,previous_revision)
 )`);
}
export function priceConfig(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Configuración inválida.');
 const {operacion,porcentaje,redondeo,alcance}=input;
 if(!['AUMENTAR','DISMINUIR'].includes(operacion))throw Error('Operación inválida.');
 if(typeof porcentaje!=='number'||!Number.isFinite(porcentaje)||porcentaje<=0||porcentaje>1000||(operacion==='DISMINUIR'&&porcentaje>100))throw Error('Porcentaje inválido. Usá hasta 1000% de aumento o 100% de disminución.');
 if(![0,1,10,100,1000].includes(redondeo))throw Error('Redondeo inválido.');
 if(!['TODO','CATEGORIA','MARCA'].includes(alcance))throw Error('Alcance inválido.');
 const valor=alcance==='TODO'?'':input.valor;
 if(typeof valor!=='string'||valor.length>200||(alcance!=='TODO'&&!valor.trim()))throw Error('Completá la categoría o marca.');
 return {operacion,porcentaje,redondeo,alcance,valor:valor.trim()};
}
function calculate(row,companyId,input){
 const cfg=priceConfig(input),changes=[];
 for(const item of row.items){
  if(item.activo!=='SI'||item.modoPrecio!=='FIJO')continue;
  if(cfg.alcance!=='TODO'&&String(item[cfg.alcance==='CATEGORIA'?'categoria':'marca']||'').trim().toLowerCase()!==cfg.valor.toLowerCase())continue;
  const anterior=Number(item.precio);
  if(!Number.isFinite(anterior)||anterior<0)throw Error('Hay un precio inválido en la selección. Corregilo antes de ajustar.');
  const raw=anterior*(1+(cfg.operacion==='AUMENTAR'?1:-1)*cfg.porcentaje/100),step=cfg.redondeo||0.01;
  const nuevo=Number((Math.round((raw+Number.EPSILON*Math.max(1,raw))/step)*step).toFixed(2));
  if(!Number.isFinite(nuevo)||nuevo<0||nuevo>1e10)throw Error('El ajuste supera el precio máximo permitido.');
  changes.push({id:item.id,codigo:item.codigo,nombre:item.nombre,anterior,nuevo});
 }
 const token=createHash('sha256').update(JSON.stringify({companyId,revision:row.revision,cfg,changes})).digest('hex');
 return {revision:row.revision,cfg,cantidad:changes.length,modificados:changes.filter(x=>x.anterior!==x.nuevo).length,preview:changes.slice(0,20),token,changes};
}
function publicPreview(result){const {changes,...preview}=result;return preview;}
export async function previewSalesPrices(db,company,input){
 const row=await getSalesCatalog(db,company);if(!row)throw Error('Cargá primero el catálogo existente.');
 return publicPreview(calculate(row,company.company_id,input));
}
export async function applySalesPrices(db,company,input,actor){
 if(!isSales(company))throw Error('Esta sección requiere ONE Ventas.');
 const client=await db.connect();try{
  await client.query('BEGIN');
  const row=(await client.query('SELECT * FROM panel_sales_catalog WHERE company_id=$1 FOR UPDATE',[company.company_id])).rows[0];
  if(!row||!Number.isInteger(input.revision)||row.revision!==input.revision)throw Error('El catálogo cambió. Generá una nueva vista previa.');
  const result=calculate(row,company.company_id,input.cfg);
  if(typeof input.token!=='string'||input.token!==result.token)throw Error('La vista previa no coincide. Volvé a calcularla.');
  if(!result.modificados)throw Error('No hay precios diferentes para aplicar.');
  const prices=new Map(result.changes.map(x=>[x.id,x.nuevo]));
  const items=row.items.map(item=>prices.has(item.id)?{...item,precio:prices.get(item.id)}:item);
  await client.query('UPDATE panel_sales_catalog SET items=$2,revision=revision+1,updated_at=NOW() WHERE company_id=$1',[company.company_id,JSON.stringify(items)]);
  await client.query('INSERT INTO panel_sales_price_changes(company_id,actor,previous_revision,new_revision,config,changes) VALUES($1,$2,$3,$4,$5,$6)',[company.company_id,String(actor),row.revision,row.revision+1,JSON.stringify(result.cfg),JSON.stringify(result.changes)]);
  await client.query('COMMIT');return {revision:row.revision+1,items,cantidad:result.cantidad,modificados:result.modificados};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
const columns=['id','codigo','tipoItem','nombre','descripcion','precio','modoPrecio','unidad','categoria','marca','activo'];
const headers=['ID_INTERNO','CODIGO','TIPO_ITEM','NOMBRE','DESCRIPCION','PRECIO','MODO_PRECIO','UNIDAD','CATEGORIA','MARCA','ACTIVO'];
function csvCell(value){
 let text=String(value??'');
 // Los nombres/códigos no deben ejecutarse como fórmulas al abrir el CSV.
 if(/^[\s\u0000-\u001f]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
export async function exportSalesCsv(db,company){
 const row=await getSalesCatalog(db,company);if(!row)throw Error('Cargá primero el catálogo existente.');
 return {revision:row.revision,cantidad:row.items.length,csv:'\uFEFF'+[headers.map(csvCell).join(','),...row.items.map(item=>columns.map(key=>csvCell(item[key])).join(','))].join('\r\n')+'\r\n'};
}
