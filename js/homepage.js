/* ============================================================
   Homepage -- the app's landing tab. Pulls from data this app
   already has or already mirrors, nothing new -- this file's own
   job is surfacing it here so it isn't only discoverable by already
   knowing which of Roster's eight sub-tabs or Coaching's five tools
   to go dig through.

   0. Announcements -- a coach-only note (js/announcements.js),
                       shown first since it's the one thing on this
                       page meant to be time-sensitive ("practice
                       moved to 6pm"). Hidden entirely for a non-
                       coach when there's nothing posted, rather than
                       showing an empty section with nothing to read.
   0.5 Needs a Volunteer -- unclaimed Sign-Up Sheet items
                       (teams/{teamId}/signups), the one thing on this
                       whole page that's a direct ask of whoever's
                       reading it rather than just information -- so
                       it sits with Announcements, above the purely
                       informational sections, and only shows up at
                       all when something's actually still open.
   1. Today        -- our own games/practices scheduled for today
                       (teams/{teamId}/schedule + practices).
   1.5 Who Can Pitch Today -- only on a day we have a game, the exact
                       same js/pitch-smart.js eligibility list already
                       shown on a game's own detail page, surfaced here
                       so a coach doesn't have to go find that game
                       first just to check who's available -- no new
                       computation, just a second mount point for a
                       component that already existed.
   2. Around Town   -- every Lunenburg team's games today, across
                       every division (name-matched against
                       shared/macLeagueStandings), not just ours.
   3. League Tonight -- the existing "Tonight in the League" widget
                       (js/tonight.js), mounted here as-is: one section
                       per division, always all shown (see that file's
                       header -- there are only a few MAC League
                       divisions, not enough to justify a filter).
   4. Upcoming      -- our next few games/practices after today, this
                       team only -- never another team's or another
                       division's, unlike "Around Town"/"League
                       Tonight" above.
   5. Quick team card -- record, standings rank, games left to play
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

   "Around Town" is a horizontally scrollable strip (drag-and-swipe,
   same as the nav bars), not an auto-animating marquee -- a real
   marquee looks broken with only 1-2 items and takes the choice of
   pace away from whoever's reading it.
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

  // Same click-and-drag scroll as the nav bars (index.html keeps its own
  // copy too -- small enough, and these are deliberately self-contained
  // modules rather than reaching into index.html's closure for it).
  function enableDragScroll(el) {
    let down = false, dragged = false, startX = 0, startScroll = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      down = true; dragged = false;
      startX = e.clientX; startScroll = el.scrollLeft;
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) <= 4) return;
      dragged = true;
      el.classList.add('dragging');
      el.scrollLeft = startScroll - dx;
    });
    function end() { down = false; el.classList.remove('dragging'); }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    el.addEventListener('click', e => {
      if (dragged) { e.stopPropagation(); e.preventDefault(); }
      dragged = false;
    }, true);
  }

  function todayItemHtml(kind, item) {
    if (kind === 'game') {
      const played = item.ourScore != null && item.oppScore != null;
      return `
        <div class="listRow" style="cursor:default;">
          ${window.ClubLogos.badgeHtml(item.opponent, 28) || '<div class="fieldBadgeFallback" style="width:28px;height:28px;font-size:13px;">' + escapeHtml((item.opponent || '?').charAt(0).toUpperCase()) + '</div>'}
          <div class="listRowMain">
            <div class="listRowTitle">${item.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(item.opponent || 'TBD')}</div>
            <div class="listRowSub">${escapeHtml(item.gameTime || '')}${item.location ? ' &middot; ' + escapeHtml(item.location) : ''}</div>
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
      ]);

      const today = todayStr();
      const games = window.Schedule.getGames(teamId);
      const practices = window.Practices.getItems(teamId);

      // ---- 1. Today ----
      const todayGames = games.filter(g => g.date === today).map(g => ({ kind: 'game', item: g }));
      const todayPractices = practices.filter(p => p.date === today).map(p => ({ kind: 'practice', item: p }));
      const todayItems = [...todayGames, ...todayPractices];

      // ---- 2. Around Town -- every Lunenburg team's games today, any division ----
      const allToday = window.TonightGames.allTodayGames(null).filter(g => typeof g !== 'string');
      const aroundTown = allToday.filter(g => (g.teams || []).some(t => /lunenburg/i.test(t.name || '')));

      // ---- 4. Upcoming -- our next few games/practices after today ----
      const upcoming = [
        ...games.filter(g => g.date > today).map(g => ({ date: g.date, kind: 'game', item: g })),
        ...practices.filter(p => p.date > today).map(p => ({ date: p.date, kind: 'practice', item: p })),
      ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

      // ---- 5. Quick team card -- league record/rank when resolvable, our
      // own tracked record otherwise; games left comes from our own
      // schedule (every game with no score in yet, played or not -- the
      // league mirror's GP only counts league games, and a bye week or a
      // rained-out game our own schedule already reflects is more honest
      // than re-deriving it from someone else's games-played count); logo
      // is always our own; Crossbar link only when the league mirror
      // resolves this team. ----
      const cfg = window.TeamConfig.current();
      const leagueMatch = window.LeagueTeams.find(cfg.shortName || cfg.name);
      let leagueRow = null, leagueRank = null, leagueTotal = null, leagueDivisionName = null;
      if (leagueMatch) {
        const standings = await window.dbGet(window.sharedPath('macLeagueStandings'));
        const division = standings && standings.divisions && standings.divisions[leagueMatch.divisionId];
        const rows = (division && division.rows) || [];
        const idx = rows.findIndex(r => r.teamId === leagueMatch.teamId);
        if (idx !== -1) {
          leagueRow = rows[idx];
          leagueRank = idx + 1;
          leagueTotal = rows.length;
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
      const awardsData = await window.dbGet(window.teamPath(teamId, 'awards'));
      const awardsGiven = (Array.isArray(awardsData) ? awardsData : []).filter(a => a.playerName).length;

      // Sign-Up items nobody's claimed yet -- the one thing on this whole
      // page that's a direct ask of whoever's reading it, not just
      // information, so it gets its own section instead of folding into a
      // stat tile the way Awards/Game Ball do.
      const signupsData = await window.dbGet(window.teamPath(teamId, 'signups'));
      const openSignupItems = (Array.isArray(signupsData) ? signupsData : [])
        .flatMap(s => (s.items || []).filter(i => !i.claimedBy).map(i => ({ name: i.name, sheetTitle: s.title })));

      const statTiles = [
        statTileHtml(escapeHtml(recordStr), leagueRow ? 'League Record' : 'Record'),
      ];
      if (leagueRank != null) {
        statTiles.push(statTileHtml(ordinal(leagueRank), `of ${leagueTotal}${leagueDivisionName ? ' &middot; ' + escapeHtml(leagueDivisionName) : ''}`));
      }
      statTiles.push(statTileHtml(gamesRemaining, 'Games Left'));
      if (gameBallLeader) {
        statTiles.push(statTileHtml(gameBallCounts[gameBallLeader], `<span class="popReveal">&#11088;</span> ${escapeHtml(gameBallLeader)}`));
      }
      if (awardsGiven) {
        statTiles.push(statTileHtml(awardsGiven, '&#127942; Awards Given'));
      }

      containerEl.innerHTML = `
        <div class="detailCard homeTeamCard">
          <div class="homeTeamHeaderRow">
            <img class="homeTeamLogo" src="assets/images/lybs-icon.png" alt="">
            <div class="homeTeamInfo">
              <div class="listRowTitle" style="font-size:17px;">${escapeHtml(cfg.name || cfg.shortName)}</div>
            </div>
          </div>
          <div class="pcStatRow" style="margin:12px 0 0;">${statTiles.join('')}</div>
          ${leagueMatch ? `<a class="btn btnSmall" style="width:100%;margin-top:4px;" href="${window.LeagueTeams.teamUrl(cfg.shortName || cfg.name)}" target="_blank" rel="noopener">Team page &amp; coach contact on macleague.org</a>` : ''}
        </div>

        ${(window.Announcements.getItems(teamId).length || opts.canEdit) ? `
          <div class="sectionLabel" style="margin-top:18px;">Announcements</div>
          <div id="homeAnnSlot"></div>` : ''}

        ${openSignupItems.length ? `
          <div class="sectionLabel" style="margin-top:18px;">Needs a Volunteer</div>
          <div class="helpText">${openSignupItems.length} item${openSignupItems.length === 1 ? '' : 's'} still open: ${openSignupItems.slice(0, 4).map(i => escapeHtml(i.name)).join(', ')}${openSignupItems.length > 4 ? ', &hellip;' : ''}</div>
          <button class="btn btnSmall" id="homeViewSignups" style="width:100%;margin-top:8px;">Open Sign-Up Sheets</button>` : ''}

        <div class="sectionLabel" style="margin-top:18px;">Today</div>
        ${todayItems.length
          ? `<div class="listBody">${todayItems.map(x => todayItemHtml(x.kind, x.item)).join('')}</div>`
          : '<div class="emptyState">Nothing on the calendar for us today.</div>'}

        ${todayGames.length ? `
          <div class="sectionLabel" style="margin-top:18px;">Who Can Pitch Today</div>
          <div id="homePitchSlot"></div>` : ''}

        ${aroundTown.length ? `
          <div class="sectionLabel" style="margin-top:18px;">Around Town</div>
          <div class="helpText">Every Lunenburg team playing today, any division.</div>
          <div class="homeTicker" id="homeTickerTown">${aroundTown.map(window.TonightGames.mergedCardHtml).join('')}</div>` : ''}

        <div class="sectionLabel" style="margin-top:18px;">League Tonight</div>
        <div id="homeLeagueSlot"></div>

        <div class="sectionLabel" style="margin-top:18px;">Upcoming</div>
        ${upcoming.length
          ? `<div class="listBody">${upcoming.map(x => `
              <div class="listRow" style="cursor:default;">
                <div class="listRowMain">
                  <div class="listRowTitle">${x.kind === 'game' ? (x.item.homeAway === 'Away' ? '@' : 'vs') + ' ' + escapeHtml(x.item.opponent || 'TBD') : escapeHtml(TYPE_LABEL[x.item.type] || 'Practice')}</div>
                  <div class="listRowSub">${escapeHtml(fmtDate(x.date))}</div>
                </div>
              </div>`).join('')}</div>`
          : '<div class="emptyState">Nothing else scheduled yet.</div>'}`;

      const tickerTown = containerEl.querySelector('#homeTickerTown');
      if (tickerTown) enableDragScroll(tickerTown);

      const annSlot = containerEl.querySelector('#homeAnnSlot');
      if (annSlot) window.Announcements.render(annSlot, teamId, { canEdit: opts.canEdit, authorName: opts.authorName });

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
