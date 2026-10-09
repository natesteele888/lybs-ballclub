/* ============================================================
   Coach's Notes -- private, dated observations about a player
   (what to work on, what clicked at practice), visible only inside
   that player's edit screen on the Roster tab. Never shown to
   players or parents, never surfaced anywhere else in the app --
   this is a coach's own running notebook, not a recognition feature
   like Awards or anything a player/parent has reason to see.

   Stored at coachPrivate/{teamId}/notes = {playerId: [{id, date,
   text}, ...]}, newest first -- deliberately NOT under
   teams/{teamId} (see js/backend.js's coachPrivatePath header):
   that path's own .read rule already grants any player on the team
   read access to everything beneath it, and a more restrictive rule
   nested under it can't claw that back, so real privacy means a
   separate top-level path with its own rule instead. UI-wise this
   is reachable only from js/roster.js's renderForm, itself only
   ever reached when opts.canEdit is true (a non-coach's roster row
   isn't even clickable) -- but the data-layer privacy above is what
   actually matters, not that UI gate.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> {playerId: [{id,date,text}]}

  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    const data = await window.dbGet(window.coachPrivatePath(teamId, 'notes'));
    cache[teamId] = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    return cache[teamId];
  }
  async function save(teamId) {
    await window.dbPut(window.coachPrivatePath(teamId, 'notes'), cache[teamId]);
  }

  window.CoachNotes = {
    // containerEl already exists in the DOM (inside the player edit
    // form) -- this owns just its own subtree and re-renders itself
    // independently of the form around it.
    async render(containerEl, teamId, playerId) {
      const all = await ensureLoaded(teamId);
      const notes = all[playerId] || (all[playerId] = []);

      function refresh() {
        containerEl.innerHTML = `
          <div class="sectionLabel" style="margin-top:18px;">Coach's Notes</div>
          <div class="helpText" style="margin-bottom:8px;">Private -- only you see these, never players or parents.</div>
          <div class="drillAddRow">
            <input class="drillFreeInput" id="cnInput" placeholder="e.g. Worked on glove-side footwork today" maxlength="280">
            <button class="btn btnSmall" id="cnAdd">Add</button>
          </div>
          <div class="listBody" style="margin-top:10px;">
            ${notes.length ? notes.map(n => `
              <div class="listRow" style="cursor:default;align-items:flex-start;">
                <div class="listRowMain">
                  <div class="listRowSub" style="margin-bottom:2px;">${escapeHtml(n.date)}</div>
                  <div class="listRowTitle" style="font-weight:400;">${escapeHtml(n.text)}</div>
                </div>
                <button class="btn btnTiny btnGhost" data-cndelete="${n.id}">&times;</button>
              </div>`).join('') : '<div class="emptyState">No notes yet.</div>'}
          </div>`;
        containerEl.querySelector('#cnAdd').addEventListener('click', async () => {
          const input = containerEl.querySelector('#cnInput');
          const text = (input.value || '').trim();
          if (!text) return;
          notes.unshift({ id: 'cn_' + Math.random().toString(36).slice(2, 10), date: new Date().toISOString().slice(0, 10), text });
          await save(teamId);
          refresh();
        });
        containerEl.querySelectorAll('[data-cndelete]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const i = notes.findIndex(n => n.id === btn.dataset.cndelete);
            if (i !== -1) notes.splice(i, 1);
            await save(teamId);
            refresh();
          });
        });
      }
      refresh();
    },
  };
})();
