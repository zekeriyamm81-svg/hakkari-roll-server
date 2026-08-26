const CACHE="hakkari-roll-pwa-v7-event-final";
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
      .then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      })
      .catch(()=>caches.match(e.request).then(r=>r||caches.match("/")))
  );
});

self.addEventListener("message",e=>{
  if(e.data==="SKIP_WAITING")self.skipWaiting();
});
