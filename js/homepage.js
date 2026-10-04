/* ============================================================
   Homepage -- the app's landing tab. Five sections, each pulling
   from data this app already has or already mirrors, nothing new:

   1. Today        -- our own games/practices scheduled for today
                       (teams/{teamId}/schedule + practices).
   2. Around Town   -- every Lunenburg team's games today, across
                       every division (name-matched against
                       shared/macLeagueStandings), not just ours.
   3. League Tonight -- the existing "Tonight in the League" widget
                       (js/tonight.js), mounted here as-is: its own
                       division picker already remembers the last
                       division picked per device, which is what
                       "favorite division" means in practice -- no
                       separate favoriting control to keep in sync
                       with it.
   4. Upcoming      -- our next few games/practices after today.
   5. Quick team card -- our record (from the league standings
                       mirror when this team resolves there, our own
                       tracked record otherwise), our own logo, and a
                       link to our real macleague.org/Crossbar team
                       page. No phone/email lives in this app for
                       anyone, coaches included -- see roster.js and
                       league-info.js's header comments for why; the
                       league's own team page is where that actually
                       belongs, same substitute used everywhere else
                       in this app that touches a coach's contact
                       info.

   "Around Town" and "League Tonight" are horizontally scrollable
   strips (drag-and-swipe, same as the nav bars), not an auto-
   animating marquee -- a real marquee looks broken with only 1-2
   items and takes the choice of pace away from whoever's reading it.
   ============================================================ */
(function () {
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }

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
          ${played ? `<span class="badge ${item.ourScore > item.oppScore ? 'badgeW' : item.ourScore < item.oppScore ? 'badgeL' : 'badgeT'}">${item.ourScore}-${item.oppScore}</span>` : '<span class="badge badgeTbd">Game</span>'}
        </div>`;
    }
    const TYPE_LABEL = { practice: 'Practice', cage: 'Batting Cage', film: 'Film / Walkthrough' };
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

      // ---- 5. Quick team card -- league record when resolvable, our own
      // tracked record otherwise; logo is always our own; Crossbar link
      // only when the league mirror resolves this team. ----
      const cfg = window.TeamConfig.current();
      const leagueMatch = window.LeagueTeams.find(cfg.shortName || cfg.name);
      let leagueRow = null;
      if (leagueMatch) {
        const standings = await window.dbGet(window.sharedPath('macLeagueStandings'));
        const division = standings && standings.divisions && standings.divisions[leagueMatch.divisionId];
        leagueRow = division && (division.rows || []).find(r => r.teamId === leagueMatch.teamId);
      }
      const ownRecord = window.Schedule.record(teamId);
      const recordStr = leagueRow
        ? `${leagueRow.w ?? '-'}-${leagueRow.l ?? '-'}${leagueRow.t && leagueRow.t !== '0' ? '-' + leagueRow.t : ''}`
        : (ownRecord.ties ? `${ownRecord.wins}-${ownRecord.losses}-${ownRecord.ties}` : `${ownRecord.wins}-${ownRecord.losses}`);

      containerEl.innerHTML = `
        <div class="detailCard homeTeamCard">
          <img class="homeTeamLogo" src="assets/images/lybs-icon.png" alt="">
          <div class="homeTeamInfo">
            <div class="listRowTitle" style="font-size:17px;">${escapeHtml(cfg.name || cfg.shortName)}</div>
            <div class="recordLine"><b>${escapeHtml(recordStr)}</b>${leagueRow ? ' <span class="helpText" style="display:inline;margin:0;">(league record)</span>' : ''}</div>
          </div>
          ${leagueMatch ? `<a class="btn btnSmall" href="${window.LeagueTeams.teamUrl(cfg.shortName || cfg.name)}" target="_blank" rel="noopener">Team page &amp; coach contact on macleague.org</a>` : ''}
        </div>

        <div class="sectionLabel" style="margin-top:18px;">Today</div>
        ${todayItems.length
          ? `<div class="listBody">${todayItems.map(x => todayItemHtml(x.kind, x.item)).join('')}</div>`
          : '<div class="emptyState">Nothing on the calendar for us today.</div>'}

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
                  <div class="listRowTitle">${x.kind === 'game' ? (x.item.homeAway === 'Away' ? '@' : 'vs') + ' ' + escapeHtml(x.item.opponent || 'TBD') : escapeHtml({ practice: 'Practice', cage: 'Batting Cage', film: 'Film / Walkthrough' }[x.item.type] || 'Practice')}</div>
                  <div class="listRowSub">${escapeHtml(fmtDate(x.date))}</div>
                </div>
              </div>`).join('')}</div>`
          : '<div class="emptyState">Nothing else scheduled yet.</div>'}`;

      const tickerTown = containerEl.querySelector('#homeTickerTown');
      if (tickerTown) enableDragScroll(tickerTown);

      window.TonightGames.render(containerEl.querySelector('#homeLeagueSlot'), cfg.macLeagueDivisionId, {
        onWatchLive: opts.onWatchLive,
      });
    },
  };
})();
