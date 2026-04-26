const CACHE = 'paybox-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  // Leaflet — fetched the first time an owner opens the Live Map or
  // Today's Route sheet. Precaching them means the *second* open is
  // instant and offline-tolerant. Pinned to the same version that
  // index.html lazy-loads (1.9.4).
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (event) => {
  // Precache same-origin assets unconditionally; treat cross-origin
  // (Leaflet on unpkg) as best-effort so a flaky network or CSP block
  // can't fail the whole SW install.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const sameOrigin = ASSETS.filter((u) => !/^https?:\/\//.test(u));
    const crossOrigin = ASSETS.filter((u) => /^https?:\/\//.test(u));
    await cache.addAll(sameOrigin);
    await Promise.allSettled(crossOrigin.map((u) =>
      fetch(u, { mode: 'no-cors' })
        .then((res) => res && cache.put(u, res))
        .catch(() => {})
    ));
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
