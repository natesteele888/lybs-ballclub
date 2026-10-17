/* ============================================================
   Roster -- name / number / position / bats-throws / an optional
   parent email, and deliberately nothing more beyond those five. No
   DOB, no address, no height or weight, no birthplace -- same
   privacy posture as the lybs-reporting dashboard's registration
   data (see that repo's CLAUDE.md): this app stores nothing else
   that would need to be scrubbed before the repo or database could
   be shown to anyone outside the team.

   The email field is a later, narrow exception to what used to be an
   unqualified "no contact info" rule here -- see lybs-reporting's
   CLAUDE.md, "Contacts Carve-Out" section, for the one sanctioned
   pipe it can arrive through (that repo's publish_contacts.py, never
   committed anywhere, reviewed by a human before it's sent). A coach
   can also just type it in directly. Either way it is the one piece
   of real contact info this app stores, it exists only to pre-fill
   a parent invite (see js/team-access.js) so a coach doesn't have to
   retype an email they already have on file, and it deliberately
   never appears in renderTable()'s read-only roster view below --
   only in renderForm(), while a coach is actively editing that one
   player's entry.

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
  const pending = {}; // teamId -> in-flight ensureLoaded() promise
  window.Roster = {
    // Caches the in-flight fetch, not just the resolved value -- at least
    // 8 separate tabs (overview, roster, pitching, depth, lineups, duty,
    // awards, plus stats-import.js) each call this independently on render,
    // so two near-simultaneous callers are routine. Without this, whichever
    // dbGet resolved last would clobber cache[teamId] with a stale snapshot,
    // silently losing anything saved in between (same pattern already used
    // by awards.js/equipment.js/signup.js/practice-plan.js/play-diagram.js).
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      if (pending[teamId]) return pending[teamId];
      pending[teamId] = (async () => {
        try {
          const players = await window.dbGet(window.teamPath(teamId, 'roster'));
          // Deliberately no committed seed file here (unlike standings/rules/
          // schedule, which seed from league-public data). A roster is real
          // kids' names -- even reduced to first name + last initial, that
          // shouldn't sit in this repo's (public) git history. The real roster
          // only ever exists in Firebase, written by a coach through this tab
          // or pushed by scripts/sync-roster-from-dashboard.mjs (which stages
          // to a gitignored file for review, never a committed one). A fresh
          // team with nothing in Firebase yet just starts with an empty roster.
          cache[teamId] = Array.isArray(players) ? players : [];
          return cache[teamId];
        } finally {
          delete pending[teamId];
        }
      })();
      return pending[teamId];
    },
    getPlayers(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    },
    async savePlayer(teamId, player) {
      const list = cache[teamId] || (cache[teamId] = []);
      const idx = list.findIndex(p => p.id === player.id);
      if (idx === -1) { player.id = player.id || uid('r'); list.push(player); }
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

    // opts.teamId is only used to mount Benchmarks and Coach's Notes below
    // the form (see js/player-benchmarks.js, js/coach-notes.js) -- optional,
    // and both skipped entirely for a brand-new player (no id yet to attach
    // either one to).
    renderForm(player, containerEl, opts) {
      opts = opts || {};
      containerEl.innerHTML = `
        <div class="detailCard">
          <label>Name<input id="fName" value="${escapeHtml(player.name || '')}"></label>
          <label>Number<input id="fNumber" value="${escapeHtml(player.number || '')}"></label>
          <label>Position<input id="fPosition" value="${escapeHtml(player.position || '')}" placeholder="e.g. SS, 2B, P/OF"></label>
          <label>Bats/Throws<input id="fBT" value="${escapeHtml(player.batsThrows || '')}" placeholder="e.g. R/R, L/L, S/R"></label>
          <label>Parent email <span style="font-size:11px;color:var(--text2);font-weight:400;">(optional -- for invites only, never shown on the roster list)</span>
            <input id="fEmail" type="email" value="${escapeHtml(player.email || '')}" placeholder="parent@example.com"></label>
          <div class="detailActions">
            <button class="btn" id="saveBtn">Save</button>
            <button class="btn btnGhost" id="cancelBtn">Cancel</button>
            ${player.id && opts.onDelete ? '<button class="btn btnDanger" id="deleteBtn">Delete</button>' : ''}
          </div>
        </div>
        ${player.id && opts.teamId ? '<div id="rfBenchmarksSlot"></div>' : ''}
        ${player.id && opts.teamId ? '<div id="rfNotesSlot"></div>' : ''}`;
      containerEl.querySelector('#saveBtn').addEventListener('click', btnEvt => {
        const updated = Object.assign({}, player, {
          name: containerEl.querySelector('#fName').value.trim(),
          number: containerEl.querySelector('#fNumber').value.trim(),
          position: containerEl.querySelector('#fPosition').value.trim(),
          batsThrows: containerEl.querySelector('#fBT').value.trim(),
          email: containerEl.querySelector('#fEmail').value.trim(),
        });
        if (opts.onSave) withBusyButton(btnEvt.target, 'Saving...', () => opts.onSave(updated));
      });
      containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
      const deleteBtn = containerEl.querySelector('#deleteBtn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(player.id));
      const benchmarksSlot = containerEl.querySelector('#rfBenchmarksSlot');
      if (benchmarksSlot) window.PlayerBenchmarks.render(benchmarksSlot, opts.teamId, player.id);
      const notesSlot = containerEl.querySelector('#rfNotesSlot');
      if (notesSlot) window.CoachNotes.render(notesSlot, opts.teamId, player.id);
    },
  };
})();
