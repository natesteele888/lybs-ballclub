/* ============================================================
   Team config -- loads teams/{teamId}/config from the database,
   falling back to TEAM_REGISTRY.teams[teamId]'s bootstrap defaults
   (team-registry.js) when the database has no override yet. This
   is what replaces the hardcoded "Bengals" strings the ASL Bengals
   audit found baked into function names in that app's schedule.js/
   standings.js/thisweek.js -- every display point here reads
   window.TeamConfig.current() instead.

   window.TeamConfig.load(teamId)  -- async, fetches + caches
   window.TeamConfig.current()     -- sync, last-loaded config (or
     a neutral placeholder before load() resolves)
   ============================================================ */
(function () {
  let current = { name: 'LYBS Ballclub', shortName: 'Team', sport: 'Baseball', colors: { primary: '#0a2f5c', secondary: '#c8102e' } };

  window.TeamConfig = {
    async load(teamId) {
      const fallback = (window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams[teamId]) || current;
      try {
        const saved = await window.dbGet(window.teamPath(teamId, 'config'));
        current = Object.assign({}, fallback, saved || {}, { teamId });
      } catch (e) {
        console.error('Could not load team config, using bootstrap default:', e);
        current = Object.assign({}, fallback, { teamId });
      }
      document.documentElement.style.setProperty('--team-primary', current.colors.primary);
      document.documentElement.style.setProperty('--team-secondary', current.colors.secondary);
      document.querySelectorAll('[data-team-name]').forEach(el => { el.textContent = current.name; });
      return current;
    },
    current() { return current; },
  };
})();
