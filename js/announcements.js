/* ============================================================
   Announcements -- a coach-only bulletin board shown at the top of
   Home, for the one-off note that doesn't belong anywhere else
   ("practice moved to 6pm", "bring water, it's hot today"). Same
   coach-edits/everyone-reads shape as Depth Chart and Lineups, just
   text instead of a roster assignment.

   Shows the 3 most recent; older ones stay in storage (so nothing's
   silently lost) but fall out of view rather than growing an
   unbounded list on Home. No expiry logic -- a coach deletes a note
   once it's stale the same way they'd delete anything else here.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> items[]

  function fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  window.Announcements = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const items = await window.dbGet(window.teamPath(teamId, 'announcements'));
      cache[teamId] = Array.isArray(items) ? items : [];
      return cache[teamId];
    },
    getItems(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },
    async addItem(teamId, text, authorName) {
      const list = cache[teamId] || (cache[teamId] = []);
      const item = { id: uid('a'), text: text.trim(), authorName: authorName || '', createdAt: new Date().toISOString() };
      list.unshift(item);
      await window.dbPut(window.teamPath(teamId, 'announcements'), list);
      return item;
    },
    async deleteItem(teamId, id) {
      const list = cache[teamId] || [];
      cache[teamId] = list.filter(a => a.id !== id);
      await window.dbPut(window.teamPath(teamId, 'announcements'), cache[teamId]);
    },
    async editItem(teamId, id, text) {
      const list = cache[teamId] || [];
      const item = list.find(a => a.id === id);
      if (!item) return;
      item.text = text.trim();
      await window.dbPut(window.teamPath(teamId, 'announcements'), list);
    },

    // Mounted directly into a slot on Home -- not a nav tab, same
    // reasoning as topBarShareBtn's modal: there's nowhere else a coach
    // would go looking to post one, and nothing to browse once it's up.
    render(containerEl, teamId, opts) {
      opts = opts || {};
      function refresh() {
        const items = window.Announcements.getItems(teamId).slice(0, 3);
        containerEl.innerHTML = `
          ${items.length ? `<div class="listBody">${items.map(a => `
            <div class="listRow" style="cursor:default;align-items:flex-start;">
              <div class="listRowMain">
                <div class="listRowTitle" style="font-weight:500;">${escapeHtml(a.text)}</div>
                <div class="listRowSub">${escapeHtml(a.authorName || 'Coach')} &middot; ${escapeHtml(fmtWhen(a.createdAt))}</div>
              </div>
              ${opts.canEdit ? `
                <div style="display:flex;gap:6px;flex:0 0 auto;">
                  <button class="btn btnTiny btnGhost" data-edit="${escapeHtml(a.id)}" title="Edit">&#9998;</button>
                  <button class="btn btnTiny" data-del="${escapeHtml(a.id)}" title="Remove">&times;</button>
                </div>` : ''}
            </div>`).join('')}</div>` : ''}
          ${opts.canEdit ? `
            <div class="calAddRow" style="margin-top:${items.length ? '10px' : '0'};">
              <input class="drillFreeInput" id="annText" placeholder="Practice moved to 6pm, bring water...">
              <button class="btn btnSmall" id="annAdd">Post</button>
            </div>` : ''}`;
        containerEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this announcement?')) return;
            await window.Announcements.deleteItem(teamId, btn.dataset.del);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.edit;
            const current = window.Announcements.getItems(teamId).find(a => a.id === id);
            if (!current) return;
            const text = prompt('Edit announcement:', current.text);
            if (!text || !text.trim()) return;
            await window.Announcements.editItem(teamId, id, text);
            refresh();
          });
        });
        const addBtn = containerEl.querySelector('#annAdd');
        const input = containerEl.querySelector('#annText');
        if (addBtn) {
          addBtn.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return;
            await window.Announcements.addItem(teamId, text, opts.authorName);
            input.value = '';
            refresh();
          });
        }
        if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
      }
      refresh();
    },
  };
})();
