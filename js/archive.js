/* ============================================================
   Season archive -- past-season team records. Schedule/scores come
   from each team's public GameChanger page; rosters are gated
   behind login there (confirmed: logged-out visitors see the same
   generic placeholder names on every team), so those were supplied
   separately by the coach and reduced to first name + last initial
   before being written to data/season-archive.json -- see that
   file's header note. Same "seed shared/ once, then it's the live
   copy" convention as rules.js.

   List -> expand a team to see its roster and full game-by-game
   record, reusing the same badge/listRow/rosterRow styling as the
   live Schedule and Roster tabs.
   ============================================================ */
(function () {
  let cache = null; // {teams:[...], pending:{...}}

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

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

      function renderRoster(t) {
        if (!t.roster || !t.roster.length) return '<div class="emptyState">No roster yet.</div>';
        return `
          ${t.rosterPartial ? `<div class="helpText" style="color:#ffd45f;">${escapeHtml(t.rosterNote || 'Partial roster -- some players missing.')}</div>` : ''}
          ${window.Roster.renderTable(t.roster, { canEdit: false })}`;
      }

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
            theirLinkUrl: window.LeagueTeams.teamUrl(g.opponent),
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
              <div class="archiveTeamHeader" data-id="${escapeHtml(t.name)}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <div>
                  <h3 style="margin-bottom:2px;">${escapeHtml(t.name)}</h3>
                  <div class="listRowSub">${escapeHtml(t.division)} &middot; ${escapeHtml(t.season)}</div>
                </div>
                <div class="recordLine"><b>${escapeHtml(t.record || '—')}</b></div>
              </div>
              ${isOpen ? `
                <div style="margin-top:14px;">
                  <div class="sectionLabel">Roster</div>
                  ${renderRoster(t)}
                  <div class="sectionLabel" style="margin-top:14px;">Schedule</div>
                  ${renderGames(t)}
                </div>` : ''}
            </div>`;
        }).join('') || '<div class="emptyState">No archived seasons yet.</div>';

        const pending = cache.pending || {};
        const notes = Object.values(pending).map(p => p.note).filter(Boolean);

        containerEl.innerHTML = `
          <div class="helpText">Past-season records -- schedule/scores from each team's public GameChanger page, rosters from the coach's own export. Tap a team to see its roster and full game-by-game schedule.</div>
          ${cards}
          ${notes.length ? `<div class="helpText" style="margin-top:16px;">${notes.map(n => `&bull; ${escapeHtml(n)}`).join('<br>')}</div>` : ''}
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
