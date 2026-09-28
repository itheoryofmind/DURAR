// Streams the whole book as one PDF, piece by piece, without holding it in memory.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.endsWith('/download/full.pdf')) e.respondWith(streamBook());
});

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getPart(p) {
  const url = new URL(p.u, self.location).href;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== p.s) throw new Error('size');
      if (crypto.subtle && (await sha256(buf)) !== p.h) throw new Error('hash');
      return new Uint8Array(buf);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function streamBook() {
  const m = await (await fetch(new URL('../book/manifest.json', self.location).href, { cache: 'no-store' })).json();
  let i = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (i >= m.parts.length) { controller.close(); return; }
      try { controller.enqueue(await getPart(m.parts[i++])); }
      catch (err) { controller.error(err); }
    }
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(m.total),
      'Content-Disposition': "attachment; filename=\"durar-kamil.pdf\"; filename*=UTF-8''" + encodeURIComponent(m.filename)
    }
  });
}
