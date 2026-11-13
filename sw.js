// Service Worker v2026-11-13-outlook-sw-localhost — SW não bloqueia API Outlook localhost
// Mantém-se registado (obrigatório para «Instalar aplicação» / PWA standalone).
const CACHE = 'v2026-11-13-outlook-sw-localhost';

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

  // Nunca interceptar localhost / 127.0.0.1 / API Outlook.
  // Se o SW fizer fetch() a redes privadas a partir de github.io, o Chrome
  // falha com net::ERR_FAILED (Private Network Access) e o Outlook não abre
  // («argumento de linha de comando não é válido» no fallback .eml).
  const host = (url.hostname || '').toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    url.pathname.includes('/api/open-outlook-draft')
  ) {
    return;
  }
  // Só same-origin (Pages / localhost da app). Cross-origin fica no browser.
  if (url.origin !== self.location.origin) {
    return;
  }

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
