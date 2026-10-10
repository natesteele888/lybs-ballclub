// Minimal service worker -- satisfies the "installable" PWA criteria and
// caches the app shell so it still opens on a weak sideline connection, same
// pattern as the ASL Bengals app's sw.js. Network-first: live data always
// needs a real connection, this only covers the fallback.
//
// IMPORTANT: bump CACHE_NAME every time index.html/BUILD_V or css/styles.css's
// ?v= gets bumped, or a phone that installed this weeks ago can keep falling
// back to a stale shell indefinitely.
//
// SHELL_FILES deliberately lists bare paths, no ?v= query string -- the
// fetch handler below matches with {ignoreSearch: true}, so a request for
// js/util.js?v=82 still hits the entry cached as js/util.js. That means
// this list never needs editing just because index.html's ?v= number
// changed -- only CACHE_NAME needs to keep moving (already a hard rule
// above), which blows away the old cache and installs fresh content under
// these same bare keys. Without every JS module listed here, a true dead
// zone at the field didn't just show stale data -- it broke outright: the
// shell loaded but every tab's own module was missing, since only
// index.html/styles.css/manifest.json were ever cached.
const CACHE_NAME = 'lybs-ballclub-shell-20261009s';
const SHELL_FILES = [
  './index.html',
  './css/styles.css',
  './manifest.json',
  './js/access-control.js',
  './js/announcements.js',
  './js/archive.js',
  './js/auth.js',
  './js/awards.js',
  './js/backend.js',
  './js/calendar-export.js',
  './js/calendar-family.js',
  './js/calendar-view.js',
  './js/cloud-auth.js',
  './js/club-logos.js',
  './js/coach-notes.js',
  './js/depth-chart.js',
  './js/drill-ath.js',
  './js/drill-baserunning.js',
  './js/drill-pitching.js',
  './js/duty.js',
  './js/equipment.js',
  './js/game-card.js',
  './js/gamechanger.js',
  './js/google-auth.js',
  './js/homepage.js',
  './js/identity.js',
  './js/league-events.js',
  './js/league-info.js',
  './js/league-teams.js',
  './js/lineup-builder.js',
  './js/pitch-smart.js',
  './js/play-diagram.js',
  './js/practice-plan.js',
  './js/practices.js',
  './js/public-view.js',
  './js/roster.js',
  './js/rules.js',
  './js/schedule.js',
  './js/signup.js',
  './js/social-submit.js',
  './js/standings.js',
  './js/stats-import.js',
  './js/team-access.js',
  './js/team-config.js',
  './js/team-page.js',
  './js/team-registry.js',
  './js/tonight.js',
  './js/util.js',
  './js/weather.js',
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
    // ignoreSearch: a request for js/util.js?v=82 still matches the entry
    // cached as js/util.js -- see SHELL_FILES' header comment above.
    fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
