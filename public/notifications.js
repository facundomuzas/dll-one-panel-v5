let noticeTimer=null,noticeBusy=false,noticeGeneration=0,noticeData=null;
const noticeLocalSignals=new Map();
let noticeAudio=null,noticeSound=false,displayedThread=null,readBusy=false;
function noticeUserKey(){return String(currentUser?.userId||currentUser?.user||'');}
function noticeStorage(key,value){try{if(value!==undefined)localStorage.setItem(key,JSON.stringify(value));else return JSON.parse(localStorage.getItem(key)||'null');}catch{}return null;}
function setNoticeBadge(tab,count,title){
  document.querySelectorAll('[data-notice="'+tab+'"]').forEach(el=>{
    el.textContent=count>99?'99+':String(count);el.hidden=!count;
    el.title=title;el.setAttribute('aria-label',count+' '+title);
  });
}
function paintNotices(data){
  noticeData=data;const c=data?.counts||{};
  for(const [id,value] of [['mOrders',c.orders],['mQuotes',c.delivery],['mHuman',c.human],['mPayments',c.payments]]){const el=document.getElementById(id);if(el)el.textContent=Number(value||0);}
  setNoticeBadge('conversations',c.conversations||0,'conversaciones sin revisar o en atención humana');
  setNoticeBadge('orders',c.orders||0,'pedidos con preparación, entrega o pago pendientes');
  setNoticeBadge('receipts',c.receipts||0,'archivos de pago por revisar');
  setNoticeBadge('more',c.receipts||0,'comprobantes por revisar');
  setNoticeBadge('delivery',c.delivery||0,'delivery por cotizar');
  setNoticeBadge('dashboard',(c.conversations||0)+(c.orders||0)+(c.delivery||0)+(c.receipts||0),'pendientes');
  const entries=[['Conversaciones sin revisar',c.unread,'conversations'],['Atención humana',c.human,'conversations'],['Pedidos por completar o cobrar',c.orders,'orders'],['Delivery por cotizar',c.delivery,'delivery'],['Comprobantes por revisar',c.receipts,'receipts'],['Pagos pendientes',c.payments,'orders']];
  const box=document.getElementById('pendingTasks');
  if(box)box.innerHTML=entries.map(([label,count,tab])=>'<button class="task-link" onclick="go(\''+tab+'\')"><span>'+label+'</span><strong>'+Number(count||0)+'</strong></button>').join('');
  document.querySelectorAll('[data-chat-notice]').forEach(el=>{
    const chat=data?.chats?.find(x=>x.clientId===el.dataset.chatNotice);
    const count=Number(chat?.unread||0);el.hidden=!count;el.textContent=count>99?'99+':String(count);el.title=count+' mensajes sin revisar';
  });
}
function resetNotices(){noticeData=null;displayedThread=null;paintNotices({counts:{},chats:[]});}
function stopNotifications(){clearInterval(noticeTimer);noticeTimer=null;noticeGeneration++;resetNotices();noticeSound=false;document.getElementById("noticeSoundButton").textContent="🔇 Activar sonido";document.getElementById("noticeSoundButton").setAttribute("aria-pressed","false");if(noticeAudio)noticeAudio.suspend().catch(()=>{});}
function startNotifications(){
  clearInterval(noticeTimer);noticeGeneration++;resetNotices();
  document.getElementById('noticeStatus').textContent='Conectando avisos…';
  pollNotifications();noticeTimer=setInterval(pollNotifications,5000);
}
async function pollNotifications(){
  if(noticeBusy||!companyId||document.getElementById('app').classList.contains('hidden'))return;
  noticeBusy=true;const company=companyId,generation=noticeGeneration;
  try{
    const data=await api('/api/company/'+encodeURIComponent(company)+'/notifications');
    if(generation!==noticeGeneration||company!==companyId)return;
    paintNotices(data);
    const status=document.getElementById('noticeStatus');status.textContent='Avisos activos · '+new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});status.classList.remove('notice-offline');
    const key='dll-notice-signals:'+noticeUserKey()+':'+company;
    const consume=()=>{
      if(generation!==noticeGeneration||company!==companyId)return;
      const shared=noticeStorage(key);
      const local=DllNotificationState.nextSignals(noticeLocalSignals.get(key)||null,data.signals);
      noticeLocalSignals.set(key,local.next);
      if(!shared)noticeStorage(key,local.next);
      if(noticeSound){
        const r=DllNotificationState.nextSignals(shared||local.next,data.signals);
        noticeStorage(key,r.next);
        if(r.changed)playNotice();
      }
    };
    if(navigator.locks)await navigator.locks.request(key,{ifAvailable:true},lock=>{if(lock)consume();});else consume();
  }catch(err){
    if(generation===noticeGeneration){const s=document.getElementById('noticeStatus');s.textContent='Avisos sin conexión · reintentando';s.classList.add('notice-offline');}
  }finally{noticeBusy=false;}
}
function playNotice(){
  if(!noticeAudio||noticeAudio.state!=='running'){noticeSound=false;document.getElementById('noticeSoundButton').textContent='🔇 Reactivar sonido';document.getElementById('noticeSoundButton').setAttribute('aria-pressed','false');return;}
  const now=noticeAudio.currentTime;
  for(const [delay,hz] of [[0,880],[0.18,1100]]){
    const oscillator=noticeAudio.createOscillator(),gain=noticeAudio.createGain();
    oscillator.type='sine';oscillator.frequency.value=hz;
    gain.gain.setValueAtTime(0,now+delay);gain.gain.linearRampToValueAtTime(0.08,now+delay+0.02);gain.gain.exponentialRampToValueAtTime(0.001,now+delay+0.16);
    oscillator.connect(gain);gain.connect(noticeAudio.destination);oscillator.start(now+delay);oscillator.stop(now+delay+0.18);
  }
}
async function toggleNoticeSound(){
  const button=document.getElementById('noticeSoundButton');
  try{
    if(noticeSound){noticeSound=false;button.textContent='🔇 Activar sonido';button.setAttribute('aria-pressed','false');return;}
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Este navegador no admite sonido de avisos.');
    noticeAudio=noticeAudio||new Audio();await noticeAudio.resume();
    noticeSound=noticeAudio.state==='running';
    button.textContent=noticeSound?'🔔 Sonido activado':'🔇 Activar sonido';button.setAttribute('aria-pressed',String(noticeSound));
    if(noticeSound){
      if(noticeData?.signals)noticeStorage('dll-notice-signals:'+noticeUserKey()+':'+companyId,noticeData.signals);
      playNotice();
    }
  }catch(err){document.getElementById('noticeStatus').textContent=err.message;}
}
function threadIsVisible(){return !document.hidden && currentTab==='conversations' &&
  (window.innerWidth>760 || document.getElementById('chatPane').classList.contains('mobile-open'));}
async function acknowledgeDisplayedThread(){
  if(readBusy||!displayedThread||!threadIsVisible())return;
  const box=document.getElementById('chatMessages');if(box.scrollHeight-box.scrollTop-box.clientHeight>60)return;
  const shown=displayedThread;if(shown.company!==companyId||shown.client!==selectedChat?.idCliente||shown.id==='0')return;
  readBusy=true;
  try{
    await api('/api/company/'+encodeURIComponent(shown.company)+'/conversation/'+encodeURIComponent(shown.client)+'/read',{method:'POST',body:JSON.stringify({lastMessageId:shown.id})});
    if(displayedThread===shown)displayedThread=null;
    pollNotifications();
  }catch{}finally{readBusy=false;}
}
document.getElementById('chatMessages').addEventListener('scroll',()=>acknowledgeDisplayedThread());
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){pollNotifications();if(currentTab==='conversations')refreshSelectedThread(true);}
});
