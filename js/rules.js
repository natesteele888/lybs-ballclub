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

   Browsing is category-first, not "every rule expanded at once":
   the tab opens on a menu of the 8 categories (Majors Rules,
   Minors Rules, General Rules, Playoff Rules, ...), each a big
   tappable row with its rule count -- picking one drills into that
   category's rules; a "Categories" back button returns to the
   menu. category and division are the same underlying tag on each
   rule, just phrased differently ("Majors Rules" / "Majors"), so a
   division-specific category still folds in "General Rules" (the
   rules tagged division "All") alongside it, matching how the
   league's own pages frame it ("in addition to the common MAC
   League General Rules") -- General Rules' own category is the one
   place that's just itself, since folding it into itself would
   duplicate every entry.

   Search bypasses the category menu entirely -- typing a query
   shows matching rules across every category at once, same plain
   case-insensitive substring match over category/section/text a
   hundred-odd rule entries doesn't need a search library for.
   Clearing the query returns to wherever you were (a category, or
   the menu). "Pin" is stored in localStorage per device, same
   privacy level as a player's remembered position in the ASL
   Bengals app: a quick-reference convenience, not data anyone else
   needs to see. The current category and pinned-only toggle are
   remembered the same way.
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
        const seed = await fetch('data/rules-seed.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => ({ rules: [] }));
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
      const CATEGORY_KEY = 'lybsRulesCategory';
      let category = (function () { try { return localStorage.getItem(CATEGORY_KEY) || ''; } catch (e) { return ''; } })();

      // Category <-> division is a 1:1 tag pair on every rule (just worded
      // differently) -- derive each category's underlying division once so
      // picking a division-specific category can still fold "General Rules"
      // (division "All") in alongside it, same as the old division filter did.
      const categoryDivision = {};
      cache.forEach(r => { if (r.category && !(r.category in categoryDivision)) categoryDivision[r.category] = r.division; });
      const categories = Object.keys(categoryDivision).sort((a, b) => {
        if (a === 'General Rules') return -1;
        if (b === 'General Rules') return 1;
        return a.localeCompare(b);
      });

      function inCategory(r, cat) {
        const div = categoryDivision[cat];
        if (div === 'All') return r.division === 'All';
        return r.division === div || r.division === 'All';
      }
      function matches(r) {
        if (showPinnedOnly && !pins.has(r.id)) return false;
        if (category && !inCategory(r, category)) return false;
        if (query) {
          const q = query.toLowerCase();
          return (r.text || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || (r.section || '').toLowerCase().includes(q);
        }
        // No query: pinned-only or a category is what got us here (the bare
        // menu view never calls matches() -- see renderList's early return).
        return showPinnedOnly || !!category;
      }

      function renderMenu() {
        const pinnedCount = cache.filter(r => pins.has(r.id)).length;
        const rows = categories.map(cat => {
          // The tile shows the category's OWN rule count, not the folded-in
          // total it'll actually display -- General Rules get mixed in when
          // you drill in (own group header, so it's clear why), but the menu
          // label should match the category's name, not surprise with a
          // bigger number.
          const count = cache.filter(r => r.category === cat).length;
          return `
            <div class="listRow" data-cat="${escapeHtml(cat)}">
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(cat)}</div>
                <div class="listRowSub">${count} rule${count === 1 ? '' : 's'}</div>
              </div>
            </div>`;
        }).join('');
        containerEl.innerHTML = `
          <div class="rulesSearchBar">
            <input id="rulesSearchInput" placeholder="Search rules -- e.g. 'balk', 'mercy', 'pitch count'" value="${escapeHtml(query)}">
          </div>
          ${pinnedCount ? `
            <div class="listRow" data-cat="__pinned">
              <div class="listRowMain">
                <div class="listRowTitle">★ Pinned</div>
                <div class="listRowSub">${pinnedCount} rule${pinnedCount === 1 ? '' : 's'}</div>
              </div>
            </div>` : ''}
          <div class="listBody" style="margin-top:10px;">${rows}</div>`;
        containerEl.querySelector('#rulesSearchInput').addEventListener('input', e => { query = e.target.value; renderList(); });
        containerEl.querySelectorAll('.listRow').forEach(row => {
          row.addEventListener('click', () => {
            if (row.dataset.cat === '__pinned') { showPinnedOnly = true; category = ''; }
            else { category = row.dataset.cat; showPinnedOnly = false; }
            try { localStorage.setItem(CATEGORY_KEY, category); } catch (e) {}
            renderList();
          });
        });
      }

      function renderList() {
        if (!query && !category && !showPinnedOnly) { renderMenu(); return; }
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

        const title = showPinnedOnly ? '★ Pinned' : (category || 'Search results');
        containerEl.innerHTML = `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="rulesBackBtn">&larr; Categories</button>
            <div class="recordLine">${escapeHtml(title)}</div>
          </div>
          <div class="rulesSearchBar">
            <input id="rulesSearchInput" placeholder="Search rules -- e.g. 'balk', 'mercy', 'pitch count'" value="${escapeHtml(query)}">
            <button class="btn btnGhost btnSmall ${showPinnedOnly ? 'active' : ''}" id="rulesPinnedToggle">${showPinnedOnly ? '★' : '☆'} Pinned only</button>
          </div>
          <div class="rulesList" id="rulesListEl">${groupsHtml}</div>`;
        containerEl.querySelector('#rulesBackBtn').addEventListener('click', () => { query = ''; category = ''; showPinnedOnly = false; renderList(); });
        containerEl.querySelector('#rulesSearchInput').addEventListener('input', e => { query = e.target.value; renderList(); });
        containerEl.querySelector('#rulesPinnedToggle').addEventListener('click', () => { showPinnedOnly = !showPinnedOnly; renderList(); });
        const listEl = containerEl.querySelector('#rulesListEl');
        listEl.querySelectorAll('.pinBtn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            pins = togglePin(btn.dataset.id);
            if (showPinnedOnly) { renderList(); }
            else {
              btn.textContent = pins.has(btn.dataset.id) ? '★' : '☆';
              btn.classList.toggle('pinned', pins.has(btn.dataset.id));
            }
          });
        });
      }
      renderList();
    },
  };
})();
