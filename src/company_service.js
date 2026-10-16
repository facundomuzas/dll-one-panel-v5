export async function listCompanyServices(db){return (await db.query('SELECT company_id,company_name,phone_number_id,service_state,service_revision FROM panel_companies ORDER BY company_name')).rows;}
export async function changeCompanyService(db,id,input,actor){
 if(!['ACTIVE','PAUSED','SUSPENDED','ARCHIVED'].includes(input.state))throw Error('Estado inválido.');
 if(!Number.isInteger(input.revision)||input.revision<0)throw Error('Recargá la lista de empresas.');
 const cx=await db.connect();try{
  await cx.query('BEGIN');
  const old=(await cx.query('SELECT company_name,service_state,service_revision FROM panel_companies WHERE company_id=$1 FOR UPDATE',[id])).rows[0];
  if(!old)throw Error('Empresa no encontrada.');
  if(old.service_revision!==input.revision)throw Error('El estado cambió. Recargá la lista.');
  if(input.state==='ARCHIVED'&&input.confirmName!==old.company_name)throw Error('Confirmá el nombre de la empresa que vas a dar de baja.');
  if(old.service_state!==input.state){
   await cx.query('UPDATE panel_companies SET service_state=$2,service_revision=service_revision+1 WHERE company_id=$1',[id,input.state]);
   await cx.query('INSERT INTO panel_service_log(company_id,previous_state,next_state,actor) VALUES($1,$2,$3,$4)',[id,old.service_state,input.state,String(actor||'').slice(0,200)]);
  }
  const row=(await cx.query('SELECT company_id,company_name,phone_number_id,service_state,service_revision FROM panel_companies WHERE company_id=$1',[id])).rows[0];
  await cx.query('COMMIT');return row;
 }catch(e){await cx.query('ROLLBACK');throw e;}finally{cx.release();}
}
