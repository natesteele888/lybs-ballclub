/* ============================================================
   Game Preview -- tap any league game, not just our own, to see the
   matchup, the game's own location on a map, each side's last 5
   results, pitching eligibility, and the full league standings.
   Reached from js/tonight.js's "Tonight in the League" ticker (Home
   tab + Standings tab's "Today's games") and js/calendar-view.js's
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

   Last 5 (Nathan: "instead of full cards with record pct. and
   place, I just want to see the results from their last 5 games...
   date, opponent and result with link to their full schedules")
   reads real per-game results, not a guess: our own configured
   team from window.Schedule (its own live schedule, any opponent),
   any other team from js/team-details.js's mirror of their own
   public macleague.org schedule (scripts/scrape-team-details.mjs --
   that's what makes a real "last 5" possible for an arbitrary
   opponent at all; before that script existed this section could
   only degrade to "not tracked here"). "Full Team Schedule" links
   to that team's own Team Page, which already has the complete
   version of this same list.

   Pitching Status (who's eligible/unavailable to pitch THIS game,
   not just today) reuses js/pitch-smart.js's same daily-max/rest-day
   calculator team-page.js and the Pitching tab already use, computed
   as of the game's own date (today for a js/tonight.js game, the
   real calendar date for a js/league-schedule.js one, days out) --
   same honest-degrade split as Last 5: our own side reads real
   logged pitch counts, the other side reads shared/pitchSmart, which
   is an honest empty state for every team today (Spring-only
   reporting on macleague.org's end -- see that file's own header).
   Filled in after the rest of the page is already on screen, same
   fire-and-forget-after-render pattern js/team-page.js's own
   #tpPitchSlot already uses.

   League Standings is the full division table (not just these two
   teams), same shared/macLeagueStandings mirror, same table
   markup/classes js/standings.js's own render() builds -- Nathan:
   "then a look at the overall league standings."

   window.GamePreview.render(containerEl, source, opts)
     source -- a raw game object from TonightGames.gameById() or
       LeagueSchedule.getGamesForDate()[idx] (see normalize() below)
     opts.onBack() -- required, same contract as TeamPage.render
   ============================================================ */
