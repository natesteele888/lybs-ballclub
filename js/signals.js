/* ============================================================
   Signal Library -- a coach-maintained set of hand signals (short
   name + what it means), organized into SETS so last week's signals
   aren't lost when this week's are defined. A set is scoped to a
   single game, a week, or a season -- a dropdown at creation, not
   three separate features.

   Stored at teams/{teamId}/signalSets = [{id, label, scope:
   'game'|'week'|'season', scopeRef, signals: [{id, name,
   description}]}]. scopeRef is free text (e.g. "vs Townsend Ashby
   10/18" for a game, "Week of 10/14" for a week, "Fall 2026" for a
   season) -- same "plain string, not a real foreign key" choice
   js/practice-plan.js's own plans[].date already makes, not worth
   wiring to a real game id for a first pass.

   Same CRUD shape as js/equipment.js / js/practice-plan.js: a
   list-of-sets view, a detail view per set with its own add/remove
   list of signals inside. Coach-write (database.rules.json), and
   reached only through a COACH_ONLY_TABS-gated nav tab in this
   phase -- every signed-in viewer CAN read teams/{teamId}/signalSets
   (same team-read as everything else here), but a compact read-only
   surface for players/parents is deliberately deferred to a later
   phase rather than guessed at now (see the project plan). Delete
   confirmations go through window.confirmModal, not native confirm(),
   from day one.
   ============================================================ */
