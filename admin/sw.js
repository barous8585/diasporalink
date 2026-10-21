// Service worker du back-office : seulement les notifications (pas de cache hors-ligne). (version 23)
importScripts('commun/sw-push.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
