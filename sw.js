const CACHE = 'delta-foods-v5';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// Network always first - never serve stale content
self.addEventListener('fetch', e => {
  // Only cache PNG icons - everything else always from network
  if (e.request.url.endsWith('.png')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(r => r || fetch(e.request).then(res => {
          cache.put(e.request, res.clone());
          return res;
        }))
      )
    );
    return;
  }
  // All other requests: network only, no cache
  e.respondWith(fetch(e.request));
});
