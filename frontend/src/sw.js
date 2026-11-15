/* CrewWatch Service Worker — offline cache */
const CACHE  = 'crewwatch-v1';
const STATIC = ['/', '/style.css', '/dashboard.js', '/sw.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'];

// On install: cache all static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// On activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//  - API calls (/crew, /alerts): network-first, fall back to empty JSON
//  - Everything else: cache-first, fall back to network
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isApi = url.includes('/crew') || url.includes('/alerts');

  if (isApi) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response('{"offline":true,"data":[]}',
          { headers: { 'Content-Type': 'application/json' } })
      )
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
