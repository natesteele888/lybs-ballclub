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
const CACHE_NAME = 'lybs-ballclub-shell-20261017b';
const SHELL_FILES = [
  './index.html',
  './css/styles.css',
  './css/situations.css',
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
  './js/data-admin.js',
  './js/depth-chart.js',
  './js/drill-ath.js',
  './js/drill-baserunning.js',
  './js/drill-pitching.js',
  './js/duty.js',
  './js/equipment.js',
  './js/game-card.js',
  './js/game-preview.js',
  './js/gamechanger.js',
  './js/google-auth.js',
  './js/homepage.js',
  './js/identity.js',
  './js/league-events.js',
  './js/league-info.js',
  './js/league-schedule.js',
  './js/league-teams.js',
  './js/lineup-builder.js',
  './js/nav-history.js',
  './js/pitch-smart.js',
  './js/play-diagram.js',
  './js/player-benchmarks.js',
  './js/practice-catalog.js',
  './js/practice-plan.js',
  './js/practices.js',
  './js/public-view.js',
  './js/roster.js',
  './js/rules.js',
  './js/schedule.js',
  './js/signals.js',
  './js/signup.js',
  './js/situations.js',
  './js/social-submit.js',
  './js/standings.js',
  './js/stats-import.js',
  './js/team-access.js',
  './js/team-config.js',
  './js/team-details.js',
  './js/team-page.js',
  './js/team-registry.js',
  './js/tonight.js',
  './js/util.js',
  './js/weather.js',
];

self.addEventListener('install', (event) => {
  // No .catch() swallowing a failed addAll -- cache.addAll is all-or-nothing,
  // so if even one shell file fails to fetch (a flaky connection, exactly
  // the scenario this file exists to survive), letting the rejection
  // propagate keeps the browser on the previous, fully-working worker and
  // retries this install later. skipWaiting() only runs once every shell
  // file is actually cached, which also means activate's cleanup below
  // never runs against a half-populated cache.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Navigating to the bare scope root (a bookmark, a home-screen icon
  // added without the manifest's exact start_url, a plain shared link)
  // never matches a cache entry keyed by the resolved './index.html' URL
  // SHELL_FILES caches it under -- route every top-level navigation to
  // that one entry regardless of the exact URL requested.
  const cacheKey = event.request.mode === 'navigate' ? './index.html' : event.request;
  event.respondWith((async () => {
    const networkPromise = fetch(event.request).catch(() => null);
    // On a weak sideline connection fetch() can sit pending a long time
    // before it ever rejects -- race it against a short timeout instead of
    // only falling back once the network definitively fails, so a slow
    // link gets the cached shell promptly instead of a long hang.
    const early = await Promise.race([networkPromise, timeout(2500)]);
    if (early) return early;
    // ignoreSearch: a request for js/util.js?v=82 still matches the entry
    // cached as js/util.js -- see SHELL_FILES' header comment above.
    const cached = await caches.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    // Nothing cached for this request -- wait out the slow network instead
    // of failing outright.
    const late = await networkPromise;
    return late || Response.error();
  })());
});
