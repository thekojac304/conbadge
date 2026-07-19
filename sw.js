/* Con Badge service worker.
   Strategy is chosen per resource type so that iterating stays painless:
     - HTML/app files : NETWORK-FIRST. You always get the version you just
                        uploaded; the cache is only a fallback when offline.
                        (Cache-first here means your edits appear to do nothing,
                        which is a miserable way to develop.)
     - icons/manifest : cache-first, they rarely change.
     - CDN modules    : stale-while-revalidate; three.js is pinned by version
                        so a cached copy is always correct.
*/
const CACHE = 'conbadge-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/main.js', './js/core.js', './js/config.js', './js/pose.js',
  './js/anim.js', './js/avatar.js', './js/camera.js', './js/input.js', './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAsset = /\.(png|jpg|jpeg|svg|webmanifest|json)$/i.test(url.pathname);

  if (sameOrigin && !isAsset) {
    // NETWORK-FIRST: always prefer the freshly deployed file.
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  if (sameOrigin) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
