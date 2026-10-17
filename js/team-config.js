/* ============================================================
   Team config -- loads teams/{teamId}/config from the database,
   falling back to TEAM_REGISTRY.teams[teamId]'s bootstrap defaults
   (team-registry.js) when the database has no override yet. This
   is what replaces the hardcoded "Bengals" strings the ASL Bengals
   audit found baked into function names in that app's schedule.js/
   standings.js/thisweek.js -- every display point here reads
   window.TeamConfig.current() instead.

   window.TeamConfig.load(teamId, explicitToken?)  -- async, fetches + caches.
     explicitToken -- see js/backend.js's dbGet() for why a caller would
     pass one; js/access-control.js's enter() does, for the same
     brand-new-Google-sign-in reason as its own dbGet/dbPut calls.
   window.TeamConfig.current()     -- sync, last-loaded config (or
     a neutral placeholder before load() resolves)
   ============================================================ */
(function () {
  let current = { name: 'LYBS Ballclub', shortName: 'Team', sport: 'Baseball', colors: { primary: '#0a2f5c', secondary: '#c8102e' } };

  window.TeamConfig = {
    async load(teamId, explicitToken) {
      const fallback = (window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams[teamId]) || current;
      try {
        const saved = await window.dbGet(window.teamPath(teamId, 'config'), explicitToken);
        // colors merges separately -- the outer Object.assign is only one
        // level deep, so a saved override naming just one of primary/
        // secondary would otherwise replace the whole sub-object and drop
        // the other color instead of just overriding the one named.
        current = Object.assign({}, fallback, saved || {}, {
          teamId,
          colors: Object.assign({}, fallback.colors, saved && saved.colors),
        });
      } catch (e) {
        console.error('Could not load team config, using bootstrap default:', e);
        current = Object.assign({}, fallback, { teamId });
      }
      // Defaults to {} (and setProperty('', '') clears rather than throws)
      // so a malformed override or an incomplete future bootstrap entry
      // can't throw outside this function's own try/catch above.
      const colors = current.colors || {};
      document.documentElement.style.setProperty('--team-primary', colors.primary || '');
      document.documentElement.style.setProperty('--team-secondary', colors.secondary || '');
      document.querySelectorAll('[data-team-name]').forEach(el => { el.textContent = current.name; });
      document.querySelectorAll('[data-team-short]').forEach(el => { el.textContent = current.shortName || current.name; });
      return current;
    },
    current() { return current; },
  };
})();
