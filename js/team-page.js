/* ============================================================
   Team Page -- an in-app profile for an opponent, reached by
   tapping a team's logo/name on any game card (js/game-card.js's
   data-team-nav, routed by index.html's one delegated handler).

   Built entirely from data this app already has or can honestly
   resolve -- no new scraping:
     - js/league-teams.js: which MAC League team this is, and their
       current standings row (from the same mirror the Standings tab
       reads, shared/macLeagueStandings).
     - js/club-logos.js: their town, for a badge and to look up home
       fields in data/league-info.json.
     - js/pitch-smart.js: their pitch-count eligibility mirror, same
       renderer the pitching-preview slot on an upcoming game uses.
     - Our own records: every game this team's schedule or archive
       has against them -- the one thing only this app can show,
       since it's our own history, not anyone else's data.

   Deliberately does NOT attempt a GameChanger box score or recap --
   there's no API and no way to resolve an arbitrary opponent's
   specific game to GameChanger's system from here (confirmed
   multiple times this session: GameChanger has never offered one).
   What a MAC League team page actually has beyond this (a rolling
   week-ahead calendar, full staff contact) stays a link-out rather
   than something re-scraped and duplicated here -- confirmed live
   against a real team page that it's a 7-day rolling view, not a
   season archive, so there's nothing honest to mirror beyond what
   the standings job already captures.
   ============================================================ */
