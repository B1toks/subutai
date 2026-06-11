/* Sprint 4.4 — minimal PWA service worker.
 *
 * Strategy:
 *  - navigations: network-first (always try the fresh app shell, fall
 *    back to the cached one offline)
 *  - same-origin static assets (hashed JS/CSS, icons, fonts): cache-first
 *    — Vite content-hashes filenames, so stale entries are simply unused
 *  - cross-origin (Firebase, Google Fonts, Spotify): never intercepted
 *
 * Bump CACHE_VERSION on breaking SW changes; activate prunes old caches.
 */
const CACHE_VERSION = 'subutai-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase/fonts pass through

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match(`${self.registration.scope}index.html`))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
