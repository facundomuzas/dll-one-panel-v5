import QRCode from 'qrcode';
import {publicBase} from './payment_settings.js';
export const ticketScanUrl=(company,code)=>publicBase()+'/#'+new URLSearchParams({ticket:code,company}).toString();
export async function ticketRecord(db,company,code){
 const r=(await db.query('SELECT a.*,e.name AS event_name,e.status AS event_status,e.starts_at,e.location FROM panel_event_attendees a JOIN panel_events e ON e.company_id=a.company_id AND e.id=a.event_id WHERE a.company_id=$1 AND a.code=$2',[company,code])).rows[0];if(!r)throw Error('Entrada no encontrada.');return r;
}
export const ticketValid=a=>a.state!=='CANCELLED'&&a.event_status!=='CANCELLED'&&['FREE','APPROVED'].includes(a.payment_state);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function ticketPage(db,company,code){
 const a=await ticketRecord(db,company,code);
 if(!ticketValid(a))return '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrada</title><h1>Entrada no habilitada</h1><p>El pago sigue pendiente o la entrada fue cancelada/revertida. Consultá al organizador.</p></html>';
 const image=await QRCode.toDataURL(ticketScanUrl(company,code),{width:400,margin:4,errorCorrectionLevel:'M'});
 return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>Entrada ONE Eventos</title><style>body{font:18px Arial;text-align:center;max-width:640px;margin:40px auto;padding:12px}img{width:100%;max-width:400px}</style><h1>${esc(a.event_name)}</h1><p>${esc(new Date(a.starts_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}))} · ${esc(a.location)}</p><img alt="QR de entrada" src="${image}"><p>Mostrá este QR en el ingreso. Podés guardar esta página como PDF desde Imprimir.</p><p>El personal verifica el nombre y DNI en su lista interna. El código permite un solo ingreso.</p></html>`;
}
