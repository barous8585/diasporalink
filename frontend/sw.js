// Service worker : l'app s'ouvre même sans réseau.
// Les réponses de l'API ne sont pas mises en cache ici : l'app garde elle-même
// les dernières infos de suivi (avec leur heure) pour les montrer hors-ligne.
importScripts('commun/sw-push.js'); // notifications push
const CACHE = 'kolis-client-v16';
const ASSETS = ['./', './index.html', './css/app.css', './js/app.js', './commun/kolis.css', './commun/kolis.js', './commun/tarif.js', './commun/vendor/polices.css', './commun/vendor/polices/inter-latin-wght-normal.woff2', './commun/vendor/polices/fraunces-latin-opsz-normal.woff2', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  // Réseau d'abord (pour avoir les mises à jour), cache si pas de réseau
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && (url.origin === location.origin || url.host.includes('fonts.g'))) {
          const copie = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copie));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
