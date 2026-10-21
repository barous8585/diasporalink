// Service worker de l'app agent : l'app s'ouvre sans réseau.
// Les scans et remises sont gardés par l'app elle-même (file d'attente).
importScripts('commun/sw-push.js'); // notifications push
const CACHE = 'kolis-agent-v23';
const ASSETS = ['./', './index.html', './css/agent.css', './js/agent.js', './js/scanner.js', './commun/kolis.css', './commun/kolis.js', './commun/tarif.js', './commun/vendor/polices.css', './commun/vendor/polices/inter-latin-wght-normal.woff2', './commun/vendor/polices/fraunces-latin-opsz-normal.woff2', './commun/legal.js',
  './commun/vendor/jsqr.min.js', './commun/vendor/qrcode-generator.min.js', './manifest.json'];
const CDN = [];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    await Promise.all(CDN.map(u => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  // Bibliothèques du CDN : cache d'abord (elles ne changent pas)
  if (CDN.includes(e.request.url)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copie = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); return res; })));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => { if (res.ok && url.origin === location.origin) { const copie = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); } return res; })
      .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
