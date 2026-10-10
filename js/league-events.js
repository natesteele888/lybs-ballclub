/* ============================================================
   League Events -- org-wide announcements (an annual meeting, a
   league-wide date), not scoped to any one team. Same coach-edits/
   everyone-reads shape as js/announcements.js, just board-authored
   instead of coach-authored, and shown everywhere instead of on one
   team's home screen: every team's Home, the public view
   (js/public-view.js), and a board-only "League Events" tab (see
   index.html's BOARD_ONLY_TABS).

   Stored at leagueEventsPath() -> 'leagueEvents', a flat array,
   .read:true/board-only .write in database.rules.json -- see that
   file's header comment on why this lives outside teams/{teamId}
   (the opposite reason coachPrivate does: this needs to be LESS
   restrictive than that tree, not more).

   One render(containerEl, opts) function, reused at all three call
   sites above with different opts.canEdit.
   ============================================================ */
(function () {
  let cache = null; // events[]

  function fmtWhen(ev) {
    if (!ev.date) return '';
    const d = new Date(ev.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return ev.time ? `${dateStr} · ${ev.time}` : dateStr;
  }

  window.LeagueEvents = {
    async ensureLoaded() {
      if (cache) return cache;
      const items = await window.dbGet(window.leagueEventsPath());
      cache = Array.isArray(items) ? items : [];
      return cache;
    },
    getItems() {
      return (cache || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    },
    // Past events drop off automatically, same "fall out of view, not
    // silently lost" reasoning announcements.js uses for its 3-item cap --
    // here it's by date rather than a count, since an event's own date is
    // what makes it stop being relevant.
    getUpcoming() {
      const today = todayStr();
      return window.LeagueEvents.getItems().filter(ev => !ev.date || ev.date >= today);
    },
    async addItem(event) {
      const list = cache || (cache = []);
      const item = Object.assign({ id: uid('le'), createdAt: new Date().toISOString() }, event);
      list.push(item);
      await window.dbPut(window.leagueEventsPath(), list);
      return item;
    },
    async saveItem(event) {
      const list = cache || (cache = []);
      const idx = list.findIndex(e => e.id === event.id);
      if (idx === -1) list.push(event);
      else list[idx] = event;
      await window.dbPut(window.leagueEventsPath(), list);
      return event;
    },
    async deleteItem(id) {
      const list = cache || [];
      cache = list.filter(e => e.id !== id);
      await window.dbPut(window.leagueEventsPath(), cache);
    },

    render(containerEl, opts) {
      opts = opts || {};
      let editingId = null; // null | 'new' | an event id

      function rowHtml(ev) {
        return `
          <div class="listRow" style="cursor:default;align-items:flex-start;">
            <div class="listRowMain">
              <div class="listRowTitle" style="font-weight:500;">${escapeHtml(ev.title || 'Untitled')}</div>
              <div class="listRowSub">${escapeHtml(fmtWhen(ev))}${ev.location ? ' &middot; ' + escapeHtml(ev.location) : ''}</div>
              ${ev.description ? `<div class="listRowSub" style="margin-top:4px;">${escapeHtml(ev.description)}</div>` : ''}
            </div>
            ${opts.canEdit ? `
              <div style="display:flex;gap:6px;flex:0 0 auto;">
                <button class="btn btnTiny btnGhost" data-edit="${escapeHtml(ev.id)}" title="Edit">&#9998;</button>
                <button class="btn btnTiny" data-del="${escapeHtml(ev.id)}" title="Remove">&times;</button>
              </div>` : ''}
          </div>`;
      }

      function formHtml(ev) {
        ev = ev || { title: '', date: '', time: '', location: '', description: '' };
        return `
          <div class="detailCard" style="margin-top:10px;">
            <label>Title<input id="leTitle" value="${escapeHtml(ev.title || '')}" placeholder="LYBS Annual Meeting"></label>
            <label>Date<input type="date" id="leDate" value="${escapeHtml(ev.date || '')}"></label>
            <label>Time<input type="time" id="leTime" value="${escapeHtml(ev.time || '')}"></label>
            <label>Location<input id="leLocation" value="${escapeHtml(ev.location || '')}" placeholder="Lunenburg Library, Wallace Community Room"></label>
            <label>Description<textarea id="leDescription">${escapeHtml(ev.description || '')}</textarea></label>
            <div class="detailActions">
              <button class="btn" id="leSaveBtn">Save</button>
              <button class="btn btnGhost" id="leCancelBtn">Cancel</button>
              ${ev.id ? '<button class="btn btnDanger" id="leDeleteBtn">Delete</button>' : ''}
            </div>
          </div>`;
      }

      function refresh() {
        const items = window.LeagueEvents.getUpcoming();
        const editingEvent = editingId && editingId !== 'new' ? items.find(e => e.id === editingId) : null;
        containerEl.innerHTML = `
          ${items.length ? `<div class="listBody">${items.map(rowHtml).join('')}</div>` : '<div class="emptyState">No upcoming league events.</div>'}
          ${opts.canEdit && editingId ? formHtml(editingEvent) : ''}
          ${opts.canEdit && !editingId ? '<button class="btn btnSmall" id="leAddBtn" style="width:100%;margin-top:10px;">+ Add league event</button>' : ''}`;

        containerEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this league event?')) return;
            await window.LeagueEvents.deleteItem(btn.dataset.del);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', () => { editingId = btn.dataset.edit; refresh(); });
        });
        const addBtn = containerEl.querySelector('#leAddBtn');
        if (addBtn) addBtn.addEventListener('click', () => { editingId = 'new'; refresh(); });

        const saveBtn = containerEl.querySelector('#leSaveBtn');
        if (saveBtn) {
          saveBtn.addEventListener('click', btnEvt => {
            const event = Object.assign({}, editingEvent, {
              title: containerEl.querySelector('#leTitle').value.trim(),
              date: containerEl.querySelector('#leDate').value,
              time: containerEl.querySelector('#leTime').value,
              location: containerEl.querySelector('#leLocation').value.trim(),
              description: containerEl.querySelector('#leDescription').value.trim(),
              createdByName: (editingEvent && editingEvent.createdByName) || opts.authorName,
            });
            withBusyButton(btnEvt.target, 'Saving...', async () => {
              if (editingEvent) await window.LeagueEvents.saveItem(event);
              else await window.LeagueEvents.addItem(event);
              editingId = null;
              refresh();
            });
          });
        }
        const cancelBtn = containerEl.querySelector('#leCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { editingId = null; refresh(); });
        const deleteBtn = containerEl.querySelector('#leDeleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
          if (!confirm('Delete this league event?')) return;
          await window.LeagueEvents.deleteItem(editingEvent.id);
          editingId = null;
          refresh();
        });
      }
      refresh();
    },
  };
})();
