/* ============================================================
   "Tonight in the League" -- every game happening today in a
   chosen MAC League division (not just ours), from the same
   shared/macLeagueStandings mirror js/standings.js reads (see
   scripts/scrape-standings.mjs's parseTodayGames). Lives at the
   top of the Schedule tab (the app's home screen) with a division
   toggle so a coach or parent can check Rookies/Minors/Majors
   without leaving the app.

   Each team name links out to its own macleague.org team page
   (full season schedule, no login needed) -- NOT to GameChanger.
   GameChanger has no public directory to resolve an arbitrary
   opponent's page from just a name; the only GameChanger link this
   app can make is to a team that's actually been configured here
   with its own widget snippet (see js/gamechanger.js), which won't
   be true for most of the ~30+ other teams across a division. The
   league's own team page is the honest substitute: same "follow
   along" purpose, resolvable for every team shown here since the
   page itself gave us the id.

   Also shared with js/standings.js's "Today's games" section on
   the Standings tab -- gameRowHtml() is the one place that knows
   how to draw a single game, so both views stay visually
   consistent.
   ============================================================ */
(function () {
  let cache = null; // shared/macLeagueStandings contents
  const DIVISION_NAMES = { '33694': 'Rookies', '33695': 'Minors', '33696': 'Majors' };
  const DIVISION_KEY = 'lybsTonightDivision';

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function teamHtml(team) {
    if (!team) return '<span class="tonightTeamName">TBD</span>';
    const logo = team.logoUrl ? `<img class="tonightTeamLogo" src="${team.logoUrl}" alt="" loading="lazy">` : '';
    const inner = `${logo}<span class="tonightTeamName">${escapeHtml(team.name)}</span>`;
    return team.teamId
      ? `<a class="tonightTeam" href="https://www.macleague.org/team/${team.teamId}" target="_blank" rel="noopener" title="See ${escapeHtml(team.name)}'s full schedule on macleague.org">${inner}</a>`
      : `<span class="tonightTeam">${inner}</span>`;
  }

  window.TonightGames = {
    async ensureLoaded() {
      if (cache) return cache;
      cache = await window.dbGet(window.sharedPath('macLeagueStandings'));
      // Seed from a real one-time scrape (data/standings-seed.json, same
      // shape scripts/scrape-standings.mjs writes) the first time any
      // browser loads this with nothing mirrored yet -- otherwise a brand
      // new visitor (no scheduled job has run against their database)
      // sees "no league schedule mirrored yet" instead of real standings.
      // Gets overwritten by the real scheduled job's output once that's
      // wired up (see README "Go live") -- this is a real snapshot, just a
      // point-in-time one, not fabricated data.
      if (!cache || !cache.divisions || !Object.keys(cache.divisions).length) {
        cache = await fetch('data/standings-seed.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => null);
        if (cache) await window.dbPut(window.sharedPath('macLeagueStandings'), cache);
      }
      return cache;
    },

    // Division ids this mirror actually has data for, in Rookies/Minors/
    // Majors order where known -- falls back to whatever's present if the
    // mirror ever carries a division this app doesn't have a label for.
    availableDivisions() {
      const divisions = (cache && cache.divisions) || {};
      const ids = Object.keys(divisions);
      const known = ['33694', '33695', '33696'].filter(id => ids.includes(id));
      const unknown = ids.filter(id => !known.includes(id));
      return known.concat(unknown).map(id => ({ id, name: DIVISION_NAMES[id] || divisions[id].name || id }));
    },

    // Single-game row -- {gameId, time, teams:[{teamId,name,logoUrl,score}, ...], location}
    // (old string-only todayGames entries, from before this shape existed,
    // render as plain text instead of breaking).
    gameRowHtml(game) {
      if (typeof game === 'string') return `<div class="detailRow">${escapeHtml(game)}</div>`;
      const [a, b] = game.teams || [];
      const hasScore = a && b && (a.score != null || b.score != null);
      const middle = hasScore
        ? `<span class="tonightScore">${escapeHtml(a.score ?? '-')} &ndash; ${escapeHtml(b.score ?? '-')}</span>`
        : '<span class="tonightVs">vs</span>';
      return `
        <div class="tonightGameRow">
          ${game.time ? `<div class="tonightGameTime">${escapeHtml(game.time)}</div>` : ''}
          <div class="tonightGameTeams">${teamHtml(a)}${middle}${teamHtml(b)}</div>
          ${game.location ? `<div class="tonightGameLocation">${escapeHtml(game.location)}</div>` : ''}
        </div>`;
    },

    // The homepage widget: division toggle (remembered per device) + that
    // division's games tonight.
    render(containerEl, defaultDivisionId) {
      const divisions = window.TonightGames.availableDivisions();
      if (!divisions.length) {
        containerEl.innerHTML = `
          <div class="detailCard" style="margin-bottom:16px;">
            <div class="sectionLabel">Tonight in the League</div>
            <div class="emptyState">No league schedule mirrored yet.</div>
          </div>`;
        return;
      }
      let divisionId = (function () {
        try { return localStorage.getItem(DIVISION_KEY) || ''; } catch (e) { return ''; }
      })();
      if (!divisions.some(d => d.id === divisionId)) divisionId = defaultDivisionId && divisions.some(d => d.id === defaultDivisionId) ? defaultDivisionId : divisions[0].id;

      function renderGames() {
        const division = cache.divisions[divisionId];
        const games = (division && division.todayGames) || [];
        const list = games.length
          ? games.map(g => window.TonightGames.gameRowHtml(g)).join('')
          : '<div class="emptyState">No games tonight in this division.</div>';
        containerEl.innerHTML = `
          <div class="detailCard" style="margin-bottom:16px;">
            <div class="sectionHeader">
              <div class="sectionLabel" style="margin:0;">Tonight in the League</div>
              <select id="tonightDivisionSelect">${divisions.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === divisionId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}</select>
            </div>
            ${list}
          </div>`;
        containerEl.querySelector('#tonightDivisionSelect').addEventListener('change', e => {
          divisionId = e.target.value;
          try { localStorage.setItem(DIVISION_KEY, divisionId); } catch (err) {}
          renderGames();
        });
      }
      renderGames();
    },
  };
})();
