/* ============================================================
   Roster -- name / number / position only, deliberately. No DOB,
   no contact info, no address -- same privacy posture as the
   lybs-reporting dashboard's registration data (see that repo's
   CLAUDE.md): this app never stores anything that would need to
   be scrubbed before the repo or database could be shown to
   anyone outside the team.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> players[]
  function uid() { return 'r' + Date.now() + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  window.Roster = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const players = await window.dbGet(window.teamPath(teamId, 'roster'));
      cache[teamId] = Array.isArray(players) ? players : [];
      return cache[teamId];
    },
    getPlayers(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    },
    async savePlayer(teamId, player) {
      const list = cache[teamId] || (cache[teamId] = []);
      const idx = list.findIndex(p => p.id === player.id);
      if (idx === -1) { player.id = player.id || uid(); list.push(player); }
      else list[idx] = player;
      await window.dbPut(window.teamPath(teamId, 'roster'), list);
      return player;
    },
    async deletePlayer(teamId, id) {
      const list = cache[teamId] || [];
      cache[teamId] = list.filter(p => p.id !== id);
      await window.dbPut(window.teamPath(teamId, 'roster'), cache[teamId]);
    },

    render(teamId, containerEl, opts) {
      opts = opts || {};
      const players = window.Roster.getPlayers(teamId);
      const rows = players.map(p => `
        <div class="rosterRow" data-id="${escapeHtml(p.id)}">
          <div class="rosterNum">#${escapeHtml(p.number || '')}</div>
          <div class="rosterName">${escapeHtml(p.name || '')}</div>
          <div class="rosterPos">${escapeHtml(p.position || '')}</div>
          ${opts.canEdit ? `<button class="btn btnTiny editPlayerBtn" data-id="${escapeHtml(p.id)}">Edit</button>` : ''}
        </div>`).join('') || '<div class="emptyState">No players added yet.</div>';
      containerEl.innerHTML = `
        <div class="sectionHeader">
          <div></div>
          ${opts.canEdit ? '<button class="btn btnSmall" id="addPlayerBtn">+ Add player</button>' : ''}
        </div>
        <div class="rosterBody">${rows}</div>`;
      if (opts.canEdit) {
        const addBtn = containerEl.querySelector('#addPlayerBtn');
        if (addBtn) addBtn.addEventListener('click', () => opts.onAdd && opts.onAdd());
        containerEl.querySelectorAll('.editPlayerBtn').forEach(btn => {
          btn.addEventListener('click', e => { e.stopPropagation(); opts.onEdit && opts.onEdit(btn.dataset.id); });
        });
      }
    },

    renderForm(player, containerEl, opts) {
      opts = opts || {};
      containerEl.innerHTML = `
        <div class="detailCard">
          <label>Name<input id="fName" value="${escapeHtml(player.name || '')}"></label>
          <label>Number<input id="fNumber" value="${escapeHtml(player.number || '')}"></label>
          <label>Position<input id="fPosition" value="${escapeHtml(player.position || '')}" placeholder="e.g. SS, 2B, P/OF"></label>
          <div class="detailActions">
            <button class="btn" id="saveBtn">Save</button>
            <button class="btn btnGhost" id="cancelBtn">Cancel</button>
            ${player.id && opts.onDelete ? '<button class="btn btnDanger" id="deleteBtn">Delete</button>' : ''}
          </div>
        </div>`;
      containerEl.querySelector('#saveBtn').addEventListener('click', () => {
        const updated = Object.assign({}, player, {
          name: containerEl.querySelector('#fName').value.trim(),
          number: containerEl.querySelector('#fNumber').value.trim(),
          position: containerEl.querySelector('#fPosition').value.trim(),
        });
        opts.onSave && opts.onSave(updated);
      });
      containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
      const deleteBtn = containerEl.querySelector('#deleteBtn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(player.id));
    },
  };
})();
