/* ============================================================
   Practice Catalog -- a browsable, LEAGUE-WIDE (not per-team) DRILL
   LIBRARY for every division LYBS runs (T-Ball, Rookies, Minors,
   Majors), each drill referencing the drill tools/play-diagram
   system already in this app. Deliberately NOT pre-built whole
   practices -- a coach picks individual drills and builds their own
   practice from them (see js/practice-plan.js's embedded Drill
   Library picker, the primary way a drill actually gets used; this
   tab's own "+ Add to my Practice Plan" button on a drill is a
   secondary, browse-first entry point to that same underlying
   PracticePlan.addDrillToPlan()).

   Each drill carries a "tier" WITHIN its division -- foundational /
   standard / advanced -- not a property of a team or player. This
   app's roster (js/roster.js) has no field for a player's prior
   experience or years at a division, so there's no way to detect
   "this team is mostly new to Majors" automatically; the coach
   judges their own team's makeup and filters to the tier(s) that
   fit (a team with some newcomers and some returners can show
   Foundational + Standard together -- the tier filter below is
   multi-select, not a single toggle, specifically for that case).

   Still reached only by directly calling switchTab('catalog') --
   deliberately left out of index.html's NAV_CATEGORIES while this
   is under active development (hidden from menu, not from code).

   Same "seed a static JSON file into shared/{key} once, then that's
   the live copy" pattern js/rules.js established -- except
   shared/practiceCatalog and shared/skillBenchmarks are BOARD-only to
   write (database.rules.json), not open to any signed-in user like
   shared/rules is: this is citation-grounded authored curriculum, not
   a self-correctable published rulebook. ensureLoaded() only attempts
   the opportunistic Firestore write when told the viewer is a board
   member; everyone else just browses the fetched seed in memory for
   that session.

   Content sourcing is intentionally uneven across divisions and the
   UI says so (sourceType badge): T-Ball/Rookies lean on Little League
   University's own diagrammed curricula (sourceType "official");
   Minors is assembled from USA Baseball's ADM + Skills Matrix
   ("adapted"); Majors has no official published curriculum anywhere
   -- Little League's own site confirms the gap -- so those entries
   are "lybs-original" and flagged for the league's own coaches to
   review, not presented as settled. See data/practice-catalog-seed.json
   and data/skill-benchmarks-seed.json for exact citations.
   ============================================================ */
