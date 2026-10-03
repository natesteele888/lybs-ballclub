/* ============================================================
   Roster -- name / number / position / bats-throws, deliberately
   nothing more. No DOB, no contact info, no address, no height or
   weight, no birthplace -- same privacy posture as the
   lybs-reporting dashboard's registration data (see that repo's
   CLAUDE.md): this app never stores anything that would need to
   be scrubbed before the repo or database could be shown to
   anyone outside the team.

   Table layout is modeled on ESPN/MLB.com roster pages (# / Name /
   Pos / B-T, small avatar per row), minus the columns that don't
   belong on a youth roster -- those sites show age, height, weight,
   birthplace; none of that is appropriate here. The avatar is a
   plain jersey-number badge, not a photo -- this app has no player
   photo feature, deliberately, to avoid opening that privacy
   question at all.

   Pulling this straight from Crossbar (macleague.org's registration
   platform) or GameChanger instead of typing it in by hand isn't
   possible today -- neither has ever offered a public API, and
   Crossbar's own registration export carries no roster-vs-team
   assignment info even for the people running the league (see
   lybs-reporting's CLAUDE.md, a sibling project that hits the same
   wall with Crossbar's export). GameChanger rosters are gated
   behind that team's own login too (confirmed earlier building the
   History tab: logged-out visitors see generic placeholder names).
   If either platform ever opens a real roster API, this is the one
   place that would change -- everything downstream already reads
   through getPlayers()/renderTable(), not the storage shape.
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

    // Shared by the live (editable) roster and History's read-only archived
    // rosters -- pass canEdit:false and no onEdit for a plain display table.
    renderTable(players, opts) {
      opts = opts || {};
      const rows = players.map(p => `
        <tr class="${opts.canEdit ? 'rosterTableEditable' : ''}" data-id="${escapeHtml(p.id || '')}">
          <td class="rosterAvatarCell"><div class="rosterAvatar">${escapeHtml(p.number || '?')}</div></td>
          <td class="rosterTableName">${escapeHtml(p.name || '')}</td>
          <td>${escapeHtml(p.position || '—')}</td>
          <td class="numCell">${escapeHtml(p.batsThrows || '—')}</td>
        </tr>`).join('') || `<tr><td colspan="4"><div class="emptyState">No players yet.</div></td></tr>`;
      return `
        <div class="rosterTableWrap">
          <table class="rosterTable">
            <thead><tr><th></th><th>Name</th><th>Pos</th><th class="numCell">B/T</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    },

    render(teamId, containerEl, opts) {
      opts = opts || {};
      const players = window.Roster.getPlayers(teamId);
      containerEl.innerHTML = `
        <div class="sectionHeader">
          <div></div>
          ${opts.canEdit ? '<button class="btn btnSmall" id="addPlayerBtn">+ Add player</button>' : ''}
        </div>
        ${window.Roster.renderTable(players, opts)}`;
      if (opts.canEdit) {
        const addBtn = containerEl.querySelector('#addPlayerBtn');
        if (addBtn) addBtn.addEventListener('click', () => opts.onAdd && opts.onAdd());
        containerEl.querySelectorAll('tr.rosterTableEditable').forEach(row => {
          row.addEventListener('click', () => opts.onEdit && opts.onEdit(row.dataset.id));
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
          <label>Bats/Throws<input id="fBT" value="${escapeHtml(player.batsThrows || '')}" placeholder="e.g. R/R, L/L, S/R"></label>
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
          batsThrows: containerEl.querySelector('#fBT').value.trim(),
        });
        opts.onSave && opts.onSave(updated);
      });
      containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
      const deleteBtn = containerEl.querySelector('#deleteBtn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(player.id));
    },
  };
})();
