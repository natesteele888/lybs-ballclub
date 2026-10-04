/* ============================================================
   "Tonight in the League" -- every game happening today across
   EVERY MAC League division at once, merged into one list sorted
   by start time with a small league chip on each card (a division
   filter is still there to narrow to just one), from the same
   shared/macLeagueStandings mirror js/standings.js reads (see
   scripts/scrape-standings.mjs's parseTodayGames). Lives at the
   top of the Schedule tab (the app's home screen).

   Each team name links out to its own macleague.org team page
   (full season schedule, no login needed) -- NOT to GameChanger.
   GameChanger has no public directory to resolve an arbitrary
   opponent's page from just a name; the only GameChanger link this
   app can make is to our OWN configured team's widget (see
   js/gamechanger.js), which won't be true for the other ~30+ teams
   across a league. The league's own team page is the honest
   substitute: same "follow along" purpose, resolvable for every
   team shown here since the page itself gave us the id.

   "Watch live on GameChanger" only appears on a card where this
   app's own configured team (window.TeamConfig) is one of the two
   teams -- it switches to this app's own GameChanger tab (opts.
   onWatchLive), never an external link, since there's no per-game
   GameChanger URL to link to even for our own team, only the
   embedded widget. The match is a name check against this app's
   own shortName ("Select"), which is enough while this app only
   ever runs one team -- see team-registry.js's header for what a
   second team would need instead.

   gameRowHtml() (the compact side-by-side row, NOT the card layout
   below) stays separately in use by js/standings.js's "Today's
   games" section, which is already scoped to one division and
   doesn't need a league chip.
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
  // Same redundant "12u "/"10u "/"8u " prefix js/standings.js strips --
  // every team in a division carries it, and the division picker right
  // above this list already says which division (hence bracket) it is.
  function stripAgePrefix(name) {
    return (name || '').replace(/^\d{1,2}u\s+/i, '');
  }
  function teamHtml(team) {
    if (!team) return '<span class="tonightTeamName">TBD</span>';
    const logo = team.logoUrl ? `<img class="tonightTeamLogo" src="${team.logoUrl}" alt="" loading="lazy">` : '';
    const inner = `${logo}<span class="tonightTeamName">${escapeHtml(stripAgePrefix(team.name))}</span>`;
    return team.teamId
      ? `<a class="tonightTeam" href="https://www.macleague.org/team/${team.teamId}" target="_blank" rel="noopener" title="See ${escapeHtml(team.name)}'s full schedule on macleague.org">${inner}</a>`
      : `<span class="tonightTeam">${inner}</span>`;
  }

  // "2:00 PM" -> minutes since midnight, for a correct chronological sort
  // across games pulled from every division (plain string sort gets 9:00
  // AM vs 10:00 AM wrong).
  function timeToMinutes(t) {
    const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return 9999;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function recordFor(divisionId, teamId) {
    if (!teamId) return null;
    const div = cache && cache.divisions && cache.divisions[divisionId];
    const row = div && (div.rows || []).find(r => r.teamId === teamId);
    if (!row || row.w == null) return null;
    return `${row.w}-${row.l}${row.t && row.t !== '0' ? '-' + row.t : ''}`;
  }

  // Scoped to this app's one configured team -- see header comment.
  function isOurTeam(name) {
    const ours = (window.TeamConfig.current().shortName || '').trim().toLowerCase();
    return !!ours && (name || '').toLowerCase().includes(ours);
  }

  function mergedCardHtml(game) {
    if (typeof game === 'string') return `<div class="tonightMergedCard">${escapeHtml(game)}</div>`;
    const [a, b] = game.teams || [];
    const ourGame = (a && isOurTeam(a.name)) || (b && isOurTeam(b.name));
    const teamLine = team => {
      if (!team) return '<div class="tonightMergedTeam"><span class="tonightTeamName">TBD</span></div>';
      const right = team.score != null ? escapeHtml(team.score) : (recordFor(game.divisionId, team.teamId) || '');
      return `
        <div class="tonightMergedTeam">
          ${teamHtml(team)}
          ${right ? `<span class="tonightMergedRight">${right}</span>` : ''}
        </div>`;
    };
    return `
      <div class="tonightMergedCard">
        <div class="tonightMergedTop">
          <span class="badge tonightLeagueChip">${escapeHtml(game.divisionName)}</span>
          ${game.time ? `<span class="tonightMergedTime">${escapeHtml(game.time)}</span>` : ''}
        </div>
        ${teamLine(a)}
        ${teamLine(b)}
        ${game.location ? `<div class="tonightGameLocation">${escapeHtml(game.location)}</div>` : ''}
        ${ourGame ? '<button class="btn btnGhost btnSmall tonightWatchBtn" data-watch="1">Watch live on GameChanger &rarr;</button>' : ''}
      </div>`;
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
    // opts.onWatchLive() fires when a coach/parent taps "Watch live on
    // GameChanger" on a card where this app's own team is playing --
    // switches to this app's own GameChanger tab, see header comment for
    // why that's the only honest version of that CTA.
    render(containerEl, defaultDivisionId, opts) {
      opts = opts || {};
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
        try { return localStorage.getItem(DIVISION_KEY) || 'all'; } catch (e) { return 'all'; }
      })();
      if (divisionId !== 'all' && !divisions.some(d => d.id === divisionId)) divisionId = 'all';

      function mergedGames() {
        const pool = divisionId === 'all' ? divisions : divisions.filter(d => d.id === divisionId);
        const all = [];
        pool.forEach(d => {
          const div = cache.divisions[d.id];
          ((div && div.todayGames) || []).forEach(g => {
            all.push(typeof g === 'string' ? g : Object.assign({}, g, { divisionId: d.id, divisionName: d.name }));
          });
        });
        return all.sort((x, y) => {
          if (typeof x === 'string' || typeof y === 'string') return 0;
          return timeToMinutes(x.time) - timeToMinutes(y.time);
        });
      }

      function renderGames() {
        const games = mergedGames();
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const list = games.length
          ? games.map(mergedCardHtml).join('')
          : `<div class="emptyState">No games today${divisionId === 'all' ? ' across any league' : ' in this division'}.</div>`;
        containerEl.innerHTML = `
          <div class="detailCard" style="margin-bottom:16px;">
            <div class="sectionHeader">
              <div>
                <div class="sectionLabel" style="margin:0;">Tonight in the League</div>
                <div class="helpText" style="margin:2px 0 0;">${escapeHtml(today)}</div>
              </div>
              <select id="tonightDivisionSelect">
                <option value="all" ${divisionId === 'all' ? 'selected' : ''}>All Leagues</option>
                ${divisions.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === divisionId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
              </select>
            </div>
            <div class="tonightMergedList">${list}</div>
          </div>`;
        containerEl.querySelector('#tonightDivisionSelect').addEventListener('change', e => {
          divisionId = e.target.value;
          try { localStorage.setItem(DIVISION_KEY, divisionId); } catch (err) {}
          renderGames();
        });
        containerEl.querySelectorAll('[data-watch]').forEach(btn => {
          btn.addEventListener('click', () => { if (opts.onWatchLive) opts.onWatchLive(); });
        });
      }
      renderGames();
    },
  };
})();
