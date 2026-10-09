const CACHE="dll-one-panel-v502";
const SHELL=["/","/logo.png","/manifest.webmanifest"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(self.clients.claim());});
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||u.pathname.startsWith("/api/")||u.pathname.startsWith("/sync/")){return;}e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)));});
