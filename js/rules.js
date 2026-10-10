/* ============================================================
   Rules reference -- search + "pin for quick reference", over a
   flat array of {id, division, category, section, text}. Content is
   MAC League's full set of division rulebooks (Rookies/Minors/
   Majors/Juniors & Seniors) plus General/Playoff/Operating
   Guidelines/All-Stars Information (data/rules-seed.json), mirrored
   into shared/rules in the database the first time any device loads
   this tab (same "seed once, then it's the live editable copy"
   convention ASL Bengals uses for its signal cards -- see that
   app's cloud-auth.js __seedBengalsPlayData and
   coachtools-signals-admin.js). Rules content is shared across
   every team, not per-team, since every LYBS team plays under the
   same league rulebooks.

   Rules get amended mid-season (several entries below carry the
   league's own "(Updated .../changed on ...)" notes) and the
   divisional rulebooks themselves get re-issued each year -- see
   rules-seed.json's top-level "season" field. Re-pull from
   macleague.org/coaching-resources/ at least once each offseason.

   Browsing is three levels: categories -> that category's sections
   (as cards, each expandable in place rather than a third drill-down
   screen -- a coach tapping "Majors Rules" wants to glance at Batting/
   Defense/Pitching/Misc. and open the one they came for, not read a
   flat wall of every rule at once) -> the section's own rules.
   category and division are the same underlying tag on each rule,
   just phrased differently ("Majors Rules" / "Majors"), so a
   division-specific category still folds in "General Rules" (the
   rules tagged division "All") alongside it, matching how the
   league's own pages frame it ("in addition to the common MAC
   League General Rules") -- General Rules' own category is the one
   place that's just itself, since folding it into itself would
   duplicate every entry. A folded-in General section card is labeled
   with its own category name so it's clear it's not one of the
   division's own sections.

   The category menu defaults to what's actually relevant to THIS
   team's own division (plus General/Playoff/All-Stars/Operating
   Guidelines, which aren't a sibling age division's rulebook the way
   Rookies/Minors/Juniors&Seniors specifically are) -- a Majors coach
   has no use for Rookies' or Minors' rulebooks day to day, and
   showing all 8 regardless just makes the one they actually need
   harder to find. A "show N more divisions" toggle (remembered per
   device) reveals the rest for whoever does want to cross-reference
   another level.

   Search bypasses both the category menu AND the section-card view
   entirely -- typing a query shows matching rules across every
   category at once (same flat grouped-by-category-section list this
   had before section cards existed), same plain case-insensitive
   substring match over category/section/text a hundred-odd rule
   entries doesn't need a search library for. Clearing the query
   returns to wherever you were. "Pin" is stored in localStorage per
   device, same privacy level as a player's remembered position in
   the ASL Bengals app: a quick-reference convenience, not data
   anyone else needs to see. The current category, the division-show-
   all toggle, and the pinned-only toggle are all remembered the same
   way.
   ============================================================ */
