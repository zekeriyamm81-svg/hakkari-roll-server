const CACHE="hakkari-roll-v5131-stable-20260828";
const CORE=["/","/static/manifest.json","/static/icons/icon.svg"];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(
    u.pathname.startsWith("/api/") ||
    u.pathname.startsWith("/uploads/") ||
    u.pathname==="/static/app.js" ||
    u.pathname==="/static/app.css" ||
    u.pathname==="/service-worker.js" ||
    u.pathname==="/static/service-worker.js"
  ){
    e.respondWith(fetch(e.request,{cache:"no-store"}));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r})
      .catch(()=>caches.match(e.request).then(r=>r||caches.match("/")))
  );
});

self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting()});

// V5.8: mobilde sayfa tarafından oluşturulan kalıcı bildirimlere tıklanınca uygulamayı öne getir.
self.addEventListener("notificationclick",event=>{
  const data=event.notification?.data||{};
  event.notification?.close();
  event.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){
      if("focus" in client){
        try{client.postMessage({type:"HR_NOTIFICATION_CLICK",kind:data.kind||"",call_id:data.call_id||0})}catch(e){}
        await client.focus();return;
      }
    }
    if(self.clients.openWindow)await self.clients.openWindow(data.url||"/");
  })());
});
