/* ============================================================
   Practices -- same CRUD/read-only-by-default pattern as
   schedule.js, for practices/batting-cage/film sessions.

   Item shape: {id, type, date, time, location, notes, updatedAt}
   type is one of 'practice' | 'cage' | 'film'.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> items[]

  window.Practices = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const items = await window.dbGet(window.teamPath(teamId, 'practices'));
      cache[teamId] = Array.isArray(items) ? items : [];
      return cache[teamId];
    },
    getItems(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    },
    async saveItem(teamId, item) {
      const list = cache[teamId] || (cache[teamId] = []);
      item.updatedAt = new Date().toISOString();
      const idx = list.findIndex(p => p.id === item.id);
      if (idx === -1) { item.id = item.id || uid('p'); list.push(item); }
      else list[idx] = item;
      await window.dbPut(window.teamPath(teamId, 'practices'), list);
      return item;
    },
    async deleteItem(teamId, id) {
      const list = cache[teamId] || [];
      cache[teamId] = list.filter(p => p.id !== id);
      await window.dbPut(window.teamPath(teamId, 'practices'), cache[teamId]);
    },

    renderList(teamId, containerEl, opts) {
      opts = opts || {};
      const items = window.Practices.getItems(teamId);
      const rows = items.map(p => `
        <div class="listRow" data-id="${escapeHtml(p.id)}">
          <div class="listRowMain">
            <div class="listRowTitle">${TYPE_LABEL[p.type] || 'Practice'}</div>
            <div class="listRowSub">${escapeHtml(p.date || '')}${p.time ? ' · ' + escapeHtml(p.time) : ''}${p.location ? ' · ' + escapeHtml(p.location) : ''}</div>
          </div>
        </div>`).join('') || '<div class="emptyState">No practices scheduled yet.</div>';
      containerEl.innerHTML = `
        <div class="sectionHeader">
          <div></div>
          ${opts.canEdit ? '<button class="btn btnSmall" id="addPracticeBtn">+ Add practice</button>' : ''}
        </div>
        <div class="listBody">${rows}</div>`;
      containerEl.querySelectorAll('.listRow').forEach(row => {
        row.addEventListener('click', () => opts.onOpen && opts.onOpen(row.dataset.id));
      });
      if (opts.canEdit) {
        const addBtn = containerEl.querySelector('#addPracticeBtn');
        if (addBtn) addBtn.addEventListener('click', () => opts.onAdd && opts.onAdd());
      }
    },

    renderDetail(teamId, item, containerEl, opts) {
      opts = opts || {};
      const editing = !!opts.editing;
      if (!editing) {
        containerEl.innerHTML = `
          <div class="detailCard">
            <h3>${TYPE_LABEL[item.type] || 'Practice'}</h3>
            <div class="detailRow">${escapeHtml(item.date || '')}${item.time ? ' · ' + escapeHtml(item.time) : ''}</div>
            ${item.location ? `<div class="detailRow">📍 ${escapeHtml(item.location)}</div>` : ''}
            ${item.notes ? `<div class="detailRow">${escapeHtml(item.notes)}</div>` : ''}
            <div id="weatherSlot"></div>
            ${item.date >= todayIso() ? rsvpHtml(item, opts.viewerName, opts.canEdit) : ''}
            <div class="detailActions">
              ${opts.canEdit ? '<button class="btn" id="editBtn">Edit</button>' : ''}
              <button class="btn btnGhost" id="icsBtn">Add to calendar</button>
              <button class="btn btnGhost" id="backBtn">Back</button>
            </div>
          </div>`;
        const weatherSlot = containerEl.querySelector('#weatherSlot');
        if (weatherSlot && item.location && item.date) window.loadWeatherInto(weatherSlot, item.location, item.date, item.time);
        if (item.date >= todayIso()) wireRsvp(containerEl, item, opts.viewerName, updated => window.Practices.saveItem(teamId, updated), opts.onRsvpChange);
        const editBtn = containerEl.querySelector('#editBtn');
        if (editBtn) editBtn.addEventListener('click', () => opts.onEdit && opts.onEdit());
        containerEl.querySelector('#icsBtn').addEventListener('click', () => {
          const ics = window.buildICS([{
            uid: item.id, title: `${window.TeamConfig.current().shortName} ${TYPE_LABEL[item.type] || 'Practice'}`,
            date: item.date, time: item.time, location: item.location, description: item.notes,
          }]);
          window.downloadICS(`${TYPE_LABEL[item.type] || 'practice'}.ics`, ics);
        });
        containerEl.querySelector('#backBtn').addEventListener('click', () => opts.onBack && opts.onBack());
      } else {
        containerEl.innerHTML = `
          <div class="detailCard">
            <label>Type
              <select id="fType">
                <option value="practice" ${item.type === 'practice' ? 'selected' : ''}>Practice</option>
                <option value="cage" ${item.type === 'cage' ? 'selected' : ''}>Batting Cage</option>
                <option value="film" ${item.type === 'film' ? 'selected' : ''}>Film / Walkthrough</option>
              </select>
            </label>
            <label>Date<input type="date" id="fDate" value="${escapeHtml(item.date || '')}"></label>
            <label>Time<input type="time" id="fTime" value="${escapeHtml(item.time || '')}"></label>
            <label>Location<input id="fLocation" value="${escapeHtml(item.location || '')}"></label>
            <label>Notes<textarea id="fNotes">${escapeHtml(item.notes || '')}</textarea></label>
            <div class="detailActions">
              <button class="btn" id="saveBtn">Save</button>
              <button class="btn btnGhost" id="cancelBtn">Cancel</button>
              ${item.id && opts.onDelete ? '<button class="btn btnDanger" id="deleteBtn">Delete</button>' : ''}
            </div>
          </div>`;
        containerEl.querySelector('#saveBtn').addEventListener('click', btnEvt => {
          const updated = Object.assign({}, item, {
            type: containerEl.querySelector('#fType').value,
            date: containerEl.querySelector('#fDate').value,
            time: containerEl.querySelector('#fTime').value,
            location: containerEl.querySelector('#fLocation').value.trim(),
            notes: containerEl.querySelector('#fNotes').value.trim(),
          });
          if (opts.onSave) withBusyButton(btnEvt.target, 'Saving...', () => opts.onSave(updated));
        });
        containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
        const deleteBtn = containerEl.querySelector('#deleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(item.id));
      }
    },
  };
})();
