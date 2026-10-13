import {randomUUID} from 'node:crypto';

export const enabled = value => value === true || ['SI','TRUE','1'].includes(String(value).toUpperCase());
export const isGastro = company => enabled(company?.modules?.gastro ?? company?.modules?.MODULO_GASTRO);
const specs = {category:['categorias','idCategoria','activa'],product:['productos','idProducto','activo'],variant:['variantes','idVariante','activa'],extra:['extras','idExtra','activo']};
export async function initGastroCatalog(db){
  await db.query(`CREATE TABLE IF NOT EXISTS panel_gastro_catalog (
    company_id TEXT PRIMARY KEY, catalog JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
export async function getGastroCatalog(db, company, seed=true){
  if(!isGastro(company)) throw new Error('Esta empresa no tiene ONE Gastro habilitado.');
  if(seed){
    const source=company.snapshot?.data?.gastroBundle;
    if(source && Object.values(specs).every(([key])=>Array.isArray(source[key]))){
      const catalog=Object.fromEntries(Object.values(specs).map(([key])=>[key,source[key]]));
      await db.query(`INSERT INTO panel_gastro_catalog(company_id,catalog) VALUES($1,$2)
        ON CONFLICT(company_id) DO NOTHING`,[company.company_id,JSON.stringify(catalog)]);
    }
  }
  const {rows}=await db.query('SELECT * FROM panel_gastro_catalog WHERE company_id=$1',[company.company_id]);
  if(!rows[0] && seed) throw new Error('Falta la copia inicial completa del catálogo Gastro. Sincronizá el panel una vez desde Apps Script antes de editar; no se reemplazó tu menú.');
  return rows[0]||null;
}
function number(value,label,min=0,max=1e10){
  const n=Number(value);if(value==='' || !Number.isFinite(n)||n<min||n>max)throw new Error(label+' inválido.');return n;
}
function flag(value,fallback='SI'){return value===undefined?fallback:(enabled(value)?'SI':'NO');}
export async function saveGastroItem(db,company,kind,input){
  const spec=specs[kind];if(!spec)throw new Error('Tipo inválido.');
  await getGastroCatalog(db,company);
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query('SELECT * FROM panel_gastro_catalog WHERE company_id=$1 FOR UPDATE',[company.company_id])).rows[0];
    const catalog=row.catalog,[key,idKey,activeKey]=spec;
    if(input.revision!==undefined && Number(input.revision)!==row.revision)throw new Error('El menú cambió en otra sesión. Recargá Gastro antes de guardar.');
    const id=String(input[idKey]||'');
    const old=id?catalog[key].find(x=>x[idKey]===id):null;
    if(id&&!old)throw new Error('El registro no pertenece a esta empresa.');
    const item={...old,...Object.fromEntries(Object.entries(input).filter(([k])=>!['revision','__proto__','constructor','prototype'].includes(k)))};
    item[idKey]=id||kind.toUpperCase()+'-'+randomUUID();
    item.nombre=String(item.nombre||'').trim().slice(0,120);
    if(!item.nombre)throw new Error('Ingresá un nombre.');
    item[activeKey]=flag(item[activeKey]);
    item.orden=number(item.orden??0,'Posición',0,100000);
    if(kind==='product'){
      item.precioBase=number(item.precioBase,'Precio');
      item.idCategoria=String(item.idCategoria||'');
      if(item.idCategoria&&!catalog.categorias.some(x=>x.idCategoria===item.idCategoria))throw new Error('Categoría inválida.');
      item.descripcion=String(item.descripcion||'').slice(0,700);item.agotado=flag(item.agotado,'NO');
    }
    if(kind==='variant'){
      if(!catalog.productos.some(x=>x.idProducto===item.idProducto))throw new Error('Seleccioná un producto válido.');
      item.precio=number(item.precio,'Precio');
    }
    if(kind==='extra'){
      item.precio=number(item.precio,'Precio');item.aplicaA=String(item.aplicaA||'TODOS').toUpperCase();
      if(!['TODOS','PRODUCTO','CATEGORIA'].includes(item.aplicaA))throw new Error('Aplicación del extra inválida.');
      item.referenciaId=String(item.referenciaId||'');
      if(item.aplicaA==='TODOS')item.referenciaId='';
      if(item.aplicaA==='PRODUCTO'&&!catalog.productos.some(x=>x.idProducto===item.referenciaId))throw new Error('Producto del extra inválido.');
      if(item.aplicaA==='CATEGORIA'&&!catalog.categorias.some(x=>x.idCategoria===item.referenciaId))throw new Error('Categoría del extra inválida.');
      item.maxCantidad=number(item.maxCantidad??1,'Cantidad máxima',1,20);
    }
    if(old)catalog[key][catalog[key].indexOf(old)]=item;else catalog[key].push(item);
    catalog[key].sort((a,b)=>Number(a.orden||0)-Number(b.orden||0)||a.nombre.localeCompare(b.nombre));
    const saved=(await client.query(`UPDATE panel_gastro_catalog SET catalog=$2,revision=revision+1,updated_at=NOW() WHERE company_id=$1 RETURNING *`,[company.company_id,JSON.stringify(catalog)])).rows[0];
    await client.query('COMMIT');return {item,revision:saved.revision};
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
}
export function motorCatalog(c){
  const categorias=c.categorias.filter(x=>enabled(x.activa)).map(x=>({id:x.idCategoria,nombre:x.nombre}));
  const cats=new Set(categorias.map(x=>x.id));
  const productos=c.productos.filter(x=>enabled(x.activo)&&(!x.idCategoria||cats.has(x.idCategoria))).map(x=>({id:x.idProducto,categoria_id:x.idCategoria,nombre:x.nombre,descripcion:x.descripcion,precio_base:Number(x.precioBase),agotado:enabled(x.agotado)}));
  const ids=new Set(productos.map(x=>x.id));
  const variantes=c.variantes.filter(x=>enabled(x.activa)&&ids.has(x.idProducto)).map(x=>({id:x.idVariante,producto_id:x.idProducto,nombre:x.nombre,precio:Number(x.precio)}));
  const extras=c.extras.filter(x=>enabled(x.activo)).map(x=>({id:x.idExtra,nombre:x.nombre,precio:Number(x.precio),aplica_a:x.aplicaA,referencia_id:x.referenciaId,max_cantidad:Number(x.maxCantidad||1)}));
  return {categorias,productos,variantes,extras};
}
