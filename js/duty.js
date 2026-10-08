/* ============================================================
   Snack/equipment duty -- a rotation through the roster, one player
   per game, same "coach sets the order once, everyone can check
   whose turn it is" shape as Depth Chart.

   Stored at teams/{teamId}/dutyRotation = {order: [playerId, ...]}.
   Deliberately NOT a per-game assignment a coach fills in by hand --
   that's a second thing to remember to do before every game. Instead
   a game's assignee is derived: this team's games, sorted by date,
   each take the next name in the rotation (wrapping around), so the
   whole season's assignments exist the moment the order does, and
   stay stable as games get added or marked complete -- a game's slot
   in the rotation never moves once it's been played, it just only
   ever shifts for GAMES that have not happened yet, same as the fact
   that reordering the list only reshuffles future dates. Dropping a
   player from the roster drops them from the order automatically;
   adding one appends them to the end rather than leaving them out.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> {order: [playerId,...]}

  function reconcile(teamId, roster) {
    const data = cache[teamId] || (cache[teamId] = { order: [] });
    const rosterIds = new Set(roster.map(p => p.id));
    let order = (data.order || []).filter(id => rosterIds.has(id));
    roster.forEach(p => { if (!order.includes(p.id)) order.push(p.id); });
    data.order = order;
    return data;
  }

  window.Duty = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const data = await window.dbGet(window.teamPath(teamId, 'dutyRotation'));
      cache[teamId] = { order: Array.isArray(data && data.order) ? data.order : [] };
      return cache[teamId];
    },
    async save(teamId) {
      await window.dbPut(window.teamPath(teamId, 'dutyRotation'), cache[teamId]);
    },

    // Whoever's up for the game at this 0-based index among this team's
    // games sorted by date -- null if there's no one on the roster yet.
    assigneeForIndex(teamId, index, roster) {
      const data = reconcile(teamId, roster);
      if (!data.order.length) return null;
      const id = data.order[index % data.order.length];
      return roster.find(p => p.id === id) || null;
    },

    render(containerEl, teamId, roster, games, opts) {
      opts = opts || {};
      const data = reconcile(teamId, roster);
      const sortedGames = (games || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const today = new Date().toISOString().slice(0, 10);

      function playerName(id) {
        const p = roster.find(x => x.id === id);
        return p ? p.name : '(removed)';
      }

      function refresh() {
        // Recomputed every refresh, not once up front -- it depends on
        // data.order, which a reorder click mutates in place.
        const upNext = sortedGames
          .map((g, i) => ({ game: g, assignee: window.Duty.assigneeForIndex(teamId, i, roster) }))
          .filter(x => x.game.date >= today)
          .slice(0, 5);
        const rows = data.order.map((id, i) => `
          <div class="listRow" style="cursor:default;">
            <div class="depthRank">${i + 1}</div>
            <div class="listRowMain"><div class="listRowTitle">${escapeHtml(playerName(id))}</div></div>
            ${opts.canEdit ? `
              <div class="depthRowActions">
                <button class="btn btnTiny" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
                <button class="btn btnTiny" data-down="${i}" ${i === data.order.length - 1 ? 'disabled' : ''}>&darr;</button>
              </div>` : ''}
          </div>`).join('') || '<div class="emptyState">No players on the roster yet.</div>';

        const upNextHtml = upNext.length ? `<div class="listBody">${upNext.map(x => `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${x.assignee ? escapeHtml(x.assignee.name) : 'TBD'}</div>
              <div class="listRowSub">${x.game.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(x.game.opponent || 'TBD')} &middot; ${escapeHtml(x.game.date || '')}</div>
            </div>
          </div>`).join('')}</div>` : '<div class="emptyState">No upcoming games scheduled yet.</div>';

        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroIcon">\u{1F9C3}</div>
            <div class="drillHeroTitle">Snack Duty</div>
            <div class="drillHeroSub">Rotates through the roster below, one player per game -- wraps around once it reaches the end.</div>
          </div>
          <div class="sectionLabel">Up Next</div>
          ${upNextHtml}
          <div class="sectionLabel" style="margin-top:18px;">Rotation Order</div>
          ${opts.canEdit ? '<div class="helpText">Reorder with the arrows -- this only moves games that haven\'t happened yet.</div>' : ''}
          <div class="listBody" style="margin-top:8px;">${rows}</div>`;

        if (opts.canEdit) {
          containerEl.querySelectorAll('[data-up]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const i = Number(btn.dataset.up);
              [data.order[i - 1], data.order[i]] = [data.order[i], data.order[i - 1]];
              await window.Duty.save(teamId);
              refresh();
            });
          });
          containerEl.querySelectorAll('[data-down]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const i = Number(btn.dataset.down);
              [data.order[i + 1], data.order[i]] = [data.order[i], data.order[i + 1]];
              await window.Duty.save(teamId);
              refresh();
            });
          });
        }
      }
      refresh();
    },
  };
})();
