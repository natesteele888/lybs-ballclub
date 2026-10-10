/* ============================================================
   Practice Catalog -- a browsable, LEAGUE-WIDE (not per-team) library
   of structured practices for every division LYBS runs (T-Ball,
   Rookies, Minors, Majors), each referencing drills/diagrams already
   in this app, flexing by how many coaches show up, with an advanced
   add-on and a behind-track remediation variant alongside the
   standard plan -- plus a skill-benchmark ladder tying what's taught
   at one level to what it's a prerequisite for at the next.

   Same "seed a static JSON file into shared/{key} once, then that's
   the live copy" pattern js/rules.js already established -- except
   shared/practiceCatalog and shared/skillBenchmarks are BOARD-only to
   write (database.rules.json), not open to any signed-in user like
   shared/rules is: this is citation-grounded authored curriculum, not
   a self-correctable published rulebook, so a stray edit shouldn't be
   one tap away for anyone who happens to view this tab first. That
   means the opportunistic "mirror the seed into Firestore" write can
   only succeed for a board member -- ensureLoaded() only attempts it
   when told the viewer is one; everyone else just browses the fetched
   seed in memory for that session, harmlessly, until a board member
   is the one who opens this tab and writes it for real. (Mock mode's
   dbPut has no rule enforcement at all, so this distinction only
   matters once real Firebase rules are live -- see README's Go-Live
   checklist.)

   Content sourcing is intentionally uneven across divisions and the
   UI says so (sourceType badge): T-Ball/Rookies lean on Little League
   University's own diagrammed curricula (sourceType "official");
   Minors is assembled from USA Baseball's ADM + Skills Matrix
   ("adapted"); Majors has no official published curriculum anywhere
   -- Little League's own site confirms the gap -- so those entries
   are "lybs-original" and flagged for the league's own coaches to
   review, not presented as settled. See data/practice-catalog-seed.json
   and data/skill-benchmarks-seed.json for exact citations.

   Two coach-only "pull in" actions hand a catalog entry off to the
   tools that already exist for running it: PracticePlan.addFromCatalog
   and PlayDiagram.addFromCatalog (both in their own files) -- this
   tab only browses/references, it doesn't duplicate those tools.
   ============================================================ */
