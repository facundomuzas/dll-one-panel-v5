import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';

// This runs the production route handlers with fake companies, state and Meta
// adapter: test traffic never leaves 127.0.0.1 and cannot contact WhatsApp.
const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
const start=server.indexOf('app.post(\n  "/api/company/:companyId/conversation/:clientId/take"');
const end=server.indexOf("app.get('/api/company/:companyId/order-hours'",start);
assert.ok(start>=0&&end>start,'production human control handlers must be present');
const routeSource=server.slice(start,end);

const states=new Map();
const motors=new Map();
const notifications=[];
let motorUnreachable=false,dbUnreachable=false,nowInbound=new Date(Date.now()-30_000).toISOString();
const id=(company,client)=>company+':'+client;
const getCompany=async company=>company==='A'?{company_id:'A',phone_number_id:'111'}:
 company==='B'?{company_id:'B',phone_number_id:'222'}:null;
const getConversationState=async(company,client)=>states.get(id(company,client))||null;
const setConversationMode=async(company,client,mode,operator)=>{
 if(dbUnreachable)throw Error('test-db-down');
 const old=await getConversationState(company,client);
 states.set(id(company,client),{
  ...(old||{last_inbound_at:nowInbound}),
  company_id:company,client_id:client,mode,assigned_to:operator
 });
};
const postMotor=async(path,payload)=>{
 notifications.push({path,payload});
 if(motorUnreachable)throw Error('test-motor-unavailable');
 const key=id(payload.companyId,payload.clientId);
 if(path==='/admin/panel/conversation-mode'){
  assert.equal(payload.phoneNumberId,payload.companyId==='A'?'111':'222');
  motors.set(key,payload.mode);
  return {ok:true,mode:payload.mode};
 }
 if(path==='/admin/panel/send'){
  if(motors.get(key)!=='HUMANO')throw Error('bot still owns conversation');
  return {ok:true,wamid:'local_fake_wamid_'+notifications.length};
 }
 throw Error('unexpected motor route');
};
const recentHumanSends=new Map();
const HUMAN_SEND_DEDUPE_MS=10_000;
const cleanupRecentHumanSends=()=>recentHumanSends.clear();
const dateMs=value=>value?Date.parse(value):0;
const normalizeState=s=>String(s||'').toUpperCase();
const app=express();
app.use(express.json());
app.use('/api/company/:companyId',(req,res,next)=>{
 const role=String(req.headers['x-role']||'');
 if(!role)return res.status(401).json({ok:false});
 const uid=Number(req.headers['x-uid']||7);
 req.session={role,uid,sub:'qa-operator'};
 if(req.params.companyId!=='A'||uid!==7)return res.status(403).json({ok:false});
 next();
});
const authRequired=(_req,_res,next)=>next();
const canOperate=(req,res,next)=>req.session?.role==='SUPERADMIN'||(req.session?.role==='OPERADOR'&&req.session?.uid===7)?
 next():res.status(403).json({ok:false});
new Function('app','authRequired','canOperate','getCompany','getConversationState',
 'setConversationMode','postMotor','recentHumanSends','HUMAN_SEND_DEDUPE_MS',
 'cleanupRecentHumanSends','dateMs','normalizeState',routeSource)(
 app,authRequired,canOperate,getCompany,getConversationState,
 setConversationMode,postMotor,recentHumanSends,HUMAN_SEND_DEDUPE_MS,
 cleanupRecentHumanSends,dateMs,normalizeState
);
const http=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
const base='http://127.0.0.1:'+http.address().port;
after(()=>new Promise(resolve=>http.close(resolve)));
const url=(client='WA_123',action='take',company='A')=>base+
 '/api/company/'+company+'/conversation/'+client+'/'+action;
const request=(action,opts={})=>{
 const {role='OPERADOR',uid=7,client='WA_123',company='A',message='Hola desde QA'}=opts;
 return fetch(url(client,action,company),{
  method:'POST',headers:{'Content-Type':'application/json',...(role?{'x-role':role}:{}),'x-uid':String(uid)},
  body:JSON.stringify({message})
 });
};
const reset=()=>{
 states.clear();motors.clear();notifications.length=0;recentHumanSends.clear();
 motorUnreachable=false;dbUnreachable=false;
 nowInbound=new Date(Date.now()-30_000).toISOString();
 states.set(id('A','WA_123'),{mode:'BOT',last_inbound_at:nowInbound});
 motors.set(id('A','WA_123'),'BOT');
};

