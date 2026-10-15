import {randomUUID} from 'node:crypto';
import {enabled,isGastro} from './gastro_catalog.js';
export const isSales=c=>!isGastro(c)&&enabled(c?.modules?.ventas??c?.modules?.MODULO_VENTAS);
export async function initSalesCatalog(db){await db.query(`CREATE TABLE IF NOT EXISTS panel_sales_catalog(company_id TEXT PRIMARY KEY,items JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);}
const str=(x,n=200)=>String(x??'').trim().slice(0,n);
function normalize(input,old={}){
 old=old||{};
 const x={...old,...input};
 const nombre=str(x.nombre),precio=Number(x.precio);
 if(!nombre)throw Error('Ingresá el nombre.');
 if(x.precio===''||x.precio==null||!Number.isFinite(precio)||precio<0||precio>1e10)throw Error('Precio inválido.');
 const modoPrecio=str(x.modoPrecio||'FIJO').toUpperCase();if(!['FIJO','A_COTIZAR'].includes(modoPrecio))throw Error('Modo de precio inválido.');
 const tipoItem=str(x.tipoItem||'PRODUCTO').toUpperCase();if(!['PRODUCTO','SERVICIO'].includes(tipoItem))throw Error('Tipo de item inválido.');
 return {...old,id:old.id||'SALE-'+randomUUID(),codigo:str(x.codigo),nombre,descripcion:str(x.descripcion,2000),precio,tipoItem,modoPrecio,unidad:str(x.unidad||'unidad'),categoria:str(x.categoria),marca:str(x.marca),activo:enabled(x.activo??'SI')?'SI':'NO'};
}
export async function getSalesCatalog(db,company,readLegacy){
 if(!isSales(company))throw Error('Esta sección requiere ONE Ventas sin Gastro.');
 let row=(await db.query('SELECT * FROM panel_sales_catalog WHERE company_id=$1',[company.company_id])).rows[0];
 if(row||!readLegacy)return row||null;
 const result=await readLegacy();if(!Array.isArray(result?.items))throw Error('No se pudo importar la lista completa. No se modificó ningún producto.');
 const items=result.items.map((x,i)=>({...normalize(x),fila:i+2}));
 await db.query('INSERT INTO panel_sales_catalog(company_id,items) VALUES($1,$2) ON CONFLICT DO NOTHING',[company.company_id,JSON.stringify(items)]);
 return getSalesCatalog(db,company);
}
export async function saveSalesItems(db,company,inputs,revision,{bulk=false}={}){
 if(!isSales(company))throw Error('Esta sección requiere ONE Ventas sin Gastro.');
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>1000)throw Error('Ingresá entre 1 y 1000 productos.');
 const client=await db.connect();try{
  await client.query('BEGIN');
  const row=(await client.query('SELECT * FROM panel_sales_catalog WHERE company_id=$1 FOR UPDATE',[company.company_id])).rows[0];
  if(!row)throw Error('Primero cargá la lista existente.');
  if(!Number.isInteger(revision)||revision!==row.revision)throw Error('La lista cambió. Recargá antes de guardar.');
  const items=row.items;const seen=new Set();
  for(const input of inputs){
   const code=str(input.codigo);if(bulk&&code&&seen.has(code))throw Error('Código repetido en el archivo: '+code);if(code)seen.add(code);
   let old=input.id?items.find(x=>x.id===input.id):null;
   if(input.id&&!old)throw Error('El producto no pertenece a esta empresa.');
   if(bulk&&code){const matches=items.filter(x=>x.codigo===code);if(matches.length>1)throw Error('Hay más de un producto con el código '+code);old=matches[0]||null;}
   if(!bulk&&code&&items.some(x=>x.codigo===code&&x!==old))throw Error('Ese código ya existe. Editá el producto existente.');
   const item=normalize(input,old);item.fila=old?.fila||Math.max(1,...items.map(x=>x.fila||1))+1;
   if(old)items[items.indexOf(old)]=item;else items.push(item);
  }
  const saved=(await client.query('UPDATE panel_sales_catalog SET items=$2,revision=revision+1,updated_at=NOW() WHERE company_id=$1 RETURNING *',[company.company_id,JSON.stringify(items)])).rows[0];
  await client.query('COMMIT');return {...saved,guardados:inputs.length};
 }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export function salesMotorCatalog(items){return {categorias:[],variantes:[],extras:[],productos:items.filter(x=>enabled(x.activo)).map(x=>({id:x.id,nombre:x.nombre,descripcion:x.descripcion,precio_base:x.precio,requiere_cotizacion:x.modoPrecio==='A_COTIZAR',agotado:false}))};}
export async function validateSalesOrder(db,company,payload){
 if(!isSales(company))return;
 const row=await getSalesCatalog(db,company);if(!row)return;
 const cart=payload.orderJson?.carrito;if(!Array.isArray(cart)||!cart.length)throw Error('Pedido sin productos.');
 for(const item of cart){const p=row.items.find(x=>x.id===item.idProducto);
  if(!p||!enabled(p.activo)||p.modoPrecio==='A_COTIZAR'||Number(item.precioBase)!==p.precio)throw Error('El catálogo cambió o el producto requiere cotización. Revisá el pedido antes de confirmar.');
 }
}

export function parseSalesPrice(value){
 if(typeof value==='number'){if(!Number.isFinite(value)||value<0)throw Error('Precio inválido.');return value;}
 let v=String(value??'').trim().replace(/^\$\s*/, '').replace(/\s/g,'');
 if(!v)throw Error('Falta el precio de una fila. Usá 0 solo si el producto es gratuito.');
 if(v.includes(',')){if(!/^\d{1,3}(?:\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(v))throw Error('Formato de precio inválido: '+value);v=v.replace(/\./g,'').replace(',','.');}
 else if(/^\d{1,3}(?:\.\d{3})+$/.test(v))v=v.replace(/\./g,'');
 if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('Formato de precio inválido: '+value);
 return Number(v);
}
