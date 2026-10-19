/* ============================================================
   Team Details -- reads shared/macLeagueTeamDetails, the mirror
   scripts/scrape-team-details.mjs writes from each MAC League
   team's own public macleague.org page (schedule, roster, coaching
   staff). js/team-page.js reads this instead of linking out to
   macleague.org for the same thing -- see that script's own header
   comment for why, and the honest-degrade rule it follows (a team
   that hasn't published something just doesn't show it here,
   never guessed at).
   ============================================================ */
(function () {
  let cache = null; // shared/macLeagueTeamDetails contents, keyed by teamId
  let pending = null; // in-flight ensureLoaded() promise

  window.TeamDetails = {
    // Caches the in-flight fetch, not just the resolved value -- three
    // independent call sites (js/team-page.js, js/game-preview.js,
    // js/schedule.js) can each call this around the same time on a slow
    // connection. Without this guard, each sees cache still null and
    // starts its own dbGet/seed-fallback -- usually just a redundant
    // network round-trip, but on a brand-new device whose first-ever sync
    // from the scheduled mirror job lands in the narrow window between
    // two calls' dbGets, the second (now-stale) call's seed-fallback can
    // dbPut the static, point-in-time seed file directly over the real
    // data the first call's dbGet had just missed by a hair.
    async ensureLoaded() {
      if (cache) return cache;
      if (pending) return pending;
      pending = (async () => {
        try {
          let data = await window.dbGet(window.sharedPath('macLeagueTeamDetails'));
          // Same bootstrap as js/tonight.js's own TonightGames.ensureLoaded():
          // a brand new browser with nothing mirrored yet (no scheduled job
          // has run against their database) falls back to a real one-time
          // scrape committed alongside this file, not nothing.
          if (!data || !data.teams || !Object.keys(data.teams).length) {
            data = await fetch('data/team-details-seed.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => null);
            if (data) await window.dbPut(window.sharedPath('macLeagueTeamDetails'), data);
          }
          cache = (data && data.teams) || {};
          return cache;
        } finally {
          pending = null;
        }
      })();
      return pending;
    },
    // Sync, call after ensureLoaded() resolves -- {teamId, name, season,
    // staff, roster, games, fetchedAt} | null.
    getTeam(teamId) {
      return (cache && teamId && cache[teamId]) || null;
    },
  };
})();
