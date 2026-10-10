/* ============================================================
   Practice Plan -- what a coach means to run before practice starts,
   not the live timers/trackers the other three Coaching tools are
   (Around the Horn, Base Running, Pitch Chart all run a drill as it
   happens; this plans which ones and for how long, ahead of time).

   Stored at teams/{teamId}/practicePlans = [{id, name, date, blocks:
   [{id, label, minutes}]}]. Coach-only, same as the rest of the
   Coaching tab -- no separate canEdit check needed since this tool
   is only ever reached from inside that already-gated category.

   "Add Block" has two sources now: the Drill Library (the primary
   one -- js/practice-catalog.js's league-wide, citation-grounded
   drills, filterable by division/tier/category, searched right here
   without leaving the plan being built) and Quick/Custom (the
   original 7 preset labels + free text, kept for generic one-off
   blocks like "Cool-down" that don't need benchmark/diagram
   richness). A block added from the library carries extra optional
   fields -- benchmarkIds/drillRef/diagramRef/drillId -- that
   blockRow() renders when present; a plain preset/custom block never
   has them and renders exactly as before.
   ============================================================ */
(function () {
  const PRESETS = ['Warm-up / Stretch', 'Throwing', 'Infield/Outfield', 'Batting Practice', 'Base Running', 'Live BP / Scrimmage', 'Cool-down'];
  const TIER_ORDER = ['foundational', 'standard', 'advanced'];
  const TIER_LABEL = { foundational: 'Foundational', standard: 'Standard', advanced: 'Advanced' };
  const TOOL_LABEL = { ath: 'Around the Horn', baserunning: 'Base Running', pitching: 'Pitch Chart' };

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
  function blockFromDrill(drill) {
    return {
      id: uid('blk'), label: drill.title, minutes: drill.suggestedMinutes || 10,
      benchmarkIds: drill.benchmarkIds, drillRef: drill.drillRef, diagramRef: drill.diagramRef, drillId: drill.id,
    };
  }
  // planId falsy -> starts a fresh untitled plan (backs the catalog tab's
  // "+ Add to my Practice Plan" button, which has no plan already in
  // scope); a real id pushes onto that existing plan (backs both that
  // button's "existing plan" choice and the embedded picker below, which
  // always has a plan in scope already).
  async function addDrillToPlan(teamId, planId, drill) {
    const plans = await ensurePlans(teamId);
    let p = planId ? plans.find(x => x.id === planId) : null;
    if (!p) {
      p = { id: uid('pp'), name: '', date: new Date().toISOString().slice(0, 10), blocks: [] };
      plans.unshift(p);
    }
    p.blocks.push(blockFromDrill(drill));
    await savePlans(teamId, plans);
    return p;
  }

  window.PracticePlan = {
    ensurePlans,
    getPlans(teamId) { return cache[teamId] || []; },
    blockFromDrill,
    addDrillToPlan,

    async render(containerEl, teamId) {
      let plans = await ensurePlans(teamId);
      // Loaded here (not just by the Practice Catalog tab) so a block
      // pulled in earlier still has real benchmark names to show, and so
      // the embedded Drill Library picker below has something to list --
      // isBoard=false is safe even if the catalog tab already loaded this
      // session with the real value, since ensureLoaded() memoizes and
      // never re-fetches or downgrades.
      await window.PracticeCatalog.ensureLoaded(false);
      let view = { mode: 'list' };
      let addMode = 'library'; // 'library' | 'custom'
      let addingCustom = false;
      const defaultDivision = (window.TeamConfig.current() || {}).macLeagueDivisionName || null;
      let libFilter = { division: defaultDivision, tiers: new Set(TIER_ORDER), category: null, query: '' };

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
            <div class="drillHeroSub">Plan what to run and for how long.</div>
          </div>
          <button class="btn" id="ppNew" style="width:100%;margin-bottom:14px;">+ New plan</button>
          <div class="listBody">${rows || '<div class="emptyState">No practice plans saved yet.</div>'}</div>`;
      }

      function benchmarksById() {
        const map = {};
        window.PracticeCatalog.getBenchmarks().forEach(b => { map[b.id] = b; });
        return map;
      }

      function blockRow(block, i, total) {
        const bById = benchmarksById();
        const chips = (block.benchmarkIds || []).map(id => bById[id]).filter(Boolean)
          .map(b => `<span class="badge badgeTbd">${escapeHtml(b.skill)}</span>`).join('');
        const diagram = block.diagramRef ? `
          <div class="depthField" style="max-width:220px;margin-top:8px;">${window.DepthChart.fieldSvg()}${(block.diagramRef.markers || []).map(m => `
            <div class="pdMarker" style="left:${m.x}%;top:${m.y}%;cursor:default;"><span class="pdMarkerDot"></span><span class="pdMarkerLabel">${escapeHtml(m.label)}</span></div>`).join('')}</div>` : '';
        const jumpBtn = block.drillRef ? `<button class="btn btnGhost btnTiny" style="margin-top:6px;" data-blockjump="${escapeHtml(block.drillRef.tool)}">Open in ${escapeHtml(TOOL_LABEL[block.drillRef.tool] || block.drillRef.tool)} &rarr;</button>` : '';
        return `
          <div class="listRow" style="cursor:default;align-items:flex-start;flex-wrap:wrap;">
            <div class="depthRank">${i + 1}</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(block.label)}</div>
              ${chips ? `<div class="drillChipRow" style="margin-top:4px;">${chips}</div>` : ''}
              ${diagram}
              ${jumpBtn}
            </div>
            <input class="drillFreeInput" type="number" min="0" step="5" value="${escapeHtml(String(block.minutes || 0))}" data-minutes="${i}" style="width:64px;text-align:center;flex:0 0 auto;">
            <div class="depthRowActions">
              <button class="btn btnTiny" data-blockup="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
              <button class="btn btnTiny" data-blockdown="${i}" ${i === total - 1 ? 'disabled' : ''}>&darr;</button>
              <button class="btn btnTiny" data-blockremove="${i}">&times;</button>
            </div>
          </div>`;
      }

      function libraryPickerHtml() {
        const all = window.PracticeCatalog.getDrills();
        const divisions = [...new Set(all.map(d => d.division))];
        const inDivision = all.filter(d => d.division === libFilter.division);
        const categories = [...new Set(inDivision.map(d => d.category))];
        const q = libFilter.query.toLowerCase();
        const matched = inDivision.filter(d =>
          libFilter.tiers.has(d.tier) &&
          (!libFilter.category || d.category === libFilter.category) &&
          (!q || d.title.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
        );
        const rows = matched.map(d => `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(d.title)}</div>
              <div class="listRowSub">${escapeHtml(d.category)} &middot; ${escapeHtml(TIER_LABEL[d.tier] || d.tier)} &middot; ${d.suggestedMinutes} min</div>
            </div>
            <button class="btn btnSmall" data-adddrill="${escapeHtml(d.id)}">+ Add</button>
          </div>`).join('') || '<div class="emptyState">No drills match this filter yet.</div>';
        return `
          <div class="drillAddRow" style="margin-bottom:8px;">
            <input class="drillFreeInput" id="ppLibSearch" placeholder="Search drills..." value="${escapeHtml(libFilter.query)}">
          </div>
          <div class="drillChipRow" style="margin-bottom:6px;">
            ${divisions.map(d => `<button class="drillChip ${libFilter.division === d ? 'drillChipOn' : ''}" data-libdivision="${escapeHtml(d)}">${escapeHtml(d)}</button>`).join('')}
          </div>
          <div class="drillChipRow" style="margin-bottom:6px;">
            ${TIER_ORDER.map(t => `<button class="drillChip ${libFilter.tiers.has(t) ? 'drillChipOn' : ''}" data-libtier="${t}">${escapeHtml(TIER_LABEL[t])}</button>`).join('')}
          </div>
          <div class="drillChipRow" style="margin-bottom:10px;">
            <button class="drillChip ${!libFilter.category ? 'drillChipOn' : ''}" data-libcategory="">All categories</button>
            ${categories.map(c => `<button class="drillChip ${libFilter.category === c ? 'drillChipOn' : ''}" data-libcategory="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
          </div>
          <div class="listBody">${rows}</div>`;
      }

      function addBlockRowHtml() {
        const modeToggle = `
          <div class="coachingToggle" style="margin-top:14px;margin-bottom:10px;">
            <button class="btn btnSmall ${addMode === 'library' ? '' : 'btnGhost'}" data-addmode="library">Drill Library</button>
            <button class="btn btnSmall ${addMode === 'custom' ? '' : 'btnGhost'}" data-addmode="custom">Quick / Custom</button>
          </div>`;
        if (addMode === 'library') {
          return `<div class="sectionLabel" style="margin-top:14px;">Add Block</div>${modeToggle}${libraryPickerHtml()}`;
        }
        if (!addingCustom) {
          return `
            <div class="sectionLabel" style="margin-top:14px;">Add Block</div>
            ${modeToggle}
            <div class="drillChipRow">
              ${PRESETS.map(p => `<button class="drillChip" data-addpreset="${escapeHtml(p)}">+ ${escapeHtml(p)}</button>`).join('')}
              <button class="drillChip" id="ppAddCustom">+ Custom&hellip;</button>
            </div>`;
        }
        return `
          <div class="sectionLabel" style="margin-top:14px;">Add Block</div>
          ${modeToggle}
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
          containerEl.querySelectorAll('[data-blockjump]').forEach(btn => {
            btn.addEventListener('click', () => window.openCoachingTool(btn.dataset.blockjump));
          });
          containerEl.querySelectorAll('[data-addmode]').forEach(btn => {
            btn.addEventListener('click', () => { addMode = btn.dataset.addmode; addingCustom = false; refresh(); });
          });
          containerEl.querySelectorAll('[data-adddrill]').forEach(btn => {
            btn.addEventListener('click', async () => {
              const drill = window.PracticeCatalog.getDrills().find(d => d.id === btn.dataset.adddrill);
              if (!drill) return;
              p.blocks.push(blockFromDrill(drill));
              await savePlans(teamId, plans); refresh();
            });
          });
          const libSearch = containerEl.querySelector('#ppLibSearch');
          if (libSearch) libSearch.addEventListener('input', e => { libFilter.query = e.target.value; refresh(); });
          containerEl.querySelectorAll('[data-libdivision]').forEach(btn => {
            btn.addEventListener('click', () => { libFilter.division = btn.dataset.libdivision; libFilter.category = null; refresh(); });
          });
          containerEl.querySelectorAll('[data-libtier]').forEach(btn => {
            btn.addEventListener('click', () => {
              const t = btn.dataset.libtier;
              if (libFilter.tiers.has(t) && libFilter.tiers.size > 1) libFilter.tiers.delete(t);
              else libFilter.tiers.add(t);
              refresh();
            });
          });
          containerEl.querySelectorAll('[data-libcategory]').forEach(btn => {
            btn.addEventListener('click', () => { libFilter.category = btn.dataset.libcategory || null; refresh(); });
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