(function () {
  const SCOPES = ['game', 'week', 'season'];
  const SCOPE_LABEL = { game: 'Game', week: 'Week', season: 'Season' };
  const SCOPE_PLACEHOLDER = { game: 'e.g. vs Townsend Ashby 10/18', week: 'e.g. Week of 10/14', season: 'e.g. Fall 2026' };

  const cache = {}; // teamId -> signalSets[]
  const pending = {}; // teamId -> in-flight ensureLoaded() promise

  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const data = await window.dbGet(window.teamPath(teamId, 'signalSets'));
        cache[teamId] = Array.isArray(data) ? data : [];
        return cache[teamId];
      } finally {
        delete pending[teamId];
      }
    })();
    return pending[teamId];
  }
  async function save(teamId, sets) {
    cache[teamId] = sets;
    await window.dbPut(window.teamPath(teamId, 'signalSets'), sets);
  }

  window.Signals = {
    ensureLoaded,

    render(containerEl, teamId) {
      const sets = cache[teamId] || [];
      let view = { mode: 'list' };
      let addingSignal = false;
      // Same pattern as js/lineup-builder.js's/js/practice-plan.js's own
      // unsavedIds: a set created by #sigNew but abandoned via #sigBack
      // without ever getting a label, a scope reference, or a signal gets
      // discarded instead of persisted as an empty "Untitled set".
      const unsavedIds = new Set();

      function setRowHtml(s) {
        return `
          <div class="listRow" data-id="${escapeHtml(s.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(s.label || 'Untitled set')}</div>
              <div class="listRowSub">${escapeHtml(SCOPE_LABEL[s.scope] || s.scope)}${s.scopeRef ? ' &middot; ' + escapeHtml(s.scopeRef) : ''} &middot; ${s.signals.length} signal${s.signals.length === 1 ? '' : 's'}</div>
            </div>
          </div>`;
      }

      function listHtml() {
        return `
          <div class="drillHero">
            <div class="drillHeroTitle">Signal Library</div>
            <div class="drillHeroSub">Hand signals, organized by game, week, or season.</div>
          </div>
          <button class="btn" id="sigNew" style="width:100%;margin-bottom:14px;">+ New signal set</button>
          <div class="listBody">${sets.map(setRowHtml).join('') || '<div class="emptyState">No signal sets yet.</div>'}</div>`;
      }

      function signalRowHtml(sig) {
        return `
          <div class="listRow" style="cursor:default;align-items:flex-start;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(sig.name)}</div>
              ${sig.description ? `<div class="listRowSub">${escapeHtml(sig.description)}</div>` : ''}
            </div>
            <button class="btn btnTiny btnGhost" data-sigremove="${escapeHtml(sig.id)}">&times;</button>
          </div>`;
      }

      function addSignalRowHtml() {
        if (!addingSignal) {
          return `<button class="btn btnSmall btnGhost" id="sigAddBtn" style="width:100%;margin-top:10px;">+ Add signal</button>`;
        }
        // Stacked, not the usual single-line input-plus-button drillAddRow --
        // that row has to fit an input AND a button; this one has to fit TWO
        // inputs AND a button. At phone width flex-wrap alone just shrank
        // the inputs down to an unreadable sliver instead of ever actually
        // wrapping (plain text inputs have no natural minimum width to force
        // it), so each field gets its own full-width row instead, matching
        // the Label/Week-reference fields already above this one.
        return `
          <div style="margin-top:10px;">
            <label class="drillFieldLabel">Signal
              <input class="drillFreeInput" id="sigNameInput" placeholder="e.g. Touch cap" maxlength="40" autofocus>
            </label>
            <label class="drillFieldLabel" style="margin-top:8px;">What it means
              <input class="drillFreeInput" id="sigDescInput" placeholder="e.g. Bunt" maxlength="80">
            </label>
            <button class="btn btnSmall" id="sigSaveBtn" style="width:100%;margin-top:10px;">Add</button>
          </div>`;
      }

      function detailHtml(s) {
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="sigBack">&larr; Signal Library</button>
          </div>
          <label class="drillFieldLabel">Label
            <input class="drillFreeInput" id="sigLabel" value="${escapeHtml(s.label || '')}" placeholder="e.g. This week's signals">
          </label>
          <div class="drillFieldLabel" style="margin-top:10px;">Scope</div>
          <div class="drillChipRow" style="margin-bottom:10px;">
            ${SCOPES.map(sc => `<button class="drillChip ${s.scope === sc ? 'drillChipOn' : ''}" data-sigscope="${sc}" aria-pressed="${s.scope === sc}">${escapeHtml(SCOPE_LABEL[sc])}</button>`).join('')}
          </div>
          <label class="drillFieldLabel">${escapeHtml(SCOPE_LABEL[s.scope])} reference
            <input class="drillFreeInput" id="sigScopeRef" value="${escapeHtml(s.scopeRef || '')}" placeholder="${escapeHtml(SCOPE_PLACEHOLDER[s.scope])}">
          </label>
          <div class="sectionLabel" style="margin-top:16px;">Signals</div>
          <div class="listBody">${s.signals.map(signalRowHtml).join('') || '<div class="emptyState">No signals in this set yet.</div>'}</div>
          ${addSignalRowHtml()}
          <div class="sectionHeader" style="margin-top:16px;">
            <button class="btn btnDanger" id="sigDelete">Delete set</button>
          </div>`;
      }

      function refresh() {
        if (view.mode === 'list') {
          containerEl.innerHTML = listHtml();
          containerEl.querySelector('#sigNew').addEventListener('click', () => {
            const s = { id: uid('sig'), label: '', scope: 'week', scopeRef: '', signals: [] };
            sets.unshift(s);
            unsavedIds.add(s.id);
            view = { mode: 'detail', id: s.id };
            addingSignal = false;
            refresh();
          });
          containerEl.querySelectorAll('.listRow').forEach(row => {
            row.addEventListener('click', () => { view = { mode: 'detail', id: row.dataset.id }; addingSignal = false; refresh(); });
          });
          return;
        }

        const s = sets.find(x => x.id === view.id);
        if (!s) { view = { mode: 'list' }; refresh(); return; }
        containerEl.innerHTML = detailHtml(s);

        containerEl.querySelector('#sigBack').addEventListener('click', async () => {
          s.label = containerEl.querySelector('#sigLabel').value.trim();
          s.scopeRef = containerEl.querySelector('#sigScopeRef').value.trim();
          const hasContent = s.label || s.scopeRef || s.signals.length;
          // Persisted below either way, not just filtered locally -- the
          // scope-chip, remove-signal and add-signal handlers all call
          // save() unconditionally, so a set that briefly had a signal
          // added and then removed again before Back was tapped already
          // has a real (if now-empty) record in the backend from that
          // round trip; a local-only splice would leave that ghost both in
          // cache[teamId] and in Firestore.
          if (unsavedIds.has(s.id) && !hasContent) {
            const i = sets.findIndex(x => x.id === s.id);
            if (i !== -1) sets.splice(i, 1);
          } else {
            unsavedIds.delete(s.id);
          }
          await save(teamId, sets);
          view = { mode: 'list' }; refresh();
        });
        containerEl.querySelector('#sigLabel').addEventListener('change', e => { s.label = e.target.value.trim(); });
        containerEl.querySelector('#sigScopeRef').addEventListener('change', e => { s.scopeRef = e.target.value.trim(); });
        containerEl.querySelectorAll('[data-sigscope]').forEach(btn => {
          btn.addEventListener('click', async () => {
            s.scope = btn.dataset.sigscope;
            s.scopeRef = containerEl.querySelector('#sigScopeRef').value.trim();
            await save(teamId, sets);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-sigremove]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await confirmModal('Remove this signal?'))) return;
            const i = s.signals.findIndex(sig => sig.id === btn.dataset.sigremove);
            if (i !== -1) s.signals.splice(i, 1);
            await save(teamId, sets);
            refresh();
          });
        });
        const addBtn = containerEl.querySelector('#sigAddBtn');
        if (addBtn) addBtn.addEventListener('click', () => { addingSignal = true; refresh(); });
        const saveBtn = containerEl.querySelector('#sigSaveBtn');
        if (saveBtn) {
          saveBtn.addEventListener('click', btnEvt => {
            const name = containerEl.querySelector('#sigNameInput').value.trim();
            const description = containerEl.querySelector('#sigDescInput').value.trim();
            addingSignal = false;
            if (!name) { refresh(); return; }
            withBusyButton(btnEvt.target, 'Adding...', async () => {
              s.signals.push({ id: uid('sg'), name, description });
              await save(teamId, sets);
              refresh();
            });
          });
        }
        const deleteBtn = containerEl.querySelector('#sigDelete');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async () => {
            if (!(await confirmModal('Delete this signal set?'))) return;
            const i = sets.findIndex(x => x.id === s.id);
            if (i !== -1) sets.splice(i, 1);
            await save(teamId, sets);
            view = { mode: 'list' }; refresh();
          });
        }
      }
      refresh();
    },
  };
})();
