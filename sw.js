const V='durar-shell-v2';
const SHELL=['./','index.html','manifest.json','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('durar-shell-')&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.pathname.includes('/book/')||u.pathname.includes('/download/')||u.hostname==='archive.org'||u.hostname.endsWith('.archive.org'))return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(x=>{
    if(x.ok&&(u.origin===location.origin||u.hostname==='cdnjs.cloudflare.com')){const y=x.clone();caches.open(V).then(c=>c.put(e.request,y))}
    return x}).catch(()=>caches.match('index.html'))));
});
