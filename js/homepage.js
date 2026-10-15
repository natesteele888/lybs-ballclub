/* ============================================================
   Homepage -- the app's landing tab. Pulls from data this app
   already has or already mirrors, nothing new -- this file's own
   job is surfacing it here so it isn't only discoverable by already
   knowing which of Roster's eight sub-tabs or Coaching's five tools
   to go dig through.

   0. Quick team card -- record, standings rank, games left to play
                       (from the league standings mirror when this team
                       resolves there, our own tracked record/schedule
                       otherwise), this season's Game Ball leader when
                       at least one has been given out (see
                       js/schedule.js's gameBallHtml), and a running
                       count of Awards given (teams/{teamId}/awards) --
                       each a stat tile, not its own whole section, so
                       a running tally doesn't add its own scroll-
                       length to an already-long page. Awards doesn't
                       try to name a "leader" the way Game Ball does --
                       every category's normally won by someone
                       different, so there's no one name that fits.
                       Plus our own logo and a link to our real
                       macleague.org/Crossbar team page. No phone/email
                       lives in this app for anyone, coaches included --
                       see roster.js and league-info.js's header
                       comments for why; the league's own team page is
                       where that actually belongs, same substitute used
                       everywhere else in this app that touches a
                       coach's contact info.
   0.5 Standings (abbreviated) -- the same division table js/standings.js's
                       own Standings tab renders in full, just fewer columns
                       (rank, team, W-L, PCT -- no GP/T/RF/RA/DIFF) since
                       this is the glance version sitting right under the
                       team card's own rank stat tile, not a second copy of
                       the whole tab. Reads the exact same memoized
                       TonightGames.ensureLoaded() result that stat tile
                       already computes from, not a second fetch. Every
                       row but our own routes in-app to that team's page
                       (same data-team-nav the ticker/Full Scoreboard rows
                       use); "View full standings" under the table jumps to
                       the real Standings tab for the extended columns and
                       today's games in that division. Only shown when this
                       team actually resolves into the league standings
                       mirror -- same gate the rank stat tile already uses,
                       so there's nothing dangling when it doesn't.
   1. League Tonight (ticker) -- a horizontally scrollable strip
                       (drag-and-swipe, same as the nav bars, not an
                       auto-animating marquee -- a real marquee looks
                       broken with only 1-2 items and takes the choice
                       of pace away from whoever's reading it) of EVERY
                       MAC League game today, any division, any town --
                       not just ours. Placed right under the team card,
                       first thing on the page, same spot a sports app's
                       live-scores strip usually sits. Used to be two
                       separate things -- a Lunenburg-only "Around Town"
                       ticker here and a full division-grouped list much
                       further down -- folded into one ticker plus a
                       "Full Scoreboard" section (item 7 below) for
                       whoever wants the full list, instead of showing
                       overlapping score data twice on one page.
   2. Announcements -- a coach-only note (js/announcements.js). Hidden
                       entirely for a non-coach when there's nothing
                       posted, rather than showing an empty section
                       with nothing to read.
   2.5 Needs a Volunteer -- unclaimed Sign-Up Sheet items
                       (teams/{teamId}/signups), the one thing on this
                       whole page that's a direct ask of whoever's
                       reading it rather than just information -- so
                       it sits with Announcements, above the purely
                       informational sections, and only shows up at
                       all when something's actually still open.
   2.7 League Events -- org-wide (js/league-events.js), not scoped to
                       this team -- an annual meeting, a league-wide
                       date. Read-only here regardless of role; posting
                       one is board-only, from the new "Board" nav
                       category. Same "only show up when there's
                       something to show" rule as the two above.
   3. Today        -- our own games/practices scheduled for today
                       (teams/{teamId}/schedule + practices), plus an
                       "nobody has the gear bag" nag (teams/{teamId}/
                       equipment) right under it -- but only computed
                       and only shown on a day it'd actually matter,
                       same gate as Who Can Pitch Today below rather
                       than a standing warning that's noise on an off
                       day.
   3.5 Who Can Pitch Today -- only on a day we have a game, the exact
                       same js/pitch-smart.js eligibility list already
                       shown on a game's own detail page, surfaced here
                       so a coach doesn't have to go find that game
                       first just to check who's available -- no new
                       computation, just a second mount point for a
                       component that already existed.
   7. Full Scoreboard -- the existing "Tonight in the League" widget
                       (js/tonight.js), mounted here as-is: one section
                       per division, full detail (location, "Watch live"
                       for our own game), always all shown (see that
                       file's header -- there are only a few MAC League
                       divisions, not enough to justify a filter). The
                       ticker above is the quick glance; this is "see
                       everything," same pairing a sports app's own
                       ticker-plus-"Full Scoreboard"-link usually offers.
   8. Upcoming      -- our next few games/practices after today, this
                       team only -- never another team's or another
                       division's, unlike the ticker/Full Scoreboard
                       above -- plus the next captured MAC League
                       date's games (js/league-schedule.js) underneath,
                       as their own small horizontal ticker (same
                       drag-scroll component League Tonight uses up
                       top, via LeagueSchedule.gameCardHtml). Breaks
                       the "this team only" rule on purpose: the ask
                       for this page was "visibility to what is
                       happening in the Mac league," not just our own
                       slate -- a quick scroll through that date's
                       games, not a jump to another tab to read them.
   ============================================================ */
