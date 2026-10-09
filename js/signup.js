/* ============================================================
   Sign-Up Sheets -- potluck-style item claiming for a one-off team
   event (end-of-season party, tournament snacks, ...), not a
   rotation. Different shape from Snack Duty on purpose: duty.js
   auto-assigns one player per game from a standing order, which is
   exactly wrong here -- a party needs a coach-defined list of
   specific things (plates, drinks, a cake) that whoever gets there
   first claims, not an assignment nobody chose.

   Stored at teams/{teamId}/signups = [{id, title,
     items: [{id, name, claimedBy: viewerName|null}]}]. Claiming is
   open to anyone signed in, same reasoning as RSVP/Carpool: a parent
   needs to claim an item without being the coach. Only the coach can
   create/delete a sheet or add/remove an item from one.
   ============================================================ */
(function () {
  const cache = {}; // teamId -> sheets[]

  window.SignUp = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const data = await window.dbGet(window.teamPath(teamId, 'signups'));
      cache[teamId] = Array.isArray(data) ? data : [];
      return cache[teamId];
    },
    async save(teamId) {
      await window.dbPut(window.teamPath(teamId, 'signups'), cache[teamId]);
    },

    render(containerEl, teamId, opts) {
      opts = opts || {};
      let openSheetId = null;

      function listHtml() {
        const sheets = cache[teamId] || [];
        const rows = sheets.map(s => {
          const claimed = s.items.filter(i => i.claimedBy).length;
          return `
            <div class="listRow" data-id="${escapeHtml(s.id)}">
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(s.title)}</div>
                <div class="listRowSub">${claimed}/${s.items.length} claimed</div>
              </div>
            </div>`;
        }).join('') || '<div class="emptyState">No sign-up sheets yet.</div>';
        return `
          <div class="drillHero">
            <div class="drillHeroIcon">📋</div>
            <div class="drillHeroTitle">Sign-Up Sheets</div>
            <div class="drillHeroSub">Who's bringing what for team events -- tap an open item to claim it.</div>
          </div>
          ${opts.canEdit ? '<button class="btn" id="suNew" style="width:100%;margin-bottom:14px;">+ New Sign-Up Sheet</button>' : ''}
          <div class="listBody">${rows}</div>`;
      }

      function detailHtml(sheet) {
        const items = sheet.items.map(i => {
          const mine = i.claimedBy && i.claimedBy === opts.viewerName;
          const canUnclaim = i.claimedBy && (mine || opts.canEdit);
          return `
            <div class="listRow" style="cursor:default;">
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(i.name)}</div>
                <div class="listRowSub">${i.claimedBy ? `Claimed by ${escapeHtml(i.claimedBy)}${mine ? ' (you)' : ''}` : 'Open'}</div>
              </div>
              <div style="display:flex;gap:6px;flex:0 0 auto;">
                ${!i.claimedBy && opts.viewerName ? `<button class="btn btnSmall" data-claim="${escapeHtml(i.id)}">Claim it</button>` : ''}
                ${canUnclaim ? `<button class="btn btnGhost btnTiny" data-unclaim="${escapeHtml(i.id)}">Unclaim</button>` : ''}
                ${opts.canEdit ? `<button class="btn btnTiny" data-removeitem="${escapeHtml(i.id)}" title="Remove item">&times;</button>` : ''}
              </div>
            </div>`;
        }).join('') || '<div class="emptyState">No items yet.</div>';
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="suBack">&larr; Sign-Up Sheets</button>
            ${opts.canEdit ? '<button class="btn btnDanger btnSmall" id="suDeleteSheet">Delete Sheet</button>' : ''}
          </div>
          <h3 style="margin:4px 0 14px;">${escapeHtml(sheet.title)}</h3>
          <div class="listBody">${items}</div>
          ${opts.canEdit ? `
            <div class="calAddRow" style="margin-top:14px;">
              <input class="drillFreeInput" id="suItemInput" placeholder="Add an item, e.g. Juice boxes">
              <button class="btn btnSmall" id="suAddItem">Add</button>
            </div>` : ''}`;
      }

      function refresh() {
        const sheets = cache[teamId] || [];
        const sheet = openSheetId ? sheets.find(s => s.id === openSheetId) : null;
        containerEl.innerHTML = sheet ? detailHtml(sheet) : listHtml();

        if (!sheet) {
          containerEl.querySelectorAll('[data-id]').forEach(row => {
            row.addEventListener('click', () => { openSheetId = row.dataset.id; refresh(); });
          });
          const newBtn = containerEl.querySelector('#suNew');
          if (newBtn) newBtn.addEventListener('click', async () => {
            const title = prompt('Sign-up sheet title (e.g. "End of Season Party"):');
            if (!title || !title.trim()) return;
            const newSheet = { id: uid('su'), title: title.trim(), items: [] };
            sheets.push(newSheet);
            await window.SignUp.save(teamId);
            openSheetId = newSheet.id;
            refresh();
          });
          return;
        }

        containerEl.querySelector('#suBack').addEventListener('click', () => { openSheetId = null; refresh(); });
        const deleteBtn = containerEl.querySelector('#suDeleteSheet');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
          if (!confirm(`Delete "${sheet.title}" and everything on it?`)) return;
          cache[teamId] = sheets.filter(s => s.id !== sheet.id);
          await window.SignUp.save(teamId);
          openSheetId = null;
          refresh();
        });
        containerEl.querySelectorAll('[data-claim]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = sheet.items.find(i => i.id === btn.dataset.claim);
            if (!item || item.claimedBy) return;
            item.claimedBy = opts.viewerName;
            await window.SignUp.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-unclaim]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = sheet.items.find(i => i.id === btn.dataset.unclaim);
            if (!item) return;
            item.claimedBy = null;
            await window.SignUp.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-removeitem]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this item?')) return;
            sheet.items = sheet.items.filter(i => i.id !== btn.dataset.removeitem);
            await window.SignUp.save(teamId);
            refresh();
          });
        });
        const addBtn = containerEl.querySelector('#suAddItem');
        const itemInput = containerEl.querySelector('#suItemInput');
        if (addBtn) {
          addBtn.addEventListener('click', async () => {
            const name = itemInput.value.trim();
            if (!name) return;
            sheet.items.push({ id: uid('si'), name, claimedBy: null });
            await window.SignUp.save(teamId);
            itemInput.value = '';
            refresh();
          });
          itemInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
        }
      }
      refresh();
    },
  };
})();