(function () {
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

  // Wraps a side's logo+name in data-team-nav (same attribute, same
  // index.html delegated handler, as every other team badge in this app)
  // so tapping it opens that team's own Team Page -- except whichever
  // side is us, same "no link to ourselves" rule js/game-card.js's own
  // "our" side already follows, since there's no Team Page for this app's
  // own configured team to open. reverse mirrors the hero's right-hand
  // side (name then badge, book-ended toward the card's edge) the same
  // way js/game-card.js's own theirTeamBlock does.
  function sideTeamHtml(side, divisionId, extraClass, reverse) {
    const badge = sideBadgeHtml(side);
    const name = `<div class="gameResultName">${escapeHtml(side.name || 'TBD')}</div>`;
    const inner = reverse ? name + badge : badge + name;
    if (isOurTeam(side.name)) return `<div class="gameResultTeam ${extraClass || ''}">${inner}</div>`;
    return `<div class="gameResultTeam gameResultTeamLink ${extraClass || ''}" data-team-nav="${escapeHtml(side.name || '')}"${divisionId ? ` data-team-division="${escapeHtml(divisionId)}"` : ''} title="See ${escapeHtml(side.name || 'this team')}'s team page" tabindex="0" role="button">${inner}</div>`;
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
          ${sideTeamHtml(a, m.divisionId)}
          ${centerHtml}
          ${sideTeamHtml(b, m.divisionId, 'gameResultTeamRight', true)}
        </div>
        ${m.location ? `<div class="helpText" style="margin:10px 0 0;text-align:center;">${escapeHtml(m.location)}</div>` : ''}
      </div>`;
  }

  // Always-visible embed, same as js/schedule.js's own upcoming-game
  // detail view (.inlineMapFrame) -- Nathan: "the google map of the
  // location should also appear here under the game header." Only ever
  // one of these on this page, same reasoning that file's own header
  // comment gives for not gating it behind a tap the way js/league-
  // info.js's Facilities list (many addresses at once) still does.
  function mapHtml(location) {
    if (!location) return '';
    return `
      <div class="sectionLabel" style="margin-top:18px;">Location</div>
      <iframe class="inlineMapFrame" src="https://maps.google.com/maps?q=${encodeURIComponent(location)}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map"></iframe>
      <a class="btn btnGhost btnSmall" style="width:100%;margin:8px 0 0;" href="${mapLink(location)}" target="_blank" rel="noopener">Open in Maps</a>`;
  }

  // "10/15" -- compact, no year (every game on this list is the same
  // season, so the year is redundant context a tight 3-column table
  // doesn't have room for -- team-page.js's own fmtDate() spells out
  // "Oct 15, 2026" for its single full-width list; this is deliberately
  // shorter for a 3-up table, same shape as the ESPN-style reference
  // Nathan pointed at).
  function fmtShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // Up to 5 real completed games (any opponent), newest first -- `games`
  // is already that exact slice by the time this is called (window.
  // Schedule's own games for our side, js/team-details.js's mirror for
  // anyone else). data-team-nav on "Full Team Schedule" reuses the exact
  // attribute/handler every other team link on this page already does;
  // skipped for our own side since there's no Team Page for ourselves to
  // send it to (the live Schedule tab is already one nav tap away).
  function last5Html(side, divisionId, games) {
    const mine = isOurTeam(side.name);
    const body = !games || !games.length
      ? '<div class="emptyState">No recent results available.</div>'
      : `<div class="standingsTableWrap">
           <table class="standingsTable">
             <thead><tr><th>Date</th><th>Opp</th><th class="numCell">Result</th></tr></thead>
             <tbody>
               ${games.map(g => `
                 <tr>
                   <td>${escapeHtml(fmtShortDate(g.date))}</td>
                   <td>${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(stripAgePrefix(g.opponent || 'TBD'))}</td>
                   <td class="numCell ${g.result === 'W' ? 'diffPos' : g.result === 'L' ? 'diffNeg' : ''}">${escapeHtml(g.result || '')} ${escapeHtml(String(g.ourScore ?? ''))}-${escapeHtml(String(g.oppScore ?? ''))}</td>
                 </tr>`).join('')}
             </tbody>
           </table>
         </div>`;
    return `
      <div class="drillCard" style="margin-bottom:12px;">
        <div class="drillCardTitle">${escapeHtml(side.name || 'TBD')}'s Last 5</div>
        ${body}
        ${!mine ? `<div style="text-align:center;margin-top:10px;"><span class="standingsTeamLink" style="cursor:pointer;color:var(--accent-blue);font-weight:600;" data-team-nav="${escapeHtml(side.name || '')}"${divisionId ? ` data-team-division="${escapeHtml(divisionId)}"` : ''} tabindex="0" role="button">Full Team Schedule</span></div>` : ''}
      </div>`;
  }

  // Full division table, not just these two teams -- same markup/classes
  // js/standings.js's own render() builds (.standingsTableWrap/
  // .standingsTable/.standingsTeamCell/.numCell/.standingsUsRow), kept
  // leaner (Team/W/L/PCT only, no GP/T/RF/RA/DIFF) since this is a
  // supplementary section on a page that's mostly about one specific
  // game, not the dedicated Standings tab. Both matchup teams highlighted
  // the same way standings.js highlights "us" -- there's no single "us"
  // in an arbitrary league-wide matchup, but there are two teams worth
  // calling out against the rest of the division.
  function fullStandingsHtml(rows, highlightIds, divisionName) {
    if (!rows.length) return '<div class="emptyState">No standings mirrored for this division.</div>';
    const body = rows.map(r => {
      const mine = highlightIds.includes(r.teamId);
      return `
        <tr class="${mine ? 'standingsUsRow' : ''}">
          <td>${mine
            ? `<div class="standingsTeamCell">${window.ClubLogos.badgeHtml(r.team, 22)}${escapeHtml(stripAgePrefix(r.team))}</div>`
            : `<div class="standingsTeamCell standingsTeamLink" data-team-nav="${escapeHtml(stripAgePrefix(r.team))}" tabindex="0" role="button">${window.ClubLogos.badgeHtml(r.team, 22)}${escapeHtml(stripAgePrefix(r.team))}</div>`}</td>
          <td class="numCell">${escapeHtml(r.w ?? '')}</td>
          <td class="numCell">${escapeHtml(r.l ?? '')}</td>
          <td class="numCell">${escapeHtml(r.pct ?? '')}</td>
        </tr>`;
    }).join('');
    return `
      <div class="helpText" style="margin-bottom:8px;">${escapeHtml(divisionName || '')}</div>
      <div class="standingsTableWrap">
        <table class="standingsTable">
          <thead><tr><th>Team</th><th class="numCell">W</th><th class="numCell">L</th><th class="numCell">PCT</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
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
        window.TeamDetails.ensureLoaded(),
        cfg.teamId ? window.Schedule.ensureLoaded(cfg.teamId) : Promise.resolve(),
      ]);

      const standings = await window.dbGet(window.sharedPath('macLeagueStandings'));
      const division = m.divisionId && standings && standings.divisions && standings.divisions[m.divisionId];
      const rows = (division && division.rows) || [];
      const divisionName = (division && division.name) || m.divisionName;

      const resolvedSides = await Promise.all(m.sides.map(async side => {
        const teamId = await resolveTeamId(side, m.divisionId);
        const idx = teamId ? rows.findIndex(r => r.teamId === teamId) : -1;
        return { side, teamId, row: idx !== -1 ? rows[idx] : null, rank: idx !== -1 ? idx + 1 : null };
      }));

      const ourGames = cfg.teamId ? window.Schedule.getGames(cfg.teamId) : [];
      const last5For = ({ side, teamId }) => {
        if (isOurTeam(side.name)) {
          return ourGames
            .filter(g => g.ourScore != null && g.oppScore != null)
            .map(g => ({ date: g.date, homeAway: g.homeAway, opponent: g.opponent, result: g.ourScore > g.oppScore ? 'W' : g.ourScore < g.oppScore ? 'L' : 'T', ourScore: g.ourScore, oppScore: g.oppScore }))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
            .slice(0, 5);
        }
        const details = teamId ? window.TeamDetails.getTeam(teamId) : null;
        return ((details && details.games) || [])
          .filter(g => g.result)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 5);
      };

      containerEl.innerHTML = `
        <div class="sectionHeader">
          <button class="btn btnGhost btnSmall" id="gpBack">&larr; Back</button>
          <div class="recordLine">Game Preview</div>
        </div>
        ${heroHtml(m)}
        ${mapHtml(m.location)}
        <div class="sectionLabel" style="margin-top:18px;">Last 5</div>
        ${resolvedSides.map(rs => last5Html(rs.side, m.divisionId, last5For(rs))).join('')}
        ${m.sides.map((side, i) => `
          <div class="sectionLabel" style="margin-top:8px;">${escapeHtml(side.name || 'Team')}'s Pitching Status</div>
          <div id="gpPitchSlot${i}"></div>`).join('')}
        <div class="sectionLabel" style="margin-top:18px;">League Standings</div>
        ${fullStandingsHtml(rows, resolvedSides.map(rs => rs.teamId).filter(Boolean), divisionName)}
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
