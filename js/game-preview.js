/* ============================================================
   Game Preview -- tap any league game, not just our own, to see the
   matchup, each side's current standing, and recent form. Reached
   from js/tonight.js's "Tonight in the League" ticker (Home tab +
   Standings tab's "Today's games") and js/calendar-view.js's
   read-only "MAC League" rows on the Schedule tab's Month/Week
   views -- both of those used to be dead taps (tonight.js's team
   names already opened js/team-page.js; everything else on the card
   did nothing; the MAC League rows were deliberately left unwired
   entirely). Same navigation pattern as js/team-page.js: a plain
   full-panel swap via index.html's switchTab('gamePreview'), not a
   modal, with its own [data-game-nav] delegated click handler
   mirroring team-page's [data-team-nav] one.

   Two different raw shapes feed this -- normalized here, once,
   rather than at each call site:
     - js/tonight.js's today-games entries: {gameId, time,
       teams:[{teamId,name,logoUrl,score}], location, divisionId,
       divisionName}. Already resolved to real teamIds straight off
       the standings mirror (shared/macLeagueStandings), so the
       standings lookup below is exact, no fuzzy matching needed.
     - js/league-schedule.js's forward-looking entries: {division,
       home, away, from, to, location}. Plain name strings, no
       teamId, no score ever (that file only ever carries a
       not-yet-played schedule -- see its own header comment), so
       each side is resolved here via js/league-teams.js's fuzzy
       name match, same as every other opponent-name lookup already
       in this codebase.

   Recent form is an honest degrade, not a guess. This app has no
   league-wide, per-team game log to draw on -- only (a) today's
   single-day snapshot in the standings mirror, overwritten on every
   scrape, (b) a scoreless forward-looking schedule, (c) our own
   team's own schedule/history, which only ever covers games against
   us specifically. So: the side that's this app's own configured
   team gets its real last-5 (any opponent) from window.Schedule;
   the other side gets its standings line only, labeled honestly
   rather than dressed up as a "Last 5" list that would imply a game
   log this app doesn't have.

   Pitching Status (who's eligible/unavailable to pitch THIS game,
   not just today) reuses js/pitch-smart.js's same daily-max/rest-day
   calculator team-page.js and the Pitching tab already use, computed
   as of the game's own date (today for a js/tonight.js game, the
   real calendar date for a js/league-schedule.js one, days out) --
   same honest-degrade split as Recent Form: our own side reads real
   logged pitch counts, the other side reads shared/pitchSmart, which
   is an honest empty state for every team today (Spring-only
   reporting on macleague.org's end -- see that file's own header).
   Filled in after the rest of the page is already on screen, same
   fire-and-forget-after-render pattern js/team-page.js's own
   #tpPitchSlot already uses.

   window.GamePreview.render(containerEl, source, opts)
     source -- a raw game object from TonightGames.gameById() or
       LeagueSchedule.getGamesForDate()[idx] (see normalize() below)
     opts.onBack() -- required, same contract as TeamPage.render
   ============================================================ */
