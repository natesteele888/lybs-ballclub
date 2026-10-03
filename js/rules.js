/* ============================================================
   Rules reference -- search + division filter + "pin for quick
   reference", over a flat array of {id, division, category,
   section, text}. Content is MAC League's full set of division
   rulebooks (Rookies/Minors/Majors/Juniors & Seniors) plus
   General/Playoff/Operating Guidelines/All-Stars Information
   (data/rules-seed.json), mirrored into shared/rules in the
   database the first time any device loads this tab (same "seed
   once, then it's the live editable copy" convention ASL Bengals
   uses for its signal cards -- see that app's cloud-auth.js
   __seedBengalsPlayData and coachtools-signals-admin.js). Rules
   content is shared across every team, not per-team, since every
   LYBS team plays under the same league rulebooks.

   Rules get amended mid-season (several entries below carry the
   league's own "(Updated .../changed on ...)" notes) and the
   divisional rulebooks themselves get re-issued each year -- see
   rules-seed.json's top-level "season" field. Re-pull from
   macleague.org/coaching-resources/ at least once each offseason.

   Division filter: picking a specific division (e.g. "Majors")
   shows that division's rules PLUS the "All" (general/league-wide)
   ones, since those apply no matter which division you coach --
   matching how the league's own pages frame it ("in addition to
   the common MAC League General Rules"). "All divisions" shows
   everything, unfiltered; selecting "All" on its own shows just the
   general/cross-cutting rules in isolation. The selection is
   remembered per device, same as the pin list below.

   Search is a plain case-insensitive substring match over
   category/section/text -- a hundred-odd rule entries doesn't need
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
      const DIVISION_KEY = 'lybsRulesDivision';
      let division = (function () { try { return localStorage.getItem(DIVISION_KEY) || ''; } catch (e) { return ''; } })();
      const divisions = [...new Set(cache.map(r => r.division))].sort();

      function matches(r) {
        if (showPinnedOnly && !pins.has(r.id)) return false;
        if (division === 'All' && r.division !== 'All') return false;
        if (division && division !== 'All' && r.division !== division && r.division !== 'All') return false;
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

      const divisionOptions = [`<option value="">All divisions</option>`]
        .concat(divisions.map(d => `<option value="${escapeHtml(d)}" ${division === d ? 'selected' : ''}>${d === 'All' ? 'General (all divisions)' : escapeHtml(d)}</option>`));

      containerEl.innerHTML = `
        <div class="rulesSearchBar">
          <input id="rulesSearchInput" placeholder="Search rules -- e.g. 'balk', 'mercy', 'pitch count'" value="${escapeHtml(query)}">
          <button class="btn btnGhost btnSmall" id="rulesPinnedToggle">☆ Pinned only</button>
        </div>
        <div class="rulesSearchBar">
          <select id="rulesDivisionSelect">${divisionOptions.join('')}</select>
        </div>
        <div class="rulesList" id="rulesListEl"></div>`;
      const listEl = containerEl.querySelector('#rulesListEl');
      const searchInput = containerEl.querySelector('#rulesSearchInput');
      const pinnedToggle = containerEl.querySelector('#rulesPinnedToggle');
      const divisionSelect = containerEl.querySelector('#rulesDivisionSelect');
      searchInput.addEventListener('input', () => { query = searchInput.value; renderList(); });
      pinnedToggle.addEventListener('click', () => {
        showPinnedOnly = !showPinnedOnly;
        pinnedToggle.classList.toggle('active', showPinnedOnly);
        pinnedToggle.textContent = showPinnedOnly ? '★ Pinned only' : '☆ Pinned only';
        renderList();
      });
      divisionSelect.addEventListener('change', () => {
        division = divisionSelect.value;
        try { localStorage.setItem(DIVISION_KEY, division); } catch (e) {}
        renderList();
      });
      renderList();
    },
  };
})();
