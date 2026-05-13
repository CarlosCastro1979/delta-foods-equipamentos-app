// Service Worker — limpa cache e auto-destrói
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
