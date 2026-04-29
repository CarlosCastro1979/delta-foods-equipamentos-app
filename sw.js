const CACHE = 'delta-foods-v3';
const ASSETS = [
  '/delta-foods-equipamentos-app/',
  '/delta-foods-equipamentos-app/index.html',
  '/delta-foods-equipamentos-app/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // NEVER cache Supabase or external API calls - always network
  if (e.request.url.includes('supabase.co') || 
      e.request.url.includes('fonts.googleapis') ||
      e.request.url.includes('cdnjs.cloudflare')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Cache first for local assets
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
