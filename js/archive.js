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
  function badgeFor(result, score) {
    const cls = result === 'W' ? 'badgeW' : (result === 'L' ? 'badgeL' : 'badgeT');
    return `<span class="badge ${cls}">${result} ${escapeHtml(score)}</span>`;
  }

  window.Archive = {
    async ensureLoaded() {
      if (cache) return cache;
      let data = await window.dbGet(window.sharedPath('seasonArchive'));
      if (!data || !Array.isArray(data.teams) || !data.teams.length) {
        data = await fetch('data/season-archive.json').then(r => r.json()).catch(() => ({ teams: [] }));
        await window.dbPut(window.sharedPath('seasonArchive'), data);
      }
      cache = data;
      return cache;
    },

    render(containerEl) {
      let expanded = null; // team name currently expanded (names are unique in this dataset)

      function renderRoster(t) {
        if (!t.roster || !t.roster.length) return '<div class="emptyState">No roster yet.</div>';
        const rows = t.roster.map(p => `
          <div class="rosterRow">
            <div class="rosterNum">${p.number ? '#' + escapeHtml(p.number) : ''}</div>
            <div class="rosterName">${escapeHtml(p.name)}</div>
          </div>`).join('');
        return `
          ${t.rosterPartial ? `<div class="helpText" style="color:#ffd45f;">${escapeHtml(t.rosterNote || 'Partial roster -- some players missing.')}</div>` : ''}
          <div class="rosterBody">${rows}</div>`;
      }

      function renderGames(t) {
        if (t.scheduleNote) return `<div class="helpText">${escapeHtml(t.scheduleNote)}</div>`;
        if (!t.games || !t.games.length) return '<div class="emptyState">No games recorded.</div>';
        const rows = t.games.map(g => `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent)}</div>
              <div class="listRowSub">${escapeHtml(g.date)}</div>
            </div>
            ${badgeFor(g.result, g.score)}
          </div>`).join('');
        return `<div class="listBody">${rows}</div>`;
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
