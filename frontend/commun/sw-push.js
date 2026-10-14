// Notifications push, commun aux 3 apps (chargé par sw.js avec importScripts).
// Même fonctionnement que Glow : titre, texte, logo, silhouette dans la barre d'état,
// et au toucher l'app s'ouvre (ou revient devant) sur la bonne page.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { corps: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.titre || 'TMS', {
    body: d.corps || '',
    icon: 'commun/notif-256.png',     // logo TMS en grand
    badge: 'commun/badge-96.png',     // silhouette du camion dans la barre d'état (Android)
    data: { url: d.url || './' },
    tag: d.etiquette || `tms-${Date.now()}`,
    renotify: true,
    vibrate: [120, 60, 120],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cible = new URL((event.notification.data && event.notification.data.url) || './', self.location.href).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
    const fenetre = liste.find(c => c.url.startsWith(self.registration.scope));
    if (fenetre) {
      return fenetre.focus().then(() => ('navigate' in fenetre ? fenetre.navigate(cible).catch(() => {}) : null));
    }
    return clients.openWindow(cible);
  }));
});
