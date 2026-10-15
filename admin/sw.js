// Service worker du back-office : seulement les notifications (pas de cache hors-ligne). (version 19)
importScripts('commun/sw-push.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
