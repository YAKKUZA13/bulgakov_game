// Simple app-shell cache for production builds.
// Note: we intentionally keep this minimal to avoid breaking camera access.

const CACHE_NAME = 'mr-runner-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll([
          '/',
          '/manifest.webmanifest',
          '/icon.svg',
          '/maskable-icon.svg',
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first (fresh bundles), fallback to cache for offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/')),
    );
    return;
  }

  // Static: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req)),
  );
});