(function () {
  let cache = null; // rules[]
  const PIN_KEY = 'lybsPinnedRules';
  const CATEGORY_KEY = 'lybsRulesCategory';
  const SHOW_ALL_DIVISIONS_KEY = 'lybsRulesShowAllDivisions';
  // Rulebooks tied to a specific age level a team actually plays at --
  // the ones a coach at a DIFFERENT level has no day-to-day use for.
  // Playoffs/All-Stars/Operating Guidelines aren't "another level's
  // rules" the same way -- they're either cross-cutting or something
  // every division's coach might need (playoff seeding, an All-Star
  // nomination, league administration), so they stay visible by default
  // alongside General and the team's own division.
  const PLAY_LEVEL_DIVISIONS = ['Rookies', 'Minors', 'Majors', 'Juniors & Seniors'];

  // A plain flat list of 8 same-looking rows read as one big wall of text
  // to scan past -- an icon + a distinct color per category (menu tiles AND
  // the group headers you land on after drilling in) gives each one a
  // shape to recognize at a glance instead of reading every label. Colors
  // pulled from the app's existing palette so nothing here invents a new
  // one. Default covers a category this map hasn't been taught yet (new
  // rulebook section added upstream) rather than rendering a blank icon.
  const CATEGORY_STYLE = {
    'General Rules': { icon: '📋', color: '#9AA3C2' },
    'Rookies Rules': { icon: '🌱', color: '#5fd989' },
    'Minors Rules': { icon: '⚾', color: '#4C6AEB' },
    'Majors Rules': { icon: '🏆', color: '#F0C84B' },
    'Juniors & Seniors Rules': { icon: '🎓', color: '#b98af0' },
    'Playoff Rules': { icon: '🔥', color: '#e35858' },
    'All-Stars Information': { icon: '⭐', color: '#35c574' },
    'Operating Guidelines': { icon: '⚙️', color: '#6ea8c9' },
  };
  function catStyle(cat) {
    return CATEGORY_STYLE[cat] || { icon: '📖', color: 'var(--lybs-blue-bright)' };
  }

  // A section's icon stays the same regardless of which category it
  // belongs to -- "Batting" looks like "Batting" whether it's Rookies',
  // Minors', or Majors' own section (all three divisions happen to use
  // identical section names for their own rulebooks). A section card's
  // COLOR still comes from catStyle() of its own category, so a folded-in
  // General section reads as General-colored even inside a Majors browse.
  const SECTION_ICON = {
    'CALL UP Process': '📞',
    'CALL UP & Game Rules': '📞',
    'Games & Scoring': '📋',
    'Games Not Played': '🚫',
    'Player & Facility Equipment': '🎒',
    'Rain Outs / Incomplete Games / Lightning / Darkness': '⛈️',
    'Sportsmanship': '🤝',
    'Umpires': '🧑‍⚖️',
    'Umpires & Costs': '💵',
    'Bad Weather & Make Up Games': '🌧️',
    'Batting': '🏏',
    'Defense': '🧤',
    'Equipment': '🎒',
    'Field Preparation & Cleanup': '🧹',
    'League Summary': '📖',
    'Officiating': '🧑‍⚖️',
    'Pitching': '🌀',
    'Scoring': '🔢',
    'Timing of Games': '⏱️',
    'Format & Eligibility': '📐',
    'Playoff Pitch Counts': '🔥',
    'Scheduling & Forfeits': '🗓️',
    'Seeding': '🌱',
    'Weather-Suspended Pitch Counts': '⛈️',
    'Miscellaneous': '🗂️',
    'Awards': '🏅',
    'League Administration': '🏛️',
    'League Finances': '💰',
    'MAC League Administrator': '👤',
    'MAC League President': '👔',
    'MAC League Representative': '🧑‍💼',
    'Player Participation': '🙋',
    'Safety Protocols': '🛡️',
    'Scheduling': '🗓️',
    'Team Building Agreement': '📝',
    'General Information': 'ℹ️',
    'Rules': '📜',
    'Weather': '🌤️',
  };
  function sectionIcon(section) {
    return SECTION_ICON[section] || '📄';
  }

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
      let category = (function () { try { return localStorage.getItem(CATEGORY_KEY) || ''; } catch (e) { return ''; } })();
      let showAllDivisions = (function () { try { return localStorage.getItem(SHOW_ALL_DIVISIONS_KEY) === '1'; } catch (e) { return false; } })();
      const expandedSections = new Set();
      const teamDivision = (window.TeamConfig && window.TeamConfig.current && window.TeamConfig.current().macLeagueDivisionName) || null;

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
      // No team context (shouldn't normally happen -- every path into this
      // tab already has one) falls back to showing everything rather than
      // hiding categories against a division of null that'd never match.
      function isRelevant(cat) {
        if (!teamDivision) return true;
        const div = categoryDivision[cat];
        return div === 'All' || div === teamDivision || !PLAY_LEVEL_DIVISIONS.includes(div);
      }

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

      function ruleItemHtml(r) {
        return `
          <div class="ruleItem" data-id="${escapeHtml(r.id)}">
            <div class="ruleText">${highlight(r.text, query)}</div>
            <button class="pinBtn ${pins.has(r.id) ? 'pinned' : ''}" data-id="${escapeHtml(r.id)}" title="Pin for quick reference">${pins.has(r.id) ? '★' : '☆'}</button>
          </div>`;
      }
      function wirePinButtons(root, onToggle) {
        root.querySelectorAll('.pinBtn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            pins = togglePin(btn.dataset.id);
            if (onToggle) onToggle();
            else {
              btn.textContent = pins.has(btn.dataset.id) ? '★' : '☆';
              btn.classList.toggle('pinned', pins.has(btn.dataset.id));
            }
          });
        });
      }

      function renderMenu() {
        const pinnedCount = cache.filter(r => pins.has(r.id)).length;
        const visibleCategories = showAllDivisions ? categories : categories.filter(isRelevant);
        const hiddenCount = categories.length - visibleCategories.length;
        const rows = visibleCategories.map(cat => {
          // The tile shows the category's OWN rule count, not the folded-in
          // total it'll actually display -- General Rules get mixed in when
          // you drill in (own group header, so it's clear why), but the menu
          // label should match the category's name, not surprise with a
          // bigger number.
          const count = cache.filter(r => r.category === cat).length;
          const style = catStyle(cat);
          return `
            <div class="listRow" data-cat="${escapeHtml(cat)}">
              <div class="rulesCatIcon" style="background:${style.color}22;color:${style.color};">${style.icon}</div>
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
              <div class="rulesCatIcon" style="background:#F0C84B22;color:#F0C84B;">★</div>
              <div class="listRowMain">
                <div class="listRowTitle">Pinned</div>
                <div class="listRowSub">${pinnedCount} rule${pinnedCount === 1 ? '' : 's'}</div>
              </div>
            </div>` : ''}
          <div class="listBody" style="margin-top:10px;">${rows}</div>
          ${(hiddenCount > 0 || showAllDivisions) && teamDivision ? `
            <button class="btn btnGhost btnSmall" id="rulesDivisionToggle" style="width:100%;margin-top:10px;">
              ${showAllDivisions ? `Show only ${escapeHtml(teamDivision)} &amp; general rules` : `+ Show ${hiddenCount} more division${hiddenCount === 1 ? '' : 's'}`}
            </button>` : ''}`;
        containerEl.querySelector('#rulesSearchInput').addEventListener('input', e => { query = e.target.value; renderList(); });
        containerEl.querySelectorAll('.listRow').forEach(row => {
          row.addEventListener('click', () => {
            if (row.dataset.cat === '__pinned') { showPinnedOnly = true; category = ''; }
            else { category = row.dataset.cat; showPinnedOnly = false; expandedSections.clear(); }
            try { localStorage.setItem(CATEGORY_KEY, category); } catch (e) {}
            renderList();
          });
        });
        const divToggle = containerEl.querySelector('#rulesDivisionToggle');
        if (divToggle) {
          divToggle.addEventListener('click', () => {
            showAllDivisions = !showAllDivisions;
            try { localStorage.setItem(SHOW_ALL_DIVISIONS_KEY, showAllDivisions ? '1' : '0'); } catch (e) {}
            renderMenu();
          });
        }
      }

      // One category's rules, grouped into tappable section cards instead
      // of one long scroll -- each expands in place to show its own rules,
      // collapsing it hides them again. A folded-in General Rules section
      // is labeled with "General Rules" in its subtitle so it reads as
      // borrowed context, not one of this division's own sections.
      function renderSectionCards() {
        const inCat = cache.filter(r => inCategory(r, category));
        const groups = {};
        inCat.forEach(r => {
          const key = `${r.category}|||${r.section}`;
          (groups[key] = groups[key] || []).push(r);
        });
        const keys = Object.keys(groups).sort((a, b) => {
          const [catA] = a.split('|||'), [catB] = b.split('|||');
          if (catA === category && catB !== category) return -1;
          if (catB === category && catA !== category) return 1;
          return a.localeCompare(b);
        });
        const cards = keys.map(key => {
          const [secCat, secName] = key.split('|||');
          const rules = groups[key];
          const style = catStyle(secCat);
          const expanded = expandedSections.has(key);
          return `
            <div class="rulesSectionCard">
              <div class="listRow" data-section="${escapeHtml(key)}">
                <div class="rulesCatIcon" style="background:${style.color}22;color:${style.color};">${sectionIcon(secName)}</div>
                <div class="listRowMain">
                  <div class="listRowTitle">${escapeHtml(secName)}</div>
                  <div class="listRowSub">${secCat !== category ? escapeHtml(secCat) + ' &middot; ' : ''}${rules.length} rule${rules.length === 1 ? '' : 's'}</div>
                </div>
                <span class="rulesSectionChevron">${expanded ? '&#9662;' : '&#9656;'}</span>
              </div>
              ${expanded ? `<div class="rulesSectionRules">${rules.map(ruleItemHtml).join('')}</div>` : ''}
            </div>`;
        }).join('') || '<div class="emptyState">No rules in this category yet.</div>';

        containerEl.innerHTML = `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="rulesBackBtn">&larr; Categories</button>
            <div class="recordLine">${escapeHtml(category)}</div>
          </div>
          <div class="rulesSearchBar">
            <input id="rulesSearchInput" placeholder="Search rules -- e.g. 'balk', 'mercy', 'pitch count'" value="${escapeHtml(query)}">
          </div>
          <div class="listBody" style="margin-top:10px;gap:10px;">${cards}</div>`;
        containerEl.querySelector('#rulesBackBtn').addEventListener('click', () => { category = ''; try { localStorage.setItem(CATEGORY_KEY, ''); } catch (e) {} renderList(); });
        containerEl.querySelector('#rulesSearchInput').addEventListener('input', e => { query = e.target.value; renderList(); });
        containerEl.querySelectorAll('[data-section]').forEach(row => {
          row.addEventListener('click', () => {
            const key = row.dataset.section;
            if (expandedSections.has(key)) expandedSections.delete(key); else expandedSections.add(key);
            renderSectionCards();
          });
        });
        wirePinButtons(containerEl, () => renderSectionCards());
      }

      // Cross-category view: search results or the pinned list -- both
      // genuinely span multiple categories/sections at once, so the old
      // flat grouped-by-category-section list (not section cards) is still
      // the right shape here.
      function renderFlatList() {
        const filtered = cache.filter(matches);
        const groups = {};
        filtered.forEach(r => {
          const key = `${r.category} — ${r.section}`;
          (groups[key] = groups[key] || []).push(r);
        });
        const groupsHtml = Object.keys(groups).map(key => {
          const style = catStyle(groups[key][0].category);
          return `
          <div class="rulesGroup">
            <div class="rulesGroupHeader" style="border-left-color:${style.color};color:${style.color};">${style.icon} ${escapeHtml(key)}</div>
            ${groups[key].map(ruleItemHtml).join('')}
          </div>`;
        }).join('') || '<div class="emptyState">No rules match that search.</div>';

        const title = showPinnedOnly ? '★ Pinned' : 'Search results';
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
        wirePinButtons(containerEl.querySelector('#rulesListEl'), showPinnedOnly ? () => renderList() : null);
      }

      function renderList() {
        if (!query && !showPinnedOnly && category) { renderSectionCards(); return; }
        if (!query && !category && !showPinnedOnly) { renderMenu(); return; }
        renderFlatList();
      }
      renderList();
    },
  };
})();