(function () {
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Same redundant "12u "/"10u "/"8u " prefix js/standings.js strips --
  // every team in a division carries it, and the division is already named
  // alongside this (leagueMatch.team is shown right next to the town).
  function stripAgePrefix(name) {
    return (name || '').replace(/^\d{1,2}u\s+/i, '');
  }

  window.TeamPage = {
    async render(containerEl, teamId, opponentName, opts) {
      opts = opts || {};
      containerEl.innerHTML = '<div class="emptyState">Loading…</div>';

      await Promise.all([
        window.LeagueTeams.ensureLoaded(),
        window.ClubLogos.ensureLoaded(),
        window.PitchSmart.ensureLoaded(),
        window.LeagueInfo.ensureLoaded(),
        window.Schedule.ensureLoaded(teamId),
        window.Archive.ensureLoaded(),
      ]);

      const leagueMatch = window.LeagueTeams.find(opponentName); // {teamId, team, divisionId} | null
      const club = window.ClubLogos.find(opponentName); // {town, logoUrl} | null
      const badge = window.ClubLogos.badgeHtml(opponentName, 56);

      // Their current standings row, from the same mirror the Standings tab
      // reads -- only resolvable when LeagueTeams could match a team id.
      let standingsRow = null;
      if (leagueMatch) {
        const standings = await window.dbGet(window.sharedPath('macLeagueStandings'));
        const division = standings && standings.divisions && standings.divisions[leagueMatch.divisionId];
        standingsRow = division && (division.rows || []).find(r => r.teamId === leagueMatch.teamId);
      }

      // Home fields for their town, from the same League Info data the
      // League tab's Fields & Facilities section uses.
      const leagueInfo = await window.LeagueInfo.ensureLoaded();
      const theirFields = (club && leagueInfo && leagueInfo.facilities)
        ? leagueInfo.facilities.filter(f => f.town === club.town)
        : [];

      // Every game we have on record against them -- current schedule plus
      // every archived season, our own history, not anyone else's.
      const ourGames = window.Schedule.getGames(teamId).filter(g => g.opponent === opponentName);
      const archiveGames = [];

      containerEl.innerHTML = `
        <div class="sectionHeader">
          <button class="btn btnGhost btnSmall" id="tpBack">&larr; Back</button>
          <div class="recordLine">Team Page</div>
        </div>
        <div class="drillCard">
          <div class="fieldCardHeader" style="align-items:center;">
            ${badge || `<div class="fieldBadgeFallback">${escapeHtml((opponentName || '?').trim().charAt(0).toUpperCase())}</div>`}
            <div class="listRowMain">
              <div class="listRowTitle" style="font-size:18px;">${escapeHtml(opponentName || 'Unknown team')}</div>
              <div class="listRowSub">${club ? escapeHtml(club.town) : 'Town not identified'}${leagueMatch ? ' · ' + escapeHtml(stripAgePrefix(leagueMatch.team)) : ''}</div>
            </div>
          </div>
          ${standingsRow ? `
            <div class="pcStatRow" style="margin-top:14px;">
              <div class="pcStatTile"><div class="pcStatValue">${escapeHtml(standingsRow.w ?? '-')}-${escapeHtml(standingsRow.l ?? '-')}${standingsRow.t && standingsRow.t !== '0' ? '-' + escapeHtml(standingsRow.t) : ''}</div><div class="pcStatLabel">Record</div></div>
              <div class="pcStatTile"><div class="pcStatValue">${escapeHtml(standingsRow.pct ?? '-')}</div><div class="pcStatLabel">PCT</div></div>
              <div class="pcStatTile"><div class="pcStatValue">${escapeHtml(standingsRow.rf ?? '-')}</div><div class="pcStatLabel">Runs For</div></div>
              <div class="pcStatTile"><div class="pcStatValue">${escapeHtml(standingsRow.ra ?? '-')}</div><div class="pcStatLabel">Runs Against</div></div>
            </div>` : `<div class="helpText" style="margin-top:10px;">No current standings mirrored for this team.</div>`}
          ${leagueMatch ? `<a class="btn" style="width:100%;margin-top:14px;" href="${window.LeagueTeams.teamUrl(opponentName)}" target="_blank" rel="noopener">Full schedule, roster &amp; coach contact on macleague.org</a>` : ''}
        </div>

        ${theirFields.length ? `
          <div class="sectionLabel" style="margin-top:4px;">Home fields</div>
          <div class="listBody">
            ${theirFields.map(f => `
              <div class="listRow" style="cursor:default;">
                <div class="listRowMain">
                  <div class="listRowTitle">${escapeHtml(f.name)}</div>
                  <div class="listRowSub">${escapeHtml(f.address)}</div>
                </div>
                <a class="btn btnGhost btnTiny" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}" target="_blank" rel="noopener">Map</a>
              </div>`).join('')}
          </div>` : ''}

        <div class="sectionLabel" style="margin-top:18px;">Games on record vs ${escapeHtml(opponentName || 'this team')}</div>
        <div id="tpGamesSlot"></div>

        <div class="sectionLabel" style="margin-top:18px;">Pitch count status</div>
        <div id="tpPitchSlot"></div>`;

      // Our own history against them -- current schedule + every archived
      // season's games, newest first. Archive teams carry games as
      // {date, opponent, homeAway, result, score: "X-Y"}, current schedule
      // games as {date, opponent, homeAway, ourScore, oppScore} -- normalize
      // both to one shape before rendering.
      const archiveCache = await window.Archive.ensureLoaded();
      (archiveCache.teams || []).forEach(t => {
        (t.games || []).filter(g => g.opponent === opponentName).forEach(g => {
          const [ourScore, theirScore] = (g.score || '').split('-').map(s => Number(s.trim()));
          archiveGames.push({ date: g.date, homeAway: g.homeAway, ourScore, theirScore, result: g.result, season: t.season });
        });
      });
      const allGames = [
        ...ourGames.map(g => ({ date: g.date, homeAway: g.homeAway, ourScore: g.ourScore, theirScore: g.oppScore, played: g.ourScore != null })),
        ...archiveGames.map(g => ({ ...g, played: true })),
      ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      const gamesSlot = containerEl.querySelector('#tpGamesSlot');
      gamesSlot.innerHTML = allGames.length ? `<div class="listBody">${allGames.map(g => `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain">
            <div class="listRowTitle">${fmtDate(g.date)}${g.season ? ' · ' + escapeHtml(g.season) : ''}</div>
            <div class="listRowSub">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(opponentName)}</div>
          </div>
          ${g.played && g.ourScore != null ? `<span class="badge ${g.ourScore > g.theirScore ? 'badgeW' : g.ourScore < g.theirScore ? 'badgeL' : 'badgeT'}">${g.ourScore}-${g.theirScore}</span>` : '<span class="badge badgeTbd">Upcoming</span>'}
        </div>`).join('')}</div>` : '<div class="emptyState">No games on record against this team yet.</div>';

      const division = window.TeamConfig.current().macLeagueDivisionName || null;
      window.PitchSmart.renderOpponentEligibility(containerEl.querySelector('#tpPitchSlot'), opponentName, division, new Date().toISOString().slice(0, 10));

      containerEl.querySelector('#tpBack').addEventListener('click', () => opts.onBack && opts.onBack());
    },
  };
})();
