// Offline shell for the site. Book volumes are cached by the page itself when the reader saves them.
const V='durar-shell-v5';
const SHELL=['./','index.html','manifest.json','icon-192.png','icon-512.png',
  'lib/pdf.js','lib/pdf.worker.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('durar-shell-')&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(u.origin===location.origin&&/\/(vols|book|download|data)\//.test(u.pathname))return;
  const cacheable=u.origin===location.origin||['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname);
  if(!cacheable)return;
  const isPage=e.request.mode==='navigate';
  // pages: network first so updates arrive; assets: cache first
  if(isPage){
    e.respondWith(fetch(e.request.url,{cache:'no-store'}).then(x=>{const y=x.clone();if(x.ok)caches.open(V).then(c=>c.put('index.html',y));return x}).catch(()=>caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(x=>{
    if(x.ok||x.type==='opaque'){const y=x.clone();caches.open(V).then(c=>c.put(e.request,y))}
    return x})));
});

/* the reminder before the adhan; a tap opens the site */
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(_){d={b:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.t||'الدرر السنية',{body:d.b||'',icon:'icon-192.png',badge:'favicon-96.png',tag:d.tag||'pr',lang:'ar',dir:'rtl',data:{u:d.u||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.u)||'./';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>{for(const c of L){if('focus' in c)return c.focus()}return clients.openWindow(u)}))});
