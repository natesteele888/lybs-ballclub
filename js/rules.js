/* ============================================================
   Rules reference -- search + "pin for quick reference", over a
   flat array of {id, category, section, text}. Content is MAC
   League's Majors/General/Playoff rules (data/rules-seed.json),
   mirrored into shared/rules in the database the first time any
   device loads this tab (same "seed once, then it's the live
   editable copy" convention ASL Bengals uses for its signal cards
   -- see that app's cloud-auth.js __seedBengalsPlayData and
   coachtools-signals-admin.js). Rules content is shared across
   every team, not per-team, since every LYBS team plays under the
   same league rules.

   Search is a plain case-insensitive substring match over
   category/section/text -- a few dozen rule entries doesn't need
   a search library. "Pin" is stored in localStorage per device,
   same privacy level as a player's remembered position in the ASL
   Bengals app: a quick-reference convenience, not data anyone
   else needs to see.
   ============================================================ */
(function () {
  let cache = null; // rules[]
  const PIN_KEY = 'lybsPinnedRules';

  function getPins() {
    try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function setPins(set) {
    try { localStorage.setItem(PIN_KEY, JSON.stringify([...set])); } catch (e) {}
  }
  function togglePin(id) {
    const pins = getPins();
    if (pins.has(id)) pins.delete(id); else pins.add(id);
    setPins(pins);
    return pins;
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(text.slice(idx + query.length));
  }

  window.Rules = {
    async ensureLoaded() {
      if (cache) return cache;
      let rules = await window.dbGet(window.sharedPath('rules'));
      if (!Array.isArray(rules) || !rules.length) {
        // First-ever load: seed from the shipped file, then mirror it into
        // the database so it becomes the live, admin-editable copy.
        const seed = await fetch('data/rules-seed.json').then(r => r.json()).catch(() => ({ rules: [] }));
        rules = seed.rules || [];
        await window.dbPut(window.sharedPath('rules'), rules);
      }
      cache = rules;
      return cache;
    },

    render(containerEl, opts) {
      opts = opts || {};
      let pins = getPins();
      let query = opts.initialQuery || '';
      let showPinnedOnly = false;

      function matches(r) {
        if (showPinnedOnly && !pins.has(r.id)) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return (r.text || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.section || '').toLowerCase().includes(q);
      }

      function renderList() {
        const filtered = cache.filter(matches);
        const groups = {};
        filtered.forEach(r => {
          const key = `${r.category} — ${r.section}`;
          (groups[key] = groups[key] || []).push(r);
        });
        const groupsHtml = Object.keys(groups).map(key => `
          <div class="rulesGroup">
            <div class="rulesGroupHeader">${escapeHtml(key)}</div>
            ${groups[key].map(r => `
              <div class="ruleItem" data-id="${escapeHtml(r.id)}">
                <div class="ruleText">${highlight(r.text, query)}</div>
                <button class="pinBtn ${pins.has(r.id) ? 'pinned' : ''}" data-id="${escapeHtml(r.id)}" title="Pin for quick reference">${pins.has(r.id) ? '★' : '☆'}</button>
              </div>`).join('')}
          </div>`).join('') || '<div class="emptyState">No rules match that search.</div>';
        listEl.innerHTML = groupsHtml;
        listEl.querySelectorAll('.pinBtn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            pins = togglePin(btn.dataset.id);
            if (showPinnedOnly) {
              renderList();
            } else {
              btn.textContent = pins.has(btn.dataset.id) ? '★' : '☆';
              btn.classList.toggle('pinned', pins.has(btn.dataset.id));
            }
          });
        });
      }

      containerEl.innerHTML = `
        <div class="rulesSearchBar">
          <input id="rulesSearchInput" placeholder="Search rules -- e.g. 'balk', 'mercy', 'pitch count'" value="${escapeHtml(query)}">
          <button class="btn btnGhost btnSmall" id="rulesPinnedToggle">☆ Pinned only</button>
        </div>
        <div class="rulesList" id="rulesListEl"></div>`;
      const listEl = containerEl.querySelector('#rulesListEl');
      const searchInput = containerEl.querySelector('#rulesSearchInput');
      const pinnedToggle = containerEl.querySelector('#rulesPinnedToggle');
      searchInput.addEventListener('input', () => { query = searchInput.value; renderList(); });
      pinnedToggle.addEventListener('click', () => {
        showPinnedOnly = !showPinnedOnly;
        pinnedToggle.classList.toggle('active', showPinnedOnly);
        pinnedToggle.textContent = showPinnedOnly ? '★ Pinned only' : '☆ Pinned only';
        renderList();
      });
      renderList();
    },
  };
})();
