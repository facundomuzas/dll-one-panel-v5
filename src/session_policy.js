export function sessionSeconds(value=process.env.PANEL_SESSION_MINUTES){
 const minutes=Number(value||60);return (Number.isInteger(minutes)&&minutes>=15&&minutes<=720?minutes:60)*60;
}
export function sessionAllowed(session,now=Date.now()){
 return session?.policy===2&&Number.isFinite(session.iat)&&now/1000-session.iat<sessionSeconds();
}