test('manual takeover acknowledged by motor before panel exposes HUMANO; operator sends and returns to BOT',async()=>{
 reset();
 const take=await request('take');
 assert.equal(take.status,200,await take.text());
 assert.equal((await getConversationState('A','WA_123')).mode,'HUMANO');
 assert.equal(motors.get(id('A','WA_123')),'HUMANO');
 assert.equal(notifications[0].path,'/admin/panel/conversation-mode');
 const send=await request('send',{message:'Buenas, atendemos tu consulta'});
 const sentPayload=await send.json();
 assert.equal(send.status,200,JSON.stringify(sentPayload));
 assert.equal(sentPayload.wamid,'local_fake_wamid_2');
 assert.equal(notifications[1].path,'/admin/panel/send');
 const done=await request('return-bot');
 assert.equal(done.status,200,await done.text());
 assert.equal((await getConversationState('A','WA_123')).mode,'BOT');
 assert.equal(motors.get(id('A','WA_123')),'BOT');
 const denied=await request('send',{message:'Nueva respuesta humana'});
 assert.equal(denied.status,409);
 assert.equal(notifications.filter(x=>x.path==='/admin/panel/send').length,1);
});
test('cannot send manually if no conversation state exists or the bot owns it',async()=>{
 reset();
 states.delete(id('A','WA_123'));
 const withoutState=await request('send');
 assert.equal(withoutState.status,409);
 assert.equal(notifications.length,0);
 states.set(id('A','WA_123'),{mode:'BOT',last_inbound_at:nowInbound});
 const botMode=await request('send',{message:'En modo bot'});
 assert.equal(botMode.status,409);
 assert.equal(notifications.length,0);
});
test('the 24-hour WhatsApp customer support window is enforced on the server',async()=>{
 reset();states.set(id('A','WA_123'),{
  mode:'HUMANO',last_inbound_at:new Date(Date.now()-25*3600_000).toISOString()
 });
 motors.set(id('A','WA_123'),'HUMANO');
 const expired=await request('send');
 const errorPayload=await expired.json();
 assert.equal(expired.status,409,JSON.stringify(errorPayload));
 assert.match(errorPayload.error,/24 horas/);
 assert.equal(notifications.length,0);
 states.set(id('A','WA_123'),{mode:'HUMANO',last_inbound_at:null});
 const missing=await request('send',{message:'Sin último mensaje'});
 assert.equal(missing.status,409);
 assert.equal(notifications.length,0);
});
test('motor outage cannot create a false takeover and cannot silently return to bot',async()=>{
 reset();motorUnreachable=true;
 const take=await request('take');
 assert.ok(take.status>=500);
 assert.equal((await getConversationState('A','WA_123')).mode,'BOT');
 motorUnreachable=false;
 assert.equal((await request('take')).status,200);
 motorUnreachable=true;
 const back=await request('return-bot');
 assert.ok(back.status>=500);
 assert.equal((await getConversationState('A','WA_123')).mode,'HUMANO');
 assert.equal(motors.get(id('A','WA_123')),'HUMANO');
});
test('panel persistence error must not claim successful mode switch',async()=>{
 reset();dbUnreachable=true;
 const result=await request('take');
 assert.ok(result.status>=500);
 assert.equal((await getConversationState('A','WA_123')).mode,'BOT');
 assert.equal(motors.get(id('A','WA_123')),'HUMANO','motor may have switched, but UI must show error');
});
test('unauthenticated, customer without operate and foreign-company calls never reach motor',async()=>{
 reset();
 for(const opts of [{role:''},{role:'ADMIN_EMPRESA'},{role:'OPERADOR',uid:8},{role:'SUPERADMIN',company:'B',uid:7}]){
  const response=await request('take',opts);
  assert.ok([401,403].includes(response.status));
 }
 assert.equal(notifications.length,0);
});
test('chat UI shows bot ownership, human ownership, 24h limits and sanitizes message HTML',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try{
  const d=dom.window.document;
  const context=vm.createContext({
   selectedChat:{idCliente:'WA_123'},companyId:'A',
   displayedThread:null,
   $:x=>d.getElementById(x),
   esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
   receiptFileLink:()=>'',requestAnimationFrame:()=>{},
   acknowledgeDisplayedThread:()=>{}
  });
  const start=html.indexOf('  function renderThread(');
  const end=html.indexOf('\n  }',start)+4;
  assert.ok(start>0&&end>start);
  vm.runInContext(html.slice(start,end),context);
  const message={tipo:'CLIENTE',fecha:'22/11/2026',mensaje:'<img src=x onerror=alert(1)>'};
  context.renderThread({chat:{idCliente:'WA_123',modo:'BOT',ventana24hAbierta:true},messages:[message]});
  assert.equal(d.getElementById('chatComposer').disabled,true);
  assert.equal(d.querySelectorAll('#chatMessages img').length,0);
  assert.match(d.getElementById('chatMessages').textContent,/<img src=x/);
  context.renderThread({chat:{modo:'HUMANO',ventana24hAbierta:true},messages:[message]});
  assert.equal(d.getElementById('chatComposer').disabled,false);
  assert.equal(d.getElementById('sendChatBtn').disabled,false);
  context.renderThread({chat:{modo:'HUMANO',ventana24hAbierta:false},messages:[message]});
  assert.equal(d.getElementById('chatComposer').disabled,true);
  assert.match(d.getElementById('composerNote').textContent,/24 horas/);
 }finally{dom.window.close();}
});
