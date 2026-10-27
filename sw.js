// Service Worker v2026-10-27-contratos-dist — Dist Contratos só Massimo/Eduardo
// Mantém-se registado (obrigatório para «Instalar aplicação» / PWA standalone).
const CACHE = 'v2026-10-27-contratos-dist';

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
  const req = e.request;
  const url = new URL(req.url);
  const isNav = req.mode === 'navigate' || req.destination === 'document';
  const isShell = /\/(index\.html)?$/.test(url.pathname) || url.pathname.endsWith('/delta-foods-equipamentos-app/');
  // index.html / navegação: network-first (nunca servir shell antigo do Cache Storage)
  if (isNav || isShell) {
    e.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() =>
        caches.match(req).then(c => c || fetch(req))
      )
    );
    return;
  }
  // Restante: rede sempre (sem pin de assets antigos)
  e.respondWith(fetch(req));
});
