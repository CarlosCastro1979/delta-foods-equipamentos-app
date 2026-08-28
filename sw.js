// Service Worker v2026-08-28-cp-pend — limpa cache e auto-destrói
// (a app não deve servir index.html antigo após merge no GitHub Pages)
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.registration.unregister())
  );
});

self.addEventListener('fetch', e => {
  // Sem cache — vai sempre à rede
  e.respondWith(fetch(e.request));
});
