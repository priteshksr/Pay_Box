const CACHE = 'paybox-v24';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

// NOTE: We deliberately do NOT pre-cache Leaflet (or any cross-origin
// asset) at install time. We used to fetch them with `mode: 'no-cors'`
// to dodge install-time CORS issues, but that stored opaque responses
// in the cache. When the page later injected
// `<script crossorigin="" integrity="...">` for Leaflet, the SW served
// the opaque cached response back, and the browser rejected it
// (SRI integrity needs a readable body, and `crossorigin="anonymous"`
// requires a real CORS response — opaque is neither). Result: the
// very first "Open Live Map" tap after installing the SW failed with
// "Map failed to load", and only succeeded after a refresh once the
// runtime fetch handler had replaced the opaque entry with a proper
// CORS one.
//
// Solution: let the runtime fetch handler below (which already filters
// out opaque responses) do the work the first time the owner opens the
// map. After that, the cache is populated correctly and offline-OK.

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, resClone)).catch(() => {});
          return res;
        }).catch(() => cached || caches.match('./index.html'));
        return cached || networkFetch;
      })
    );
    return;
  }

  const CACHEABLE_ORIGINS = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    // Leaflet (lazy-loaded by the Live Map / Route sheets).
    'https://unpkg.com',
    // OpenStreetMap raster tiles — opaque cross-origin responses, but
    // caching them dramatically improves the second-open experience
    // for owners who keep returning to the live map.
    'https://tile.openstreetmap.org',
    'https://a.tile.openstreetmap.org',
    'https://b.tile.openstreetmap.org',
    'https://c.tile.openstreetmap.org',
  ];
  if (!CACHEABLE_ORIGINS.some((o) => url.href.startsWith(o))) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const resClone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, resClone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
