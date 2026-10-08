// Minimal service worker -- satisfies the "installable" PWA criteria and
// caches the app shell so it still opens on a weak sideline connection, same
// pattern as the ASL Bengals app's sw.js. Network-first: live data always
// needs a real connection, this only covers the fallback.
//
// IMPORTANT: bump CACHE_NAME every time index.html/BUILD_V or css/styles.css's
// ?v= gets bumped, or a phone that installed this weeks ago can keep falling
// back to a stale shell indefinitely.
const CACHE_NAME = 'lybs-ballclub-shell-20261008b';
const SHELL_FILES = [
  './index.html',
  './css/styles.css',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
