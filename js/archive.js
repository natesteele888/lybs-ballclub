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
      // Index (within that team's own games[]) of whichever single game's
      // line score is showing -- Nathan: "I want the line score to be
      // visible upon clicking onto the game," not every game in a 13-17
      // game season all expanded at once by default. Index, not a date/
      // opponent key, since a doubleheader can repeat both on the same
      // team. Reset whenever a different team is opened (below) so
      // switching teams never leaves some OTHER team's game looking
      // expanded underneath a freshly opened one.
      let expandedGame = null;

      function renderGames(t) {
        if (t.scheduleNote) return `<div class="helpText">${escapeHtml(t.scheduleNote)}</div>`;
        if (!t.games || !t.games.length) return '<div class="emptyState">No games recorded.</div>';
        return t.games.map((g, i) => {
          const [ourScore, theirScore] = (g.score || '').split('-').map(s => s.trim());
          const club = window.ClubLogos.find(g.opponent);
          const card = window.GameCard.resultHtml({
            date: g.date, homeAway: g.homeAway,
            ourName: t.name, ourScore: ourScore != null ? ourScore : '-',
            theirName: g.opponent, theirScore: theirScore != null ? theirScore : '-',
            theirLogoUrl: club ? club.logoUrl : null,
            result: g.result,
            gameType: g.gameType,
            // Real GameChanger inning-by-inning line score, when
            // scripts/enrich-archive-linescores.mjs found a match for this
            // game -- not every archived game has one (gcTeamId is only
            // set for teams whose GameChanger page was ever looked up).
            // Only rendered for whichever game is currently expanded --
            // hasLineScore still flags every OTHER one so its card can
            // hint that tapping it does something.
            lineScore: expandedGame === i ? g.lineScore : null,
            hasLineScore: !!g.lineScore,
          });
          // data-game-idx, not a click handler wired here directly --
          // GameCard's own opponent-logo link already needs to keep
          // working inside this (same nested-interactive-element pattern
          // js/schedule.js's own .gameResultCardWrap already relies on:
          // data-team-nav's capture-phase handler stops its own clicks
          // from ever reaching this wrapper's bubble-phase listener,
          // wired once after the whole list renders, below).
          return g.lineScore
            ? `<div class="archiveGameWrap" data-game-idx="${i}" style="cursor:pointer;">${card}</div>`
            : card;
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
            expandedGame = null; // a game expanded under the PREVIOUS team shouldn't still look expanded under this one
            renderList();
          });
        });
        containerEl.querySelectorAll('.archiveGameWrap').forEach(el => {
          el.addEventListener('click', () => {
            const idx = Number(el.dataset.gameIdx);
            expandedGame = expandedGame === idx ? null : idx;
            renderList();
          });
        });
      }
      renderList();
    },
  };
})();
