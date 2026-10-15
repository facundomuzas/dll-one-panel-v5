// This response deliberately excludes credentials and the rest of the runtime.
export async function getBotInstructions(db,id){
 const row=(await db.query('SELECT bot_instructions,instructions_revision,runtime FROM panel_native_companies WHERE company_id=$1',[id])).rows[0];
 if(!row)return {native:false};
 return {native:true,revision:row.instructions_revision,instructions:row.bot_instructions??String(row.runtime?.context?.instruccionesIA||''),customized:row.bot_instructions!==null};
}
export async function saveBotInstructions(db,id,input){
 if(typeof input.instructions!=='string'||input.instructions.length>12000)throw Error('Las instrucciones deben ser texto de hasta 12.000 caracteres.');
 if(!Number.isInteger(input.revision)||input.revision<0)throw Error('Recargá las instrucciones antes de guardar.');
 const result=await db.query(`UPDATE panel_native_companies SET bot_instructions=$2,instructions_revision=instructions_revision+1 WHERE company_id=$1 AND instructions_revision=$3 RETURNING instructions_revision`,[id,input.instructions,input.revision]);
 if(!result.rows.length)throw Error('Las instrucciones cambiaron o la conexión todavía no está migrada. Recargá para revisar.');
 return {native:true,revision:result.rows[0].instructions_revision,instructions:input.instructions,customized:true};
}
