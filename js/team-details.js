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

  window.TeamDetails = {
    async ensureLoaded() {
      if (cache) return cache;
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
    },
    // Sync, call after ensureLoaded() resolves -- {teamId, name, season,
    // staff, roster, games, fetchedAt} | null.
    getTeam(teamId) {
      return (cache && teamId && cache[teamId]) || null;
    },
  };
})();
