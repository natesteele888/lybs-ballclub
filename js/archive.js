/* ============================================================
   Season archive -- past-season team records (schedule/scores only,
   from each team's public GameChanger page). Deliberately no
   rosters or coaching staff here -- this file seeds from a
   committed JSON file (data/season-archive.json), and even a
   first-name-plus-last-initial roster for a team nobody's actively
   managing anymore doesn't need to sit in a public repo's git
   history. See that file's header note.

   List -> expand a team to see its full game-by-game record,
   reusing the same badge/GameCard styling as the live Schedule tab.
   ============================================================ */
(function () {
  let cache = null; // {teams:[...]}

  window.Archive = {
    async ensureLoaded() {
      if (cache) return cache;
      let data = await window.dbGet(window.sharedPath('seasonArchive'));
      if (!data || !Array.isArray(data.teams) || !data.teams.length) {
        data = await fetch('data/season-archive.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => ({ teams: [] }));
        await window.dbPut(window.sharedPath('seasonArchive'), data);
      }
      await window.LeagueTeams.ensureLoaded();
      cache = data;
      return cache;
    },

    render(containerEl) {
      let expanded = null; // team name currently expanded (names are unique in this dataset)

      function renderGames(t) {
        if (t.scheduleNote) return `<div class="helpText">${escapeHtml(t.scheduleNote)}</div>`;
        if (!t.games || !t.games.length) return '<div class="emptyState">No games recorded.</div>';
        return t.games.map(g => {
          const [ourScore, theirScore] = (g.score || '').split('-').map(s => s.trim());
          const club = window.ClubLogos.find(g.opponent);
          return window.GameCard.resultHtml({
            date: g.date, homeAway: g.homeAway,
            ourName: t.name, ourScore: ourScore != null ? ourScore : '-',
            theirName: g.opponent, theirScore: theirScore != null ? theirScore : '-',
            theirLogoUrl: club ? club.logoUrl : null,
            result: g.result,
            gameType: g.gameType,
          });
        }).join('');
      }

      function renderList() {
        const teams = cache.teams || [];
        const cards = teams.map(t => {
          const isOpen = expanded === t.name;
          return `
            <div class="detailCard" style="margin-bottom:12px;">
              <div class="archiveTeamHeader" data-id="${escapeHtml(t.name)}" style="cursor:pointer;">
                <h3 style="margin-bottom:2px;">${escapeHtml(t.name)}</h3>
                <div class="listRowSub">${escapeHtml(t.division)} &middot; ${escapeHtml(t.season)}</div>
                <div class="recordLine" style="margin-top:4px;">Record: <b>${escapeHtml(t.record || '—')}</b></div>
              </div>
              ${isOpen ? `
                <div class="sectionLabel" style="margin-top:14px;">Schedule</div>
                ${renderGames(t)}
                ` : ''}
            </div>`;
        }).join('') || '<div class="emptyState">No archived seasons yet.</div>';

        containerEl.innerHTML = `
          <div class="helpText">Past-season records -- schedule/scores from each team's public GameChanger page. Tap a team to see its record and game-by-game schedule.</div>
          ${cards}
        `;
        containerEl.querySelectorAll('.archiveTeamHeader').forEach(el => {
          el.addEventListener('click', () => {
            expanded = expanded === el.dataset.id ? null : el.dataset.id;
            renderList();
          });
        });
      }
      renderList();
    },
  };
})();
