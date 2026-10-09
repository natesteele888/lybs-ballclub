/* ============================================================
   Practice Plan -- what a coach means to run before practice starts,
   not the live timers/trackers the other three Coaching tools are
   (Around the Horn, Base Running, Pitch Chart all run a drill as it
   happens; this plans which ones and for how long, ahead of time).

   Stored at teams/{teamId}/practicePlans = [{id, name, date, blocks:
   [{id, label, minutes}]}]. Coach-only, same as the rest of the
   Coaching tab -- no separate canEdit check needed since this tool
   is only ever reached from inside that already-gated category.
   ============================================================ */
(function () {
  const PRESETS = ['Warm-up / Stretch', 'Throwing', 'Infield/Outfield', 'Batting Practice', 'Base Running', 'Live BP / Scrimmage', 'Cool-down'];

  const cache = {}; // teamId -> plans[]

  async function ensurePlans(teamId) {
    if (cache[teamId]) return cache[teamId];
    const data = await window.dbGet(window.teamPath(teamId, 'practicePlans'));
    cache[teamId] = Array.isArray(data) ? data : [];
    return cache[teamId];
  }
  // Takes the current array explicitly, rather than reading it back out of
  // cache, because the list gets reassigned (not just mutated) on delete --
  // see the #ppDelete handler below. Updates the cache to match.
  async function savePlans(teamId, plans) {
    cache[teamId] = plans;
    await window.dbPut(window.teamPath(teamId, 'practicePlans'), plans);
  }
  function totalMinutes(plan) {
    return (plan.blocks || []).reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
  }

  window.PracticePlan = {
    async render(containerEl, teamId) {
      let plans = await ensurePlans(teamId);
      let view = { mode: 'list' };
      let addingCustom = false;

      function listHtml() {
        const rows = plans.map(p => `
          <div class="listRow" data-id="${escapeHtml(p.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(p.name || 'Untitled plan')}</div>
              <div class="listRowSub">${escapeHtml(p.date || '')} &middot; ${p.blocks.length} block${p.blocks.length === 1 ? '' : 's'} &middot; ${totalMinutes(p)} min</div>
            </div>
          </div>`).join('');
        return `
          <div class="drillHero">
            <div class="drillHeroTitle">Practice Plan</div>
            <div class="drillHeroSub">What to run and for how long -- plan it here, run it with the drill tools above.</div>
          </div>
          <button class="btn" id="ppNew" style="width:100%;margin-bottom:14px;">+ New plan</button>
          <div class="listBody">${rows || '<div class="emptyState">No practice plans saved yet.</div>'}</div>`;
      }

      function blockRow(block, i, total) {
        return `
          <div class="listRow" style="cursor:default;">
            <div class="depthRank">${i + 1}</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(block.label)}</div>
            </div>
            <input class="drillFreeInput" type="number" min="0" step="5" value="${escapeHtml(String(block.minutes || 0))}" data-minutes="${i}" style="width:64px;text-align:center;flex:0 0 auto;">
            <div class="depthRowActions">
              <button class="btn btnTiny" data-blockup="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
              <button class="btn btnTiny" data-blockdown="${i}" ${i === total - 1 ? 'disabled' : ''}>&darr;</button>
              <button class="btn btnTiny" data-blockremove="${i}">&times;</button>
            </div>
          </div>`;
      }

      function addBlockRowHtml() {
        if (!addingCustom) {
          return `
            <div class="sectionLabel" style="margin-top:14px;">Add Block</div>
            <div class="drillChipRow">
              ${PRESETS.map(p => `<button class="drillChip" data-addpreset="${escapeHtml(p)}">+ ${escapeHtml(p)}</button>`).join('')}
              <button class="drillChip" id="ppAddCustom">+ Custom&hellip;</button>
            </div>`;
        }
        return `
          <div class="sectionLabel" style="margin-top:14px;">Add Block</div>
          <div class="drillAddRow">
            <input class="drillFreeInput" id="ppCustomInput" placeholder="Block name, e.g. Bunt Defense" maxlength="40" autofocus>
            <button class="btn btnSmall" id="ppCustomSave">Add</button>
          </div>`;
      }

      function editHtml(p) {
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="ppBack">&larr; Plans</button>
            <div class="recordLine">${totalMinutes(p)} min total</div>
          </div>
          <label class="drillFieldLabel">Name
            <input class="drillFreeInput" id="ppName" value="${escapeHtml(p.name || '')}" placeholder="e.g. Tuesday practice">
          </label>
          <label class="drillFieldLabel" style="margin-top:10px;">Date
            <input class="drillFreeInput" id="ppDate" type="date" value="${escapeHtml(p.date || '')}">
          </label>
          <div class="sectionLabel" style="margin-top:16px;">Blocks</div>
          <div id="ppBlocks">${p.blocks.map((b, i) => blockRow(b, i, p.blocks.length)).join('') || '<div class="emptyState">No blocks yet.</div>'}</div>
          ${addBlockRowHtml()}
          <div class="sectionHeader" style="margin-top:16px;">
            <button class="btn" id="ppSave">Save plan</button>
            <button class="btn btnDanger" id="ppDelete">Delete</button>
          </div>`;
      }

      function refresh() {
        if (view.mode === 'list') {
          containerEl.innerHTML = listHtml();
          containerEl.querySelector('#ppNew').addEventListener('click', () => {
            const p = { id: uid('pp'), name: '', date: new Date().toISOString().slice(0, 10), blocks: [] };
            plans.unshift(p);
            view = { mode: 'edit', id: p.id };
            addingCustom = false;
            refresh();
          });
          containerEl.querySelectorAll('.listRow').forEach(row => {
            row.addEventListener('click', () => { view = { mode: 'edit', id: row.dataset.id }; addingCustom = false; refresh(); });
          });
        } else {
          const p = plans.find(x => x.id === view.id);
          if (!p) { view = { mode: 'list' }; refresh(); return; }
          containerEl.innerHTML = editHtml(p);
          containerEl.querySelector('#ppBack').addEventListener('click', async () => {
            p.name = containerEl.querySelector('#ppName').value.trim();
            p.date = containerEl.querySelector('#ppDate').value;
            await savePlans(teamId, plans);
            view = { mode: 'list' }; refresh();
          });
          containerEl.querySelector('#ppName').addEventListener('change', e => { p.name = e.target.value.trim(); });
          containerEl.querySelector('#ppDate').addEventListener('change', e => { p.date = e.target.value; });
          containerEl.querySelectorAll('[data-minutes]').forEach(input => {
            input.addEventListener('change', async () => {
              p.blocks[Number(input.dataset.minutes)].minutes = Math.max(0, Number(input.value) || 0);
              await savePlans(teamId, plans);
              refresh();
            });
          });
          containerEl.querySelectorAll('[data-blockup]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const i = Number(btn.dataset.blockup);
              [p.blocks[i - 1], p.blocks[i]] = [p.blocks[i], p.blocks[i - 1]];
              await savePlans(teamId, plans); refresh();
            });
          });
          containerEl.querySelectorAll('[data-blockdown]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const i = Number(btn.dataset.blockdown);
              [p.blocks[i + 1], p.blocks[i]] = [p.blocks[i], p.blocks[i + 1]];
              await savePlans(teamId, plans); refresh();
            });
          });
          containerEl.querySelectorAll('[data-blockremove]').forEach(btn => {
            btn.addEventListener('click', async () => {
              p.blocks.splice(Number(btn.dataset.blockremove), 1);
              await savePlans(teamId, plans); refresh();
            });
          });
          containerEl.querySelectorAll('[data-addpreset]').forEach(btn => {
            btn.addEventListener('click', async () => {
              p.blocks.push({ id: uid('blk'), label: btn.dataset.addpreset, minutes: 10 });
              await savePlans(teamId, plans); refresh();
            });
          });
          const customBtn = containerEl.querySelector('#ppAddCustom');
          if (customBtn) customBtn.addEventListener('click', () => { addingCustom = true; refresh(); });
          const customSave = containerEl.querySelector('#ppCustomSave');
          if (customSave) {
            customSave.addEventListener('click', async () => {
              const input = containerEl.querySelector('#ppCustomInput');
              const label = (input.value || '').trim();
              addingCustom = false;
              if (label) { p.blocks.push({ id: uid('blk'), label, minutes: 10 }); await savePlans(teamId, plans); }
              refresh();
            });
          }
          containerEl.querySelector('#ppSave').addEventListener('click', async btnEvt => {
            p.name = containerEl.querySelector('#ppName').value.trim();
            p.date = containerEl.querySelector('#ppDate').value;
            await withBusyButton(btnEvt.target, 'Saving...', () => savePlans(teamId, plans));
            btnEvt.target.textContent = 'Saved!';
            setTimeout(() => refresh(), 500);
          });
          containerEl.querySelector('#ppDelete').addEventListener('click', async () => {
            if (!confirm('Delete this practice plan?')) return;
            plans = plans.filter(x => x.id !== p.id);
            await savePlans(teamId, plans);
            view = { mode: 'list' }; refresh();
          });
        }
      }
      refresh();
    },
  };
})();
