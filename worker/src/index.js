// A reminder before the adhan of the five prayers, for dorarnajdiah.com
// - keeps the devices that asked for it: the push address the browser gives and the place the reader chose for the prayer times
//   (its coordinates, time zone, method and the Asr choice; no name, no e-mail)
// - every three minutes: the readers for whom an adhan comes in about ten minutes, by the same calculation as the site
// Web Push: RFC 8291 (aes128gcm) and RFC 8292 (VAPID), with WebCrypto only.

const SITE = 'https://dorarnajdiah.com';
const enc = new TextEncoder();
const b64u = {
  enc: (b) => { b = new Uint8Array(b); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); },
};
const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });

// the push services browsers use; anything else is refused
const OK_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

async function vapid(env) {
  let v = await env.PUSH.get('vapid', 'json');
  if (!v) {   // made once, on first use, and kept in the store
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u.enc(await crypto.subtle.exportKey('raw', k.publicKey)), jwk: await crypto.subtle.exportKey('jwk', k.privateKey) };
    await env.PUSH.put('vapid', JSON.stringify(v));
  }
  return v;
}

async function vapidHeader(env, endpoint) {
  const v = await vapid(env);
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${v.pub}`;
}

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

async function encrypt(sub, payload) {
  const ua = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function send(env, sub, msg, ttl = 86400, urgency = 'normal') {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'TTL': String(ttl), 'Urgency': urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Authorization': await vapidHeader(env, sub.endpoint) },
    body: await encrypt(sub, JSON.stringify(msg)),
  });
  return r.status;
}

const idOf = async (endpoint) => 's:' + b64u.enc(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))).slice(0, 32);


// ---- prayer times: the same calculation as the site (index.html, prTimes) ----
const PRM = { uq: [18.5, '90'], mwl: [18, 17], egy: [19.5, 17.5], isna: [15, 15], kar: [18, 18] };
const NAMES = ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'];
function prTimes(y, m, d, lat, lng, mk, hanafi, ramadan) {
  const R = Math.PI / 180, sin = (x) => Math.sin(x * R), cos = (x) => Math.cos(x * R), tan = (x) => Math.tan(x * R),
    asin = (x) => Math.asin(x) / R, acos = (x) => Math.acos(x) / R, atan2 = (a, b) => Math.atan2(a, b) / R, acot = (x) => Math.atan(1 / x) / R,
    fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
  if (m <= 2) { y -= 1; m += 12; } const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  const jd0 = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  const sun = (t) => { const D = jd0 + t - 2451545, g = fix(357.529 + 0.98560028 * D, 360), q = fix(280.459 + 0.98564736 * D, 360),
    L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360), e = 23.439 - 0.00000036 * D, RA = fix(atan2(cos(e) * sin(L), cos(L)) / 15, 24);
    return { dec: asin(sin(e) * sin(L)), eqt: q / 15 - RA }; };
  const noon = (h) => { const s = sun(h / 24 - lng / 360); return fix(12 - s.eqt, 24); };
  const ang = (a, h, ccw) => { const s = sun(h / 24 - lng / 360), n = noon(h), c = (-sin(a) - sin(s.dec) * sin(lat)) / (cos(s.dec) * cos(lat));
    if (c < -1 || c > 1) return NaN; const T = acos(c) / 15; return n + (ccw ? -T : T); };
  const asr = (h) => { const s = sun(h / 24 - lng / 360); return ang(-acot((hanafi ? 2 : 1) + tan(Math.abs(lat - s.dec))), h, false); };
  const M = PRM[mk] || PRM.uq; let t = [5, 6, 12, 13, 18, 18, 18];
  for (let k = 0; k < 2; k++) t = [ang(M[0], t[0], true), ang(0.833, t[1], true), noon(t[2]), asr(t[3]), ang(0.833, t[4], false),
    typeof M[1] === 'string' ? NaN : ang(M[1], t[5], false)];
  t[2] += 1 / 60;
  if (typeof M[1] === 'string') t[5] = t[4] + (ramadan ? 120 : +M[1]) / 60;
  return t.map((h) => h - lng / 15);
}
const okTz = (tz) => { try { return typeof tz === 'string' && tz.length < 64 && !!new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { return false; } };
function ymd(tz, t) { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t))) p[x.type] = x.value; return [+p.year, +p.month, +p.day]; }
function ramadan(tz, t) { try { return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: tz, month: 'numeric' }).format(new Date(t)) === '9'; } catch (e) { return false; } }
// the five adhans of the reader's day and the next day, in milliseconds
function adhans(p, now) {
  const out = [];
  for (const off of [0, 1]) {
    const [y, m, d] = ymd(p.tz, now + off * 864e5);
    const h = prTimes(y, m, d, p.la, p.lo, p.mk, p.h === 1, ramadan(p.tz, now + off * 864e5)), base = Date.UTC(y, m - 1, d);
    h.forEach((x, i) => { if (i !== 1 && !isNaN(x)) out.push([i, base + x * 36e5]); });
  }
  return out;
}
const AR = (n) => String(n).replace(/[0-9]/g, (c) => '٠١٢٣٤٥٦٧٨٩'[c]);
const LEAD = [7 * 6e4, 10 * 6e4];   // sent when the adhan is 7 to 10 minutes away (the check runs every three minutes)
function placeOf(m) {
  if (!m) return null;
  const p = { la: +m.la, lo: +m.lo, tz: m.tz, mk: PRM[m.mk] ? m.mk : 'uq', h: m.h === 1 ? 1 : 0, nm: typeof m.nm === 'string' ? m.nm.slice(0, 40) : '' };
  return (isFinite(p.la) && isFinite(p.lo) && Math.abs(p.la) <= 90 && Math.abs(p.lo) <= 180 && okTz(p.tz)) ? p : null;
}
function message(i, at, nm) {
  const mins = Math.max(1, Math.round((at - Date.now()) / 6e4));
  return { t: 'اقترب أذان ' + NAMES[i], b: 'بقي نحو ' + AR(mins) + (mins >= 3 && mins <= 10 ? ' دقائق' : ' دقيقة') + ' على أذان ' + NAMES[i] + (nm ? ' في ' + nm : '') + '.', u: SITE + '/', tag: 'pr' };
}

function valid(sub) {
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === 'https:' && OK_HOSTS.some((r) => r.test(u.hostname)) && sub.keys && sub.keys.p256dh && sub.keys.auth && JSON.stringify(sub).length < 2000;
  } catch (e) { return false; }
}
async function inner(env) {
  let k = await env.PUSH.get('inner');
  if (!k) { k = b64u.enc(crypto.getRandomValues(new Uint8Array(24))); await env.PUSH.put('inner', k); }
  return k;
}
// every reader whose adhan is near: [id, prayer, time]; one calculation per place
async function due(env, now) {
  const out = [], memo = new Map();
  let cursor;
  do {
    const l = await env.PUSH.list({ prefix: 's:', cursor });
    for (const k of l.keys) {
      const p = placeOf(k.metadata); if (!p) continue;
      const g = [p.la.toFixed(2), p.lo.toFixed(2), p.tz, p.mk, p.h].join('|');
      if (!memo.has(g)) memo.set(g, adhans(p, now).filter(([, t]) => t - now > LEAD[0] && t - now <= LEAD[1]));
      for (const [i, t] of memo.get(g)) out.push([k.name, i, t]);
    }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return out;
}
async function fanOut(env, jobs) {
  const r = { tried: 0, sent: 0, removed: 0 };
  if (!jobs.length) return r;
  const key = await inner(env);
  const parts = [];
  for (let i = 0; i < jobs.length; i += 6) parts.push(jobs.slice(i, i + 6));
  for (let i = 0; i < parts.length; i += 10) {
    const res = await Promise.all(parts.slice(i, i + 10).map((p) =>
      (env.SELF ? env.SELF.fetch('https://self/inner/send', { method: 'POST', headers: { 'X-Inner': key, 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((x) => x.json())
                : sendJobs(env, p)).catch(() => ({ tried: p.length, sent: 0, removed: 0 }))));
    for (const x of res) { r.tried += x.tried || 0; r.sent += x.sent || 0; r.removed += x.removed || 0; }
  }
  return r;
}
async function sendJobs(env, jobs) {
  const r = { tried: 0, sent: 0, removed: 0 };
  for (const [id, i, t] of jobs) {
    const v = await env.PUSH.getWithMetadata(id, 'json');
    if (!v || !v.value) continue;
    const p = placeOf(v.metadata) || {};
    const msg = i === -1 ? { t: 'تجربة التنبيه', b: 'هكذا يصلك التنبيه قبل الأذان.', u: SITE + '/', tag: 'pr' } : message(i, t, p.nm);
    const st = await send(env, v.value, msg, 900, 'high').catch(() => 0);
    r.tried++;
    if (st >= 200 && st < 300) r.sent++;
    if (st === 404 || st === 410) { await env.PUSH.delete(id); r.removed++; }
  }
  return r;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (u.pathname === '/key') return json({ key: (await vapid(env)).pub });
    if (u.pathname === '/health') return json({ ok: true });
    if (req.method === 'POST' && u.pathname === '/inner/send') {
      if (req.headers.get('X-Inner') !== await inner(env)) return json({ ok: false }, 403);
      return json(await sendJobs(env, await req.json()));
    }
    // a test send to everyone subscribed, now: only with the key the deploy step keeps in the store
    if (req.method === 'POST' && u.pathname === '/admin/send') {
      const k = await env.PUSH.get('admin');
      if (!k || req.headers.get('X-Admin') !== k) return json({ ok: false }, 403);
      const ids = []; let cursor;
      do { const l = await env.PUSH.list({ prefix: 's:', cursor }); for (const x of l.keys) ids.push([x.name, -1, 0]); cursor = l.list_complete ? null : l.cursor; } while (cursor);
      return json({ ok: true, ...(await fanOut(env, ids)) });
    }
    if (req.method === 'POST' && (u.pathname === '/sub' || u.pathname === '/unsub')) {
      let body; try { body = await req.json(); } catch (e) { return json({ ok: false }, 400); }
      const sub = body && body.sub;
      if (!sub || !sub.endpoint) return json({ ok: false }, 400);
      const id = await idOf(sub.endpoint);
      if (u.pathname === '/unsub') { await env.PUSH.delete(id); return json({ ok: true }); }
      const p = placeOf(body.place);
      if (!valid(sub) || !p) return json({ ok: false }, 400);
      const known = await env.PUSH.get(id);
      await env.PUSH.put(id, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), { metadata: p });
      if (known) return json({ ok: true });   // the same reader, a new place or method: no second welcome
      const st = await send(env, sub, { t: 'الدرر السنية', b: 'سيصلك تنبيه قبل أذان كل صلاة من الصلوات الخمس بنحو عشر دقائق.', u: SITE + '/', tag: 'pr' }).catch(() => 0);
      return json({ ok: true, sent: st });
    }
    return json({ ok: false }, 404);
  },
  async scheduled(ev, env, ctx) {
    const r = await fanOut(env, await due(env, Date.now()));
    if (r.tried) console.log('tried', r.tried, 'sent', r.sent, 'removed', r.removed);
  },
};
