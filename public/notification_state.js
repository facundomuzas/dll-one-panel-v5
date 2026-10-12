(function(root){
  const fields=['messages','orders','delivery','human','receipts'];
  function nextSignals(previous,incoming){
    let changed=false;const next={};
    for(const key of fields){
      let a=0n,b=0n;
      try{a=BigInt(previous?.[key]||0);b=BigInt(incoming?.[key]||0);}catch{}
      if(previous && b>a)changed=true;
      next[key]=String(a>b?a:b);
    }
    return {changed,next};
  }
  root.DllNotificationState={nextSignals};
})(typeof window==='undefined'?globalThis:window);