(function () {
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // One colored icon chip per section -- same icon-badge language as the
  // Rules tab's own CATEGORY_STYLE/.rulesCatIcon, scoped to this file (not
  // reusing rules.js's map directly, which is keyed by rulebook category
  // names, not these section names). Colors are CSS var() references, not
  // literal hex -- every one of these needs a different value in light
  // mode, so the token itself carries the retheme instead of this map
  // needing a parallel light-mode copy. sectionHeaderHtml() below builds
  // the chip's tinted background with color-mix() rather than an alpha-hex
  // suffix, since that trick only works on a literal hex string.
  const SECTION_STYLE = {
    standings: { icon: '🏆', color: 'var(--accent-pink)' },
    tonight: { icon: '🏟️', color: 'var(--lybs-blue-bright)' },
    announcements: { icon: '📣', color: 'var(--gold)' },
    leagueEvents: { icon: '🗓️', color: 'var(--accent-purple)' },
    volunteer: { icon: '🙋', color: 'var(--status-green)' },
    today: { icon: '📅', color: 'var(--status-red)' },
    pitch: { icon: '🌀', color: 'var(--accent-cyan)' },
    scoreboard: { icon: '📊', color: 'var(--lybs-blue-bright)' },
    upcoming: { icon: '⏭️', color: 'var(--lybs-silver)' },
  };
  function sectionHeaderHtml(key, label) {
    const s = SECTION_STYLE[key];
    return `
      <div class="sectionHeaderRow">
        <span class="sectionIconChip" style="background:color-mix(in srgb, ${s.color} 13%, transparent);color:${s.color};">${s.icon}</span>
        <div class="sectionLabel">${escapeHtml(label)}</div>
      </div>`;
  }
  // Same icon as the section it sits inside, dimmed, above the usual
  // centered gray text -- costs nothing extra (the icon's already looked
  // up for the header above it) and turns an empty moment on the page
  // into something that still looks designed rather than just blank.
  function homeEmptyStateHtml(key, text) {
    return `<div class="homeEmptyState"><span class="homeEmptyStateIcon">${SECTION_STYLE[key].icon}</span>${escapeHtml(text)}</div>`;
  }

  // Same click-and-drag scroll as the nav bars (index.html keeps its own
  // copy too -- small enough, and these are deliberately self-contained
  // modules rather than reaching into index.html's closure for it).
  //
  // Homepage.render() replaces containerEl.innerHTML (and so this
  // function's `el`) on every single render of the Home tab, but the
  // window-level pointermove/pointerup/pointercancel listeners below used
  // to have nothing tearing them down -- switching back to Home repeatedly
  // just kept stacking new ones forever, each still closing over its own
  // now-detached ticker element. dragScrollControllers keys the two call
  // sites (there are only ever two) so each new call aborts its own
  // predecessor's listeners before attaching a fresh set.
  const dragScrollControllers = {};
  function enableDragScroll(el, key) {
    if (dragScrollControllers[key]) dragScrollControllers[key].abort();
    const controller = new AbortController();
    dragScrollControllers[key] = controller;
    const { signal } = controller;
    let down = false, dragged = false, startX = 0, startScroll = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      down = true; dragged = false;
      startX = e.clientX; startScroll = el.scrollLeft;
    }, { signal });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) <= 4) return;
      dragged = true;
      el.classList.add('dragging');
      el.scrollLeft = startScroll - dx;
    }, { signal });
    function end() { down = false; el.classList.remove('dragging'); }
    window.addEventListener('pointerup', end, { signal });
    window.addEventListener('pointercancel', end, { signal });
    el.addEventListener('click', e => {
      if (dragged) { e.stopPropagation(); e.preventDefault(); }
      dragged = false;
    }, { capture: true, signal });
  }

  // Abbreviated standings row -- same markup/classes js/standings.js's own
  // table uses (.standingsUsRow/.standingsTeamCell/.standingsTeamLink/
  // .numCell), just fewer columns (no GP/T/RF/RA/DIFF) since this is the
  // glance version, not the full table a tap on "View full standings"
  // below leads to.
  function miniStandingsRowHtml(r, i, divisionId) {
    const record = `${r.w ?? '-'}-${r.l ?? '-'}${r.t && r.t !== '0' ? '-' + r.t : ''}`;
    return `
      <tr class="${r.isUs ? 'standingsUsRow' : ''}">
        <td class="numCell">${i + 1}</td>
        <td>${r.isUs
          ? `<div class="standingsTeamCell">${window.ClubLogos.badgeHtml(r.team, 22)}${escapeHtml(stripAgePrefix(r.team))}</div>`
          : `<div class="standingsTeamCell standingsTeamLink" data-team-nav="${escapeHtml(stripAgePrefix(r.team))}" data-team-division="${escapeHtml(divisionId)}" tabindex="0" role="button">${window.ClubLogos.badgeHtml(r.team, 22)}${escapeHtml(stripAgePrefix(r.team))}</div>`}</td>
        <td class="numCell">${escapeHtml(record)}</td>
        <td class="numCell">${escapeHtml(r.pct ?? '')}</td>
      </tr>`;
  }

  function todayItemHtml(kind, item) {
    if (kind === 'game') {
      const played = item.ourScore != null && item.oppScore != null;
      const badge = window.ClubLogos.badgeHtml(item.opponent, 28) || '<div class="fieldBadgeFallback" style="width:28px;height:28px;font-size:13px;">' + escapeHtml((item.opponent || '?').charAt(0).toUpperCase()) + '</div>';
      return `
        <div class="listRow" style="cursor:default;">
          <div class="standingsTeamLink" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;" data-team-nav="${escapeHtml(item.opponent || '')}" tabindex="0" role="button" title="See ${escapeHtml(item.opponent || 'this team')}'s team page">
            ${badge}
            <div class="listRowMain">
              <div class="listRowTitle">${item.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(item.opponent || 'TBD')}</div>
              <div class="listRowSub">${escapeHtml(item.gameTime || '')}${item.location ? ' &middot; ' + escapeHtml(item.location) : ''}</div>
            </div>
          </div>
          ${played ? `<span class="badge ${item.ourScore > item.oppScore ? 'badgeW' : item.ourScore < item.oppScore ? 'badgeL' : 'badgeT'}">${item.ourScore}-${item.oppScore}</span>`
            : item.status === 'postponed' ? '<span class="badge badgeTbd">Postponed</span>'
            : item.status === 'cancelled' ? '<span class="badge badgeTbd">Cancelled</span>'
            : '<span class="badge badgeTbd">Game</span>'}
        </div>`;
    }
    return `
      <div class="listRow" style="cursor:default;">
        <div class="listRowMain">
          <div class="listRowTitle">${escapeHtml(TYPE_LABEL[item.type] || 'Practice')}</div>
          <div class="listRowSub">${escapeHtml(item.time || '')}${item.location ? ' &middot; ' + escapeHtml(item.location) : ''}</div>
        </div>
        <span class="badge badgeTbd">Practice</span>
      </div>`;
  }

  window.Homepage = {
    async render(containerEl, teamId, opts) {
      opts = opts || {};
      containerEl.innerHTML = '<div class="emptyState">Loading&hellip;</div>';

      await Promise.all([
        window.Schedule.ensureLoaded(teamId),
        window.Practices.ensureLoaded(teamId),
        window.TonightGames.ensureLoaded(),
        window.LeagueTeams.ensureLoaded(),
        window.ClubLogos.ensureLoaded(),
        window.Announcements.ensureLoaded(teamId),
        window.PitchSmart.ensureLoaded(),
        window.LeagueEvents.ensureLoaded(),
        window.LeagueSchedule.ensureLoaded(),
        window.Awards.ensureLoaded(teamId),
        window.SignUp.ensureLoaded(teamId),
        window.Equipment.ensureLoaded(teamId),
      ]);

      const today = todayStr();
      const games = window.Schedule.getGames(teamId);
      const practices = window.Practices.getItems(teamId);

      // ---- 1. Today ----
      const todayGames = games.filter(g => g.date === today).map(g => ({ kind: 'game', item: g }));
      const todayPractices = practices.filter(p => p.date === today).map(p => ({ kind: 'practice', item: p }));
      const todayItems = [...todayGames, ...todayPractices];

      // ---- League Tonight (ticker) -- every MAC League game today, any
      // division, any town -- not just Lunenburg's (that narrower cut
      // used to be its own "Around Town" section further down the page;
      // folded in here since a coach glancing at a ticker wants the
      // whole night's slate, not a second, smaller strip to also check). ----
      const tonightTicker = window.TonightGames.allTodayGames(null).filter(g => typeof g !== 'string');

      // ---- 4. Upcoming -- our next few games/practices after today ----
      const upcoming = [
        ...games.filter(g => g.date > today).map(g => ({ date: g.date, kind: 'game', item: g })),
        ...practices.filter(p => p.date > today).map(p => ({ date: p.date, kind: 'practice', item: p })),
      ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

      // The next captured MAC League date (today or later) -- a link out to
      // the Fall Schedule tab, not all of that date's games inlined here.
      // Upcoming above is deliberately this-team-only (see header comment
      // item 8); this is the one place that boundary gets a deliberate,
      // visible crack, per the ask for this page to show "what's happening
      // in the Mac league," not just our own slate.
      const leagueNextDate = window.LeagueSchedule.getAllDates().filter(d => d >= today).sort()[0] || null;
      const leagueNextGames = leagueNextDate ? window.LeagueSchedule.getGamesForDate(leagueNextDate) : [];

      // ---- 5. Quick team card -- league record/rank when resolvable, our
      // own tracked record otherwise; games left comes from our own
      // schedule (every game with no score in yet, played or not -- the
      // league mirror's GP only counts league games, and a bye week or a
      // rained-out game our own schedule already reflects is more honest
      // than re-deriving it from someone else's games-played count); logo
      // is always our own; Crossbar link only when the league mirror
      // resolves this team. ----
      const cfg = window.TeamConfig.current();
      const leagueMatch = window.LeagueTeams.find(cfg.shortName || cfg.name, cfg.macLeagueDivisionId);
      let leagueRow = null, leagueRank = null, leagueTotal = null, leagueDivisionName = null, divisionRows = [];
      if (leagueMatch) {
        // TonightGames.ensureLoaded() already fetched and cached this exact
        // path in the Promise.all above -- this just reads the memoized
        // result (same pattern standings.js's own render() uses), not a
        // second network round trip. divisionRows is kept around (not just
        // the one row for the stat tile) to also drive the abbreviated
        // standings section below.
        const standings = await window.TonightGames.ensureLoaded();
        const division = standings && standings.divisions && standings.divisions[leagueMatch.divisionId];
        divisionRows = (division && division.rows) || [];
        const idx = divisionRows.findIndex(r => r.teamId === leagueMatch.teamId);
        if (idx !== -1) {
          leagueRow = divisionRows[idx];
          leagueRank = idx + 1;
          leagueTotal = divisionRows.length;
          leagueDivisionName = division.name || null;
        }
      }
      const ownRecord = window.Schedule.record(teamId);
      const recordStr = leagueRow
        ? `${leagueRow.w ?? '-'}-${leagueRow.l ?? '-'}${leagueRow.t && leagueRow.t !== '0' ? '-' + leagueRow.t : ''}`
        : (ownRecord.ties ? `${ownRecord.wins}-${ownRecord.losses}-${ownRecord.ties}` : `${ownRecord.wins}-${ownRecord.losses}`);
      // Postponed still counts -- it's owed, just TBD on date. Cancelled
      // doesn't -- see js/schedule.js's status field.
      const gamesRemaining = games.filter(g => (g.ourScore == null || g.oppScore == null) && g.status !== 'cancelled').length;

      // Tallied from game.gameBall across this season's games -- no
      // separate storage, just counting what schedule.js already has.
      // Ties go to whoever comes first in games[] (earliest awarded),
      // not worth a "co-leaders" display for one glanceable stat tile.
      const gameBallCounts = {};
      games.forEach(g => { if (g.gameBall && g.gameBall.name) gameBallCounts[g.gameBall.name] = (gameBallCounts[g.gameBall.name] || 0) + 1; });
      const gameBallLeader = Object.keys(gameBallCounts).sort((a, b) => gameBallCounts[b] - gameBallCounts[a])[0] || null;

      // Awards given this season -- a count, not a "leader" the way Game
      // Ball has one, since every category is normally won by someone
      // different (there's no single name to put next to it the same way).
      // ensureLoaded() already fetched and cached this in the Promise.all
      // above -- this just reads the memoized array, not a second round trip.
      const awardsData = await window.Awards.ensureLoaded(teamId);
      const awardsGiven = awardsData.filter(a => a.playerName).length;

      // Sign-Up items nobody's claimed yet -- the one thing on this whole
      // page that's a direct ask of whoever's reading it, not just
      // information, so it gets its own section instead of folding into a
      // stat tile the way Awards/Game Ball do.
      const signupsData = await window.SignUp.ensureLoaded(teamId);
      const openSignupItems = signupsData
        .flatMap(s => (s.items || []).filter(i => !i.claimedBy).map(i => ({ name: i.name, sheetTitle: s.title })));

      // Equipment nobody's holding, checked only when it'd actually matter
      // today -- a standing "nobody has the bag" nag on an off day is just
      // noise, same reasoning Who Can Pitch Today already gates on todayGames.
      let uncheckedEquipment = [];
      if (todayItems.length) {
        const equipmentData = await window.Equipment.ensureLoaded(teamId);
        uncheckedEquipment = equipmentData.filter(e => !e.holderName);
      }

      const statTiles = [
        statTileHtml(escapeHtml(recordStr), leagueRow ? 'League Record' : 'Record'),
      ];
      if (leagueRank != null) {
        statTiles.push(statTileHtml(ordinal(leagueRank), `of ${leagueTotal}${leagueDivisionName ? ' &middot; ' + escapeHtml(leagueDivisionName) : ''}`));
      }
      statTiles.push(statTileHtml(gamesRemaining, 'Games Left'));
      if (gameBallLeader) {
        statTiles.push(statTileHtml(gameBallCounts[gameBallLeader], escapeHtml(gameBallLeader)));
      }
      if (awardsGiven) {
        statTiles.push(statTileHtml(awardsGiven, 'Awards Given'));
      }

      containerEl.innerHTML = `
        <div class="detailCard homeTeamCard">
          <div class="homeTeamHeaderRow">
            <img class="homeTeamLogo" src="assets/images/lybs-icon.png" alt="">
            <div class="homeTeamInfo">
              <div class="homeTeamName">${escapeHtml(cfg.name || cfg.shortName)}</div>
            </div>
          </div>
          <div class="pcStatRow" style="margin:12px 0 0;">${statTiles.join('')}</div>
          ${leagueMatch ? `<a class="btn btnSmall btnWrap" style="width:100%;margin-top:4px;" href="${window.LeagueTeams.teamUrl(cfg.shortName || cfg.name, cfg.macLeagueDivisionId)}" target="_blank" rel="noopener">Team page &amp; coach contact on macleague.org</a>` : ''}
        </div>

        ${divisionRows.length ? `
          ${sectionHeaderHtml('standings', (leagueDivisionName ? leagueDivisionName + ' ' : '') + 'Standings')}
          <div class="standingsTableWrap">
            <table class="standingsTable">
              <thead><tr><th class="numCell">#</th><th>Team</th><th class="numCell">W-L</th><th class="numCell">PCT</th></tr></thead>
              <tbody>${divisionRows.map((r, i) => miniStandingsRowHtml(r, i, leagueMatch.divisionId)).join('')}</tbody>
            </table>
          </div>
          <button class="btn btnSmall btnGhost" id="homeViewStandings" style="width:100%;margin-top:8px;">View full standings</button>` : ''}

        ${tonightTicker.length ? `
          ${sectionHeaderHtml('tonight', 'League Tonight')}
          <div class="helpText">Every MAC League game today, any division.</div>
          <div class="homeTicker" id="homeTickerTonight">${tonightTicker.map(window.TonightGames.mergedCardHtml).join('')}</div>` : ''}

        ${(window.Announcements.getItems(teamId).length || opts.canEdit) ? `
          ${sectionHeaderHtml('announcements', 'Announcements')}
          <div id="homeAnnSlot"></div>` : ''}

        ${window.LeagueEvents.getUpcoming().length ? `
          ${sectionHeaderHtml('leagueEvents', 'League Events')}
          <div id="homeLeagueEventsSlot"></div>` : ''}

        ${openSignupItems.length ? `
          ${sectionHeaderHtml('volunteer', 'Needs a Volunteer')}
          <div class="helpText">${openSignupItems.length} item${openSignupItems.length === 1 ? '' : 's'} still open: ${openSignupItems.slice(0, 4).map(i => escapeHtml(i.name)).join(', ')}${openSignupItems.length > 4 ? ', &hellip;' : ''}</div>
          <button class="btn btnSmall" id="homeViewSignups" style="width:100%;margin-top:8px;">Open Sign-Up Sheets</button>` : ''}

        ${sectionHeaderHtml('today', 'Today')}
        ${todayItems.length
          ? `<div class="listBody">${todayItems.map(x => todayItemHtml(x.kind, x.item)).join('')}</div>`
          : homeEmptyStateHtml('today', 'Nothing on the calendar for us today.')}
        ${uncheckedEquipment.length
          ? `<div class="helpText" style="color:var(--gold);margin-top:6px;">&#9888; Nobody has: ${uncheckedEquipment.map(e => escapeHtml(e.name)).join(', ')}</div>`
          : ''}

        ${todayGames.length ? `
          ${sectionHeaderHtml('pitch', 'Who Can Pitch Today')}
          <div id="homePitchSlot"></div>` : ''}

        ${sectionHeaderHtml('scoreboard', 'Full Scoreboard')}
        <div id="homeLeagueSlot"></div>

        ${sectionHeaderHtml('upcoming', 'Upcoming')}
        ${upcoming.length
          ? `<div class="listBody">${upcoming.map(x => `
              <div class="listRow" style="cursor:default;">
                <div class="listRowMain">
                  <div class="listRowTitle">${x.kind === 'game' ? (x.item.homeAway === 'Away' ? '@' : 'vs') + ' ' + escapeHtml(x.item.opponent || 'TBD') : escapeHtml(TYPE_LABEL[x.item.type] || 'Practice')}</div>
                  <div class="listRowSub">${escapeHtml(fmtDate(x.date))}</div>
                </div>
              </div>`).join('')}</div>`
          : homeEmptyStateHtml('upcoming', 'Nothing else scheduled yet.')}
        ${leagueNextDate && leagueNextGames.length ? `
          <div class="helpText" style="margin-top:12px;">MAC League &middot; ${escapeHtml(fmtDate(leagueNextDate))} &middot; every division, any town</div>
          <div class="homeTicker" id="homeUpcomingLeagueTicker">${leagueNextGames.map(window.LeagueSchedule.gameCardHtml).join('')}</div>` : ''}`;

      const viewStandingsBtn = containerEl.querySelector('#homeViewStandings');
      if (viewStandingsBtn) viewStandingsBtn.addEventListener('click', () => opts.onViewStandings && opts.onViewStandings());

      const tickerTonight = containerEl.querySelector('#homeTickerTonight');
      if (tickerTonight) enableDragScroll(tickerTonight, 'tonight');

      const tickerUpcomingLeague = containerEl.querySelector('#homeUpcomingLeagueTicker');
      if (tickerUpcomingLeague) enableDragScroll(tickerUpcomingLeague, 'upcoming');

      const annSlot = containerEl.querySelector('#homeAnnSlot');
      if (annSlot) window.Announcements.render(annSlot, teamId, { canEdit: opts.canEdit, authorName: opts.authorName });

      const leagueEventsSlot = containerEl.querySelector('#homeLeagueEventsSlot');
      if (leagueEventsSlot) window.LeagueEvents.render(leagueEventsSlot, { canEdit: false });

      const viewSignupsBtn = containerEl.querySelector('#homeViewSignups');
      if (viewSignupsBtn) viewSignupsBtn.addEventListener('click', () => opts.onViewSignups && opts.onViewSignups());

      const pitchSlot = containerEl.querySelector('#homePitchSlot');
      if (pitchSlot) window.PitchSmart.renderOurEligibility(pitchSlot, games, cfg.macLeagueDivisionName || null, today, teamId);

      window.TonightGames.render(containerEl.querySelector('#homeLeagueSlot'), cfg.macLeagueDivisionId, {
        onWatchLive: opts.onWatchLive,
      });
    },
  };
})();