(function () {
  let cache = null; // { practices, benchmarks }

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

  function coachProfileFor(variant, coachCount) {
    return variant.coachProfiles.find(p => coachCount >= p.minCoaches && coachCount <= p.maxCoaches) || variant.coachProfiles[0];
  }

  window.PracticeCatalog = {
    async ensureLoaded(isBoard) {
      if (cache) return cache;
      cache = {
        practices: await loadShared('practiceCatalog', 'data/practice-catalog-seed.json', d => d.practices, isBoard),
        benchmarks: await loadShared('skillBenchmarks', 'data/skill-benchmarks-seed.json', d => d.benchmarks, isBoard),
      };
      return cache;
    },

    render(containerEl, opts) {
      opts = opts || {};
      const teamId = opts.teamId;
      const canEdit = !!opts.canEdit;
      const practices = cache.practices;
      const benchmarks = cache.benchmarks;
      const benchmarksById = {};
      benchmarks.forEach(b => { benchmarksById[b.id] = b; });
      // "Leads to" is the reverse of prerequisiteIds -- derived once,
      // same single-pass style js/rules.js uses for categoryDivision.
      const leadsTo = {};
      benchmarks.forEach(b => (b.prerequisiteIds || []).forEach(pid => {
        (leadsTo[pid] = leadsTo[pid] || []).push(b.id);
      }));

      let view = { tab: 'practices', division: null, practiceId: null, variant: 'core', coachCount: 1 };

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

      function blockHtml(block) {
        return `
          <div class="listRow" style="cursor:default;align-items:flex-start;">
            <div class="depthRank">${block.minutes}'</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(block.label)}</div>
              ${benchmarkChipsHtml(block.benchmarkIds)}
              ${diagramPreviewHtml(block.diagramRef)}
              ${block.drillRef ? `<button class="btn btnGhost btnSmall" style="margin-top:8px;" data-jump-tool="${escapeHtml(block.drillRef.tool)}">Open in ${escapeHtml({ ath: 'Around the Horn', baserunning: 'Base Running', pitching: 'Pitch Chart' }[block.drillRef.tool] || block.drillRef.tool)} &rarr;</button>` : ''}
              ${canEdit && block.diagramRef ? `<button class="btn btnGhost btnSmall" style="margin-top:8px;margin-left:8px;" data-add-diagram="${escapeHtml(block.id)}">+ Add diagram to my Play Diagrams</button>` : ''}
            </div>
          </div>`;
      }

      function divisionTilesHtml() {
        const rows = DIVISION_ORDER.map(div => {
          const count = practices.filter(p => p.division === div).length;
          const style = divStyle(div);
          return `
            <div class="listRow" data-division="${escapeHtml(div)}">
              <div class="rulesCatIcon" style="background:${style.color}22;color:${style.color};">${style.icon}</div>
              <div class="listRowMain">
                <div class="listRowTitle">${escapeHtml(div)}</div>
                <div class="listRowSub">${count} practice${count === 1 ? '' : 's'}</div>
              </div>
            </div>`;
        }).join('');
        return `<div class="listBody">${rows}</div>`;
      }

      function practiceListHtml(division) {
        const rows = practices.filter(p => p.division === division).map(p => `
          <div class="listRow" data-practice="${escapeHtml(p.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(p.name)}</div>
              <div class="listRowSub">${p.benchmarkIds.length} benchmark${p.benchmarkIds.length === 1 ? '' : 's'} covered</div>
            </div>
            ${sourceBadgeHtml(p.sourceType)}
          </div>`).join('') || '<div class="emptyState">No practices in this division yet.</div>';
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="catBackToDivisions">&larr; Divisions</button>
            <div class="recordLine">${escapeHtml(division)}</div>
          </div>
          <div class="listBody" style="margin-top:10px;">${rows}</div>`;
      }

      const VARIANT_KEYS = ['core', 'advanced', 'remediation'];
      function practiceDetailHtml(p) {
        const variant = p.variants[view.variant] || p.variants.core;
        const profile = coachProfileFor(variant, view.coachCount);
        const hasMultipleProfiles = variant.coachProfiles.length > 1;
        const totalMinutes = (profile.blocks || []).reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="catBackToList">&larr; ${escapeHtml(p.division)}</button>
            <div class="recordLine">${totalMinutes} min</div>
          </div>
          <div class="drillHero">
            <div class="drillHeroTitle">${escapeHtml(p.name)}</div>
            <div class="drillHeroSub">${escapeHtml(p.citation)}</div>
          </div>
          <div style="margin:6px 0 12px;">${sourceBadgeHtml(p.sourceType)}</div>
          <div class="coachingToggle">
            ${VARIANT_KEYS.filter(k => p.variants[k]).map(k => `<button class="btn btnSmall ${view.variant === k ? '' : 'btnGhost'}" data-variant="${k}">${escapeHtml(p.variants[k].label)}</button>`).join('')}
          </div>
          ${variant.note ? `<div class="helpText" style="margin-bottom:10px;">${escapeHtml(variant.note)}</div>` : ''}
          ${hasMultipleProfiles ? `
            <div class="drillChipRow" style="margin-bottom:12px;">
              ${variant.coachProfiles.map(prof => `<button class="drillChip ${profile === prof ? 'drillChipOn' : ''}" data-coachcount="${prof.minCoaches}">${escapeHtml(prof.label)}</button>`).join('')}
            </div>` : ''}
          <div class="listBody">${(profile.blocks || []).map(blockHtml).join('')}</div>
          ${canEdit ? `<button class="btn" id="catAddToPlan" style="width:100%;margin-top:14px;">+ Add this practice to my Practice Plan</button>` : ''}`;
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
            <button class="btn btnSmall ${view.tab === 'practices' ? '' : 'btnGhost'}" data-top="practices">Practices</button>
            <button class="btn btnSmall ${view.tab === 'benchmarks' ? '' : 'btnGhost'}" data-top="benchmarks">Benchmarks</button>
          </div>`;
      }

      function refresh() {
        let body;
        if (view.tab === 'benchmarks') {
          body = benchmarksHtml();
        } else if (view.practiceId) {
          const p = practices.find(x => x.id === view.practiceId);
          if (p) {
            body = practiceDetailHtml(p);
          } else {
            view.practiceId = null;
            body = practiceListHtml(view.division);
          }
        } else if (view.division) {
          body = practiceListHtml(view.division);
        } else {
          body = divisionTilesHtml();
        }
        containerEl.innerHTML = topToggleHtml() + body;
        scrollActiveTabIntoView(containerEl.querySelector('.coachingToggle'), '.btn:not(.btnGhost)');
        wire();
      }

      function wire() {
        containerEl.querySelectorAll('[data-top]').forEach(btn => {
          btn.addEventListener('click', () => {
            view = { tab: btn.dataset.top, division: null, practiceId: null, variant: 'core', coachCount: 1 };
            refresh();
          });
        });
        const back1 = containerEl.querySelector('#catBackToDivisions');
        if (back1) back1.addEventListener('click', () => { view.division = null; refresh(); });
        const back2 = containerEl.querySelector('#catBackToList');
        if (back2) back2.addEventListener('click', () => { view.practiceId = null; view.variant = 'core'; view.coachCount = 1; refresh(); });
        containerEl.querySelectorAll('[data-division]').forEach(row => {
          row.addEventListener('click', () => { view.division = row.dataset.division; refresh(); });
        });
        containerEl.querySelectorAll('[data-practice]').forEach(row => {
          row.addEventListener('click', () => { view.practiceId = row.dataset.practice; view.variant = 'core'; view.coachCount = 1; refresh(); });
        });
        containerEl.querySelectorAll('[data-variant]').forEach(btn => {
          btn.addEventListener('click', () => { view.variant = btn.dataset.variant; view.coachCount = 1; refresh(); });
        });
        containerEl.querySelectorAll('[data-coachcount]').forEach(btn => {
          btn.addEventListener('click', () => { view.coachCount = Number(btn.dataset.coachcount); refresh(); });
        });
        containerEl.querySelectorAll('[data-jump-tool]').forEach(btn => {
          btn.addEventListener('click', () => window.openCoachingTool(btn.dataset.jumpTool));
        });
        containerEl.querySelectorAll('[data-add-diagram]').forEach(btn => {
          btn.addEventListener('click', () => {
            const p = practices.find(x => x.id === view.practiceId);
            const variant = p.variants[view.variant] || p.variants.core;
            const profile = coachProfileFor(variant, view.coachCount);
            const block = (profile.blocks || []).find(b => b.id === btn.dataset.addDiagram);
            if (!block || !block.diagramRef) return;
            withBusyButton(btn, 'Adding...', () => window.PlayDiagram.addFromCatalog(teamId, block.diagramRef))
              .then(() => window.showToast('Added to your Play Diagrams', 'info'));
          });
        });
        const addPlanBtn = containerEl.querySelector('#catAddToPlan');
        if (addPlanBtn) {
          addPlanBtn.addEventListener('click', () => {
            const p = practices.find(x => x.id === view.practiceId);
            const variant = p.variants[view.variant] || p.variants.core;
            const profile = coachProfileFor(variant, view.coachCount);
            const name = `${p.name} (${variant.label}, ${profile.label})`;
            withBusyButton(addPlanBtn, 'Adding...', () => window.PracticePlan.addFromCatalog(teamId, { name, blocks: profile.blocks }))
              .then(() => window.showToast('Added to your Practice Plan', 'info'));
          });
        }
      }

      refresh();
    },
  };
})();
