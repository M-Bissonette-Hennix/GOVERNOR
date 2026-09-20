const VERSION='governor-v0.1.1';
const CORE=[
  './','./index.html','./styles.css','./manifest.webmanifest','./js/app.js','./js/db.js','./js/model.js','./js/controller.js',
  './icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'
];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(VERSION).then(c=>c.put('./index.html',copy));return r}).catch(()=>caches.match('./index.html')));return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(event.request,copy))}return r})));
});