(function () {
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // js/tonight.js's own division-id map, duplicated rather than shared --
  // that file keeps it private, and reversing it (name -> id, for the
  // scoreless js/league-schedule.js shape, which only ever carries a
  // division NAME) is a different direction than anything there needs.
  const DIVISION_NAME_TO_ID = { Rookies: '33694', Minors: '33695', Majors: '33696' };

  // Normalizes either raw shape into one common shape:
  // {divisionId, divisionName, date, time, location, final,
  //  sides: [{name, teamId, logoUrl, score}, {..}]}
  function normalize(source) {
    if (source && Array.isArray(source.teams)) {
      const [a, b] = source.teams;
      const sides = [a, b].filter(Boolean).map(t => ({
        name: t.name, teamId: t.teamId || null, logoUrl: t.logoUrl || null,
        score: t.score != null ? t.score : null,
      }));
      return {
        divisionId: source.divisionId || null,
        divisionName: source.divisionName || null,
        // js/tonight.js only ever carries TODAY's games (see its own header
        // comment) -- it has no date field of its own to read.
        date: todayIso(),
        time: source.time || null,
        location: source.location || null,
        final: sides.length === 2 && sides[0].score != null && sides[1].score != null,
        sides,
      };
    }
    const divisionId = DIVISION_NAME_TO_ID[source.division] || null;
    return {
      divisionId,
      divisionName: source.division || null,
      // index.html's click handler stamps this on before calling render() --
      // js/league-schedule.js's own entries carry no date of their own
      // (the date lives in which getGamesForDate(iso) array they came
      // from), so there's nothing to read here without that.
      date: source.date || null,
      time: source.from || null,
      location: source.location || null,
      final: false,
      sides: [
        { name: source.home, teamId: null, logoUrl: null, score: null },
        { name: source.away, teamId: null, logoUrl: null, score: null },
      ],
    };
  }

  // Scoped to this app's one configured team, same substring check
  // js/tonight.js's own isOurTeam() uses for the "Watch live on
  // GameChanger" button -- good enough while this app only ever runs
  // one team (see js/team-registry.js's header for what a second team
  // would need instead).
  function isOurTeam(name) {
    const ours = (window.TeamConfig.current().shortName || '').trim().toLowerCase();
    return !!ours && !!name && name.toLowerCase().includes(ours);
  }

  async function resolveTeamId(side, divisionId) {
    if (side.teamId) return side.teamId;
    if (!divisionId || !side.name) return null;
    const match = window.LeagueTeams.find(side.name, divisionId);
    return match ? match.teamId : null;
  }

  function sideBadgeHtml(side) {
    if (side.logoUrl) return `<img class="gameResultLogo" src="${side.logoUrl}" alt="" loading="lazy">`;
    const club = window.ClubLogos.find(side.name || '');
    if (club) return `<img class="gameResultLogo" src="${club.logoUrl}" alt="" loading="lazy">`;
    const letter = (side.name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="gameResultLogoFallback">${escapeHtml(letter)}</div>`;
  }

  function heroHtml(m) {
    const topRight = m.final ? 'Final' : (m.time || '');
    const [a, b] = m.sides;
    const centerHtml = m.final
      ? `<div class="gameResultCenter">
           <div class="gameResultScore${b && a.score < b.score ? ' tonightFinalScoreLoss' : ''}">${escapeHtml(String(a.score))}</div>
           <div class="gameResultScore${a && b.score < a.score ? ' tonightFinalScoreLoss' : ''}">${escapeHtml(String(b.score))}</div>
         </div>`
      : '<div class="gameResultCenter"><span class="tonightVs">vs</span></div>';
    return `
      <div class="gameResultCard">
        <div class="gameResultTop">
          <div class="gameResultDate">${escapeHtml(m.divisionName || '')}</div>
          <div class="gameResultMeta">${escapeHtml(topRight)}</div>
        </div>
        <div class="gameResultRow">
          <div class="gameResultTeam">${sideBadgeHtml(a)}<div class="gameResultName">${escapeHtml(a.name || 'TBD')}</div></div>
          ${centerHtml}
          <div class="gameResultTeam gameResultTeamRight"><div class="gameResultName">${escapeHtml(b.name || 'TBD')}</div>${sideBadgeHtml(b)}</div>
        </div>
        ${m.location ? `<div class="helpText" style="margin:10px 0 0;text-align:center;">${escapeHtml(m.location)}</div>` : ''}
      </div>`;
  }

  function standingsBlockHtml(side, row, rank, total, divisionName) {
    const badge = sideBadgeHtml(side);
    const statsHtml = row
      ? `<div class="pcStatRow" style="margin:10px 0 0;">
           ${statTileHtml(`${escapeHtml(String(row.w ?? '-'))}-${escapeHtml(String(row.l ?? '-'))}${row.t && row.t !== '0' ? '-' + escapeHtml(String(row.t)) : ''}`, 'Record')}
           ${statTileHtml(escapeHtml(row.pct ?? '-'), 'PCT')}
           ${rank != null ? statTileHtml(ordinal(rank), `of ${total}${divisionName ? ' &middot; ' + escapeHtml(divisionName) : ''}`) : ''}
         </div>`
      : `<div class="helpText" style="margin:10px 0 0;">No current standings mirrored for this team.</div>`;
    return `
      <div class="drillCard" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;">${badge}<div class="listRowTitle">${escapeHtml(side.name || 'TBD')}</div></div>
        ${statsHtml}
      </div>`;
  }

  function recentFormHtml(side, ourRecentGames) {
    const mine = isOurTeam(side.name);
    if (!mine) {
      return `<div class="helpText" style="margin:6px 0 16px;">Recent results for ${escapeHtml(side.name || 'this team')} aren't tracked here -- see their standings above.</div>`;
    }
    if (!ourRecentGames.length) {
      return '<div class="helpText" style="margin:6px 0 16px;">No completed games yet this season.</div>';
    }
    return `<div class="listBody" style="margin-bottom:16px;">${ourRecentGames.map(g => `
      <div class="listRow" style="cursor:default;">
        <div class="listRowMain">
          <div class="listRowTitle">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')}</div>
          <div class="listRowSub">${escapeHtml(g.date || '')}</div>
        </div>
        <span class="badge ${g.ourScore > g.oppScore ? 'badgeW' : g.ourScore < g.oppScore ? 'badgeL' : 'badgeT'}">${g.ourScore}-${g.oppScore}</span>
      </div>`).join('')}</div>`;
  }

  window.GamePreview = {
    async render(containerEl, source, opts) {
      opts = opts || {};
      containerEl.innerHTML = '<div class="emptyState">Loading…</div>';
      const m = normalize(source);

      const cfg = window.TeamConfig.current();
      await Promise.all([
        window.ClubLogos.ensureLoaded(),
        window.LeagueTeams.ensureLoaded(),
        cfg.teamId ? window.Schedule.ensureLoaded(cfg.teamId) : Promise.resolve(),
      ]);

      const standings = await window.dbGet(window.sharedPath('macLeagueStandings'));
      const division = m.divisionId && standings && standings.divisions && standings.divisions[m.divisionId];
      const rows = (division && division.rows) || [];
      const divisionName = (division && division.name) || m.divisionName;

      const resolvedSides = await Promise.all(m.sides.map(async side => {
        const teamId = await resolveTeamId(side, m.divisionId);
        const idx = teamId ? rows.findIndex(r => r.teamId === teamId) : -1;
        return { side, row: idx !== -1 ? rows[idx] : null, rank: idx !== -1 ? idx + 1 : null };
      }));

      const ourGames = cfg.teamId ? window.Schedule.getGames(cfg.teamId) : [];
      const ourRecent = ourGames
        .filter(g => g.ourScore != null && g.oppScore != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 5);

      containerEl.innerHTML = `
        <div class="sectionHeader">
          <button class="btn btnGhost btnSmall" id="gpBack">&larr; Back</button>
          <div class="recordLine">Game Preview</div>
        </div>
        ${heroHtml(m)}
        <div class="sectionLabel" style="margin-top:18px;">Standings</div>
        ${resolvedSides.map(({ side, row, rank }) => standingsBlockHtml(side, row, rank, rows.length, divisionName)).join('')}
        ${m.sides.map((side, i) => `
          <div class="sectionLabel" style="margin-top:8px;">${escapeHtml(side.name || 'Team')}'s Recent Form</div>
          ${recentFormHtml(side, ourRecent)}`).join('')}
        ${m.sides.map((side, i) => `
          <div class="sectionLabel" style="margin-top:8px;">${escapeHtml(side.name || 'Team')}'s Pitching Status</div>
          <div id="gpPitchSlot${i}"></div>`).join('')}
      `;
      containerEl.querySelector('#gpBack').addEventListener('click', () => opts.onBack && opts.onBack());

      // Who's eligible to pitch this game, same daily-max/rest-day
      // calculator (js/pitch-smart.js) team-page.js and the Pitching tab
      // already use -- filled in after the rest of the page is already on
      // screen, same fire-and-forget-after-render pattern team-page.js's
      // own #tpPitchSlot uses, not awaited above. Our own side reads real
      // logged pitch counts (window.Schedule); the other side reads
      // shared/pitchSmart, which degrades to an honest empty state when
      // nothing's mirrored for them (see renderOpponentEligibility's own
      // header comment -- true for every team today, Spring-only data).
      const asOfDate = m.date || todayIso();
      window.PitchSmart.ensureLoaded().then(() => {
        m.sides.forEach((side, i) => {
          const slot = containerEl.querySelector(`#gpPitchSlot${i}`);
          if (!slot) return; // the coach already navigated away
          if (isOurTeam(side.name)) {
            window.PitchSmart.renderOurEligibility(slot, ourGames, divisionName, asOfDate, cfg.teamId);
          } else if (side.name) {
            window.PitchSmart.renderOpponentEligibility(slot, side.name, divisionName, asOfDate);
          } else {
            slot.innerHTML = '<div class="emptyState">Team not identified.</div>';
          }
        });
      });
    },
  };
})();
