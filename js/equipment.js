/* ============================================================
   Team Equipment -- who actually has the gear bag/catcher's gear/
   scorebook right now, as opposed to Snack Duty's rotation (whose
   turn it's SUPPOSED to be). The two drift apart in practice --
   someone forgets a handoff, or ends up keeping the bag because
   they're driving to the next game anyway -- so this is a live,
   self-reported "who has it" state, not a schedule.

   Stored at teams/{teamId}/equipment = [{id, name, holderName}].
   holderName is the viewer's own free-typed identity (Identity.name),
   same as Carpool's driving{} map -- not a roster id, since whoever
   actually has the bag is just as often a parent as a player, and
   this app doesn't track roster-vs-viewer the way Awards does.
   Checking an item in/out is open to any signed-in team member
   (coach or player gate); only adding/removing an item from the
   list is coach-only, same split Sign-Up already uses.
   ============================================================ */
(function () {
  const PRESETS = ['Equipment Bag', "Catcher's Gear", 'Team Balls', 'Scorebook', 'First Aid Kit', 'Pop-Up Net'];

  const cache = {}; // teamId -> equipment[]

  window.Equipment = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const data = await window.dbGet(window.teamPath(teamId, 'equipment'));
      cache[teamId] = Array.isArray(data) ? data : [];
      return cache[teamId];
    },
    async save(teamId) {
      await window.dbPut(window.teamPath(teamId, 'equipment'), cache[teamId]);
    },

    render(containerEl, teamId, opts) {
      opts = opts || {};
      const items = cache[teamId];
      let addingCustom = false;

      function itemHtml(item) {
        const mine = opts.viewerName && item.holderName === opts.viewerName;
        return `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(item.name)}</div>
              <div class="listRowSub">${item.holderName ? `Held by ${escapeHtml(item.holderName)}${mine ? ' (you)' : ''}` : 'Not checked out'}</div>
            </div>
            <div class="depthRowActions">
              ${item.holderName
                ? `<button class="btn btnTiny ${mine ? '' : 'btnGhost'}" data-return="${item.id}">Return it</button>`
                : (opts.viewerName ? `<button class="btn btnTiny" data-takeit="${item.id}">I've got it</button>` : '')}
              ${opts.canEdit ? `<button class="btn btnTiny btnGhost" data-deleteitem="${item.id}">&times;</button>` : ''}
            </div>
          </div>`;
      }

      function addRowHtml() {
        if (!opts.canEdit) return '';
        if (!addingCustom) {
          const used = new Set(items.map(i => i.name));
          const available = PRESETS.filter(p => !used.has(p));
          return `
            <div class="sectionLabel" style="margin-top:18px;">Add Equipment</div>
            <div class="drillChipRow">
              ${available.map(p => `<button class="drillChip" data-addpreset="${escapeHtml(p)}">+ ${escapeHtml(p)}</button>`).join('')}
              <button class="drillChip" id="eqAddCustom">+ Custom&hellip;</button>
            </div>`;
        }
        return `
          <div class="sectionLabel" style="margin-top:18px;">Add Equipment</div>
          <div class="drillAddRow">
            <input class="drillFreeInput" id="eqCustomInput" placeholder="Item name, e.g. Pitching Machine" maxlength="40" autofocus>
            <button class="btn btnSmall" id="eqCustomSave">Add</button>
          </div>`;
      }

      function refresh() {
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">Team Equipment</div>
            <div class="drillHeroSub">Who has the team's gear right now.</div>
          </div>
          <div class="listBody">${items.length ? items.map(itemHtml).join('') : '<div class="emptyState">No equipment tracked yet.</div>'}</div>
          ${addRowHtml()}`;

        containerEl.querySelectorAll('[data-takeit]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = items.find(i => i.id === btn.dataset.takeit);
            if (!item || !opts.viewerName) return;
            item.holderName = opts.viewerName;
            await window.Equipment.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-return]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = items.find(i => i.id === btn.dataset.return);
            if (!item) return;
            delete item.holderName;
            await window.Equipment.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-deleteitem]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this item from the list?')) return;
            const i = items.findIndex(x => x.id === btn.dataset.deleteitem);
            if (i !== -1) items.splice(i, 1);
            await window.Equipment.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-addpreset]').forEach(btn => {
          btn.addEventListener('click', async () => {
            items.push({ id: 'eq_' + Math.random().toString(36).slice(2, 10), name: btn.dataset.addpreset });
            await window.Equipment.save(teamId);
            refresh();
          });
        });
        const customBtn = containerEl.querySelector('#eqAddCustom');
        if (customBtn) customBtn.addEventListener('click', () => { addingCustom = true; refresh(); });
        const customSave = containerEl.querySelector('#eqCustomSave');
        if (customSave) {
          customSave.addEventListener('click', async () => {
            const input = containerEl.querySelector('#eqCustomInput');
            const name = (input.value || '').trim();
            addingCustom = false;
            if (name) {
              items.push({ id: 'eq_' + Math.random().toString(36).slice(2, 10), name });
              await window.Equipment.save(teamId);
            }
            refresh();
          });
        }
      }
      refresh();
    },
  };
})();
