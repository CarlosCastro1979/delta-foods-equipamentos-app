// Service Worker v2026-10-22-nfe-wa-android — rede sempre; limpa Cache Storage antigo
// Mantém-se registado (obrigatório para «Instalar aplicação» / PWA standalone).
const CACHE = 'v2026-10-22-nfe-wa-android';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Sem cache de páginas — vai sempre à rede (evita index.html antigo no GitHub Pages)
  e.respondWith(fetch(e.request));
});