(function () {
  let cache = null; // { drills, benchmarks }

  // Rookies/Minors/Majors colors match js/rules.js's CATEGORY_STYLE for
  // the same division names, so a color means the same thing in both
  // tabs. T-Ball has no equivalent there -- new, distinct color.
  const DIVISION_STYLE = {
    'T-Ball': { icon: '🧢', color: '#F2994A' },
    'Rookies': { icon: '🌱', color: '#5fd989' },
    'Minors': { icon: '⚾', color: '#4C6AEB' },
    'Majors': { icon: '🏆', color: '#F0C84B' },
  };
  const DIVISION_ORDER = ['T-Ball', 'Rookies', 'Minors', 'Majors'];
  function divStyle(division) {
    return DIVISION_STYLE[division] || { icon: '📖', color: 'var(--lybs-blue-bright)' };
  }

  const CATEGORY_STYLE = {
    'Warm-up': { icon: '🔥', color: '#e67e22' },
    'Throwing': { icon: '🎯', color: '#4C6AEB' },
    'Catching': { icon: '🧤', color: '#5fd989' },
    'Ground Ball/Infield': { icon: '⬇️', color: '#9AA3C2' },
    'Hitting': { icon: '🏏', color: '#F0C84B' },
    'Base Running': { icon: '🏃', color: '#35c574' },
    'Pitching': { icon: '🌀', color: '#b98af0' },
    'Catching concepts': { icon: '🛡️', color: '#6ea8c9' },
    'Team Situational': { icon: '🧠', color: '#c77dff' },
    'Basic Positioning': { icon: '📍', color: '#6ea8c9' },
    'Game/Scrimmage': { icon: '🆚', color: '#e35858' },
    'Multi-Station': { icon: '🔄', color: '#8891B0' },
  };
  function catStyle(category) {
    return CATEGORY_STYLE[category] || { icon: '📖', color: 'var(--lybs-blue-bright)' };
  }

  const TIER_ORDER = ['foundational', 'standard', 'advanced'];
  const TIER_LABEL = { foundational: 'Foundational', standard: 'Standard', advanced: 'Advanced' };

  const SOURCE_BADGE = {
    official: { label: 'Official source', color: '#5fd989' },
    adapted: { label: 'Adapted', color: '#6ea8c9' },
    'lybs-original': { label: 'Needs coach review', color: '#F0C84B' },
  };
  function sourceBadgeHtml(sourceType) {
    const s = SOURCE_BADGE[sourceType] || SOURCE_BADGE.adapted;
    return `<span class="badge" style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}55;">${escapeHtml(s.label)}</span>`;
  }

  async function loadShared(key, seedPath, extract, isBoard) {
    let data = await window.dbGet(window.sharedPath(key));
    if (!Array.isArray(data) || !data.length) {
      const seed = await fetch(seedPath + '?v=' + window.BUILD_V).then(r => r.json()).catch(() => ({}));
      data = extract(seed) || [];
      if (isBoard) {
        try { await window.dbPut(window.sharedPath(key), data); } catch (e) { /* dbPut already toasted; browse the seed in memory regardless */ }
      }
    }
    return data;
  }

  window.PracticeCatalog = {
    async ensureLoaded(isBoard) {
      if (cache) return cache;
      cache = {
        drills: await loadShared('practiceCatalog', 'data/practice-catalog-seed.json', d => d.drills, isBoard),
        benchmarks: await loadShared('skillBenchmarks', 'data/skill-benchmarks-seed.json', d => d.benchmarks, isBoard),
      };
      return cache;
    },

    // Sync accessors, same ensure-then-get convention as window.Roster --
    // js/practice-plan.js's embedded Drill Library picker calls
    // ensureLoaded(false) once (safe even if the catalog tab already
    // loaded it with the real isBoard value this session, since
    // ensureLoaded memoizes and never re-fetches or downgrades), then
    // reads synchronously from here while the coach types/filters.
    getDrills() { return (cache && cache.drills) || []; },
    getBenchmarks() { return (cache && cache.benchmarks) || []; },

    render(containerEl, opts) {
      opts = opts || {};
      const teamId = opts.teamId;
      const canEdit = !!opts.canEdit;
      const drills = cache.drills;
      const benchmarks = cache.benchmarks;
      const benchmarksById = {};
      benchmarks.forEach(b => { benchmarksById[b.id] = b; });
      // "Leads to" is the reverse of prerequisiteIds -- derived once,
      // same single-pass style js/rules.js uses for categoryDivision.
      const leadsTo = {};
      benchmarks.forEach(b => (b.prerequisiteIds || []).forEach(pid => {
        (leadsTo[pid] = leadsTo[pid] || []).push(b.id);
      }));

      let view = { tab: 'drills', division: null, category: null, tiers: new Set(TIER_ORDER), query: '', drillId: null, addPlanFor: null };

      function matchesTier(d) { return view.tiers.has(d.tier); }
      function matchesQuery(d) {
        if (!view.query) return true;
        const q = view.query.toLowerCase();
        return d.title.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q) || d.category.toLowerCase().includes(q);
      }

      function benchmarkChipsHtml(ids) {
        if (!ids || !ids.length) return '';
        return `<div class="drillChipRow" style="margin-top:6px;">${ids.map(id => {
          const b = benchmarksById[id];
          return b ? `<span class="badge badgeTbd">${escapeHtml(b.skill)}</span>` : '';
        }).join('')}</div>`;
      }

      function diagramPreviewHtml(diagramRef) {
        if (!diagramRef) return '';
        const markers = (diagramRef.markers || []).map(m => `
          <div class="pdMarker" style="left:${m.x}%;top:${m.y}%;cursor:default;">
            <span class="pdMarkerDot"></span>
            <span class="pdMarkerLabel">${escapeHtml(m.label)}</span>
          </div>`).join('');
        return `
          <div class="helpText" style="margin-top:8px;margin-bottom:4px;">${escapeHtml(diagramRef.title || 'Diagram')}${diagramRef.note ? ' -- ' + escapeHtml(diagramRef.note) : ''}</div>
          <div class="depthField" style="max-width:280px;">${window.DepthChart.fieldSvg()}${markers}</div>`;
      }

      function tierBadgeHtml(tier) {
        const colors = { foundational: '#5fd989', standard: '#4C6AEB', advanced: '#F0C84B' };
        const c = colors[tier] || '#9AA3C2';
        return `<span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}55;">${escapeHtml(TIER_LABEL[tier] || tier)}</span>`;
      }

      function tierFilterHtml() {
        return `<div class="drillChipRow" style="margin-bottom:12px;">
          ${TIER_ORDER.map(t => `<button class="drillChip ${view.tiers.has(t) ? 'drillChipOn' : ''}" data-tiertoggle="${t}">${escapeHtml(TIER_LABEL[t])}</button>`).join('')}
        </div>`;
      }

      function searchBarHtml() {
        return `
          <div class="rulesSearchBar">
            <input id="catSearchInput" placeholder="Search drills -- e.g. 'grounders', 'live bp'" value="${escapeHtml(view.query)}">
          </div>`;
      }

      function drillRowHtml(d) {
        return `
          <div class="listRow" data-drill="${escapeHtml(d.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(d.title)}</div>
              <div class="listRowSub">${escapeHtml(d.division)} &middot; ${escapeHtml(d.category)} &middot; ${d.suggestedMinutes} min</div>
            </div>
            ${tierBadgeHtml(d.tier)}
          </div>`;
      }

      function drillDetailHtml(d) {
        const style = divStyle(d.division);
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="catBackToList">&larr; ${escapeHtml(d.category)}</button>
            <div class="recordLine">${d.suggestedMinutes} min</div>
          </div>
          <div class="drillHero">
            <div class="drillHeroTitle">${escapeHtml(d.title)}</div>
            <div class="drillHeroSub">${escapeHtml(d.description)}</div>
          </div>
          <div class="drillChipRow" style="margin:6px 0 12px;">
            <span class="rulesCatIcon" style="width:auto;height:auto;padding:4px 10px;border-radius:8px;background:${style.color}22;color:${style.color};font-size:12.5px;">${style.icon} ${escapeHtml(d.division)}</span>
            ${tierBadgeHtml(d.tier)}
            ${sourceBadgeHtml(d.sourceType)}
          </div>
          ${d.citation ? `<div class="helpText" style="margin-bottom:10px;">${escapeHtml(d.citation)}</div>` : ''}
          ${benchmarkChipsHtml(d.benchmarkIds)}
          ${diagramPreviewHtml(d.diagramRef)}
          ${d.drillRef ? `<button class="btn btnGhost btnSmall" style="margin-top:12px;" data-jump-tool="${escapeHtml(d.drillRef.tool)}">Open in ${escapeHtml({ ath: 'Around the Horn', baserunning: 'Base Running', pitching: 'Pitch Chart' }[d.drillRef.tool] || d.drillRef.tool)} &rarr;</button>` : ''}
          ${canEdit && d.diagramRef ? `<button class="btn btnGhost btnSmall" style="margin-top:12px;margin-left:8px;" id="catAddDiagram">+ Add diagram to my Play Diagrams</button>` : ''}
          ${canEdit ? `<div id="catAddPlanSlot" style="margin-top:16px;"><button class="btn" id="catAddPlanBtn" style="width:100%;">+ Add to my Practice Plan</button></div>` : ''}`;
      }

      function addPlanPickerHtml() {
        const plans = window.PracticePlan.getPlans(teamId);
        return `
          <div class="helpText" style="margin-bottom:8px;">Add to which plan?</div>
          <div class="listBody">
            <div class="listRow" data-plan="__new"><div class="listRowMain"><div class="listRowTitle">+ New plan</div></div></div>
            ${plans.map(p => `<div class="listRow" data-plan="${escapeHtml(p.id)}"><div class="listRowMain"><div class="listRowTitle">${escapeHtml(p.name || 'Untitled plan')}</div><div class="listRowSub">${escapeHtml(p.date || '')}</div></div></div>`).join('')}
          </div>`;
      }

      function categoryTilesHtml(division) {
        const inDivision = drills.filter(d => d.division === division);
        const categories = [...new Set(inDivision.map(d => d.category))];
        const rows = categories.map(cat => {
          const count = inDivision.filter(d => d.category === cat).length;
          const style = catStyle(cat);
          return `
            <div class="listRow" data-category="${escapeHtml(cat)}">
              <div class="rulesCatIcon" style="background:${style.color}22;color:${style.color};">${style.icon}</div>
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(cat)}</div>
                <div class="listRowSub">${count} drill${count === 1 ? '' : 's'}</div>
              </div>
            </div>`;
        }).join('');
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="catBackToDivisions">&larr; Divisions</button>
            <div class="recordLine">${escapeHtml(division)}</div>
          </div>
          <div class="listBody" style="margin-top:10px;">${rows}</div>`;
      }

      function drillListHtml(division, category) {
        const filtered = drills.filter(d => d.division === division && d.category === category && matchesTier(d));
        const rows = filtered.map(drillRowHtml).join('') || '<div class="emptyState">No drills in this tier selection yet.</div>';
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="catBackToCategories">&larr; ${escapeHtml(division)}</button>
            <div class="recordLine">${escapeHtml(category)}</div>
          </div>
          ${tierFilterHtml()}
          <div class="listBody">${rows}</div>`;
      }

      function divisionTilesHtml() {
        const rows = DIVISION_ORDER.map(div => {
          const count = drills.filter(d => d.division === div).length;
          const style = divStyle(div);
          return `
            <div class="listRow" data-division="${escapeHtml(div)}">
              <div class="rulesCatIcon" style="background:${style.color}22;color:${style.color};">${style.icon}</div>
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(div)}</div>
                <div class="listRowSub">${count} drill${count === 1 ? '' : 's'}</div>
              </div>
            </div>`;
        }).join('');
        return `<div class="listBody">${rows}</div>`;
      }

      function searchResultsHtml() {
        const matched = drills.filter(d => matchesQuery(d) && matchesTier(d));
        const groups = DIVISION_ORDER.map(div => {
          const inDiv = matched.filter(d => d.division === div);
          if (!inDiv.length) return '';
          const style = divStyle(div);
          return `
            <div class="rulesGroup">
              <div class="rulesGroupHeader" style="border-left-color:${style.color};color:${style.color};">${style.icon} ${escapeHtml(div)}</div>
              <div class="listBody">${inDiv.map(drillRowHtml).join('')}</div>
            </div>`;
        }).join('') || '<div class="emptyState">No drills match that search.</div>';
        return tierFilterHtml() + groups;
      }

      function benchmarksHtml() {
        const groups = DIVISION_ORDER.map(div => {
          const rows = benchmarks.filter(b => b.division === div).map(b => {
            const prereqs = (b.prerequisiteIds || []).map(id => benchmarksById[id]).filter(Boolean);
            const leads = (leadsTo[b.id] || []).map(id => benchmarksById[id]).filter(Boolean);
            return `
              <div class="ruleItem" style="flex-direction:column;align-items:stretch;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                  <div class="ruleText" style="font-weight:700;">${escapeHtml(b.skill)}</div>
                  ${sourceBadgeHtml(b.sourceType)}
                </div>
                <div class="helpText" style="margin:4px 0 0;">${escapeHtml(b.category)}</div>
                ${prereqs.length ? `<div class="helpText" style="margin-top:4px;">Builds on: ${prereqs.map(p => escapeHtml(p.skill)).join(', ')}</div>` : ''}
                ${leads.length ? `<div class="helpText" style="margin-top:2px;">Leads to: ${leads.map(p => escapeHtml(p.skill)).join(', ')}</div>` : ''}
              </div>`;
          }).join('');
          if (!rows) return '';
          const style = divStyle(div);
          return `
            <div class="rulesGroup">
              <div class="rulesGroupHeader" style="border-left-color:${style.color};color:${style.color};">${style.icon} ${escapeHtml(div)}</div>
              ${rows}
            </div>`;
        }).join('');
        return `
          <div class="helpText" style="margin-bottom:10px;">Each division's skills build on the one before it -- "Builds on" names what should already be solid, "Leads to" names what this unlocks next.</div>
          ${groups}`;
      }

      function topToggleHtml() {
        return `
          <div class="coachingToggle" style="margin-bottom:14px;">
            <button class="btn btnSmall ${view.tab === 'drills' ? '' : 'btnGhost'}" data-top="drills">Drills</button>
            <button class="btn btnSmall ${view.tab === 'benchmarks' ? '' : 'btnGhost'}" data-top="benchmarks">Benchmarks</button>
          </div>`;
      }

      function refresh() {
        let body;
        if (view.tab === 'benchmarks') {
          body = benchmarksHtml();
        } else if (view.query) {
          body = searchBarHtml() + searchResultsHtml();
        } else if (view.drillId) {
          const d = drills.find(x => x.id === view.drillId);
          if (d) {
            body = drillDetailHtml(d);
          } else {
            view.drillId = null;
            body = view.category ? drillListHtml(view.division, view.category) : categoryTilesHtml(view.division);
          }
        } else if (view.division && view.category) {
          body = drillListHtml(view.division, view.category);
        } else if (view.division) {
          body = categoryTilesHtml(view.division);
        } else {
          body = searchBarHtml() + divisionTilesHtml();
        }
        containerEl.innerHTML = topToggleHtml() + body;
        scrollActiveTabIntoView(containerEl.querySelector('.coachingToggle'), '.btn:not(.btnGhost)');
        wire();
      }

      function wire() {
        containerEl.querySelectorAll('[data-top]').forEach(btn => {
          btn.addEventListener('click', () => {
            view = { tab: btn.dataset.top, division: null, category: null, tiers: new Set(TIER_ORDER), query: '', drillId: null, addPlanFor: null };
            refresh();
          });
        });
        const searchInput = containerEl.querySelector('#catSearchInput');
        if (searchInput) searchInput.addEventListener('input', e => { view.query = e.target.value; refresh(); });
        const back1 = containerEl.querySelector('#catBackToDivisions');
        if (back1) back1.addEventListener('click', () => { view.division = null; refresh(); });
        const back2 = containerEl.querySelector('#catBackToCategories');
        if (back2) back2.addEventListener('click', () => { view.category = null; refresh(); });
        const back3 = containerEl.querySelector('#catBackToList');
        if (back3) back3.addEventListener('click', () => { view.drillId = null; refresh(); });
        containerEl.querySelectorAll('[data-division]').forEach(row => {
          row.addEventListener('click', () => { view.division = row.dataset.division; refresh(); });
        });
        containerEl.querySelectorAll('[data-category]').forEach(row => {
          row.addEventListener('click', () => { view.category = row.dataset.category; refresh(); });
        });
        containerEl.querySelectorAll('[data-drill]').forEach(row => {
          row.addEventListener('click', () => {
            const d = drills.find(x => x.id === row.dataset.drill);
            if (!d) return;
            view.drillId = d.id; view.division = d.division; view.category = d.category;
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-tiertoggle]').forEach(btn => {
          btn.addEventListener('click', () => {
            const t = btn.dataset.tiertoggle;
            if (view.tiers.has(t) && view.tiers.size > 1) view.tiers.delete(t);
            else view.tiers.add(t);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-jump-tool]').forEach(btn => {
          btn.addEventListener('click', () => window.openCoachingTool(btn.dataset.jumpTool));
        });
        const addDiagramBtn = containerEl.querySelector('#catAddDiagram');
        if (addDiagramBtn) {
          addDiagramBtn.addEventListener('click', () => {
            const d = drills.find(x => x.id === view.drillId);
            if (!d || !d.diagramRef) return;
            withBusyButton(addDiagramBtn, 'Adding...', () => window.PlayDiagram.addFromCatalog(teamId, d.diagramRef))
              .then(() => window.showToast('Added to your Play Diagrams', 'info'));
          });
        }
        const addPlanBtn = containerEl.querySelector('#catAddPlanBtn');
        if (addPlanBtn) {
          addPlanBtn.addEventListener('click', async () => {
            await window.PracticePlan.ensurePlans(teamId);
            const slot = containerEl.querySelector('#catAddPlanSlot');
            slot.innerHTML = addPlanPickerHtml();
            slot.querySelectorAll('[data-plan]').forEach(row => {
              row.addEventListener('click', async () => {
                const d = drills.find(x => x.id === view.drillId);
                const planId = row.dataset.plan === '__new' ? null : row.dataset.plan;
                await window.PracticePlan.addDrillToPlan(teamId, planId, d);
                slot.innerHTML = '';
                window.showToast('Added to your Practice Plan', 'info');
              });
            });
          });
        }
      }

      refresh();
    },
  };
})();
