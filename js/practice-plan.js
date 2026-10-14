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

   "Generate a season plan" (buildSeasonPlan(), wired to the list
   screen's own form) builds several of these plans at once from the
   Drill Library instead of one at a time -- a coach enters weeks/
   practices-per-week/minutes-per-practice/start date and gets back
   one real, independently editable plan per practice, sequenced to
   open with Warm-up, round-robin through this division's other
   categories (specialized-position and team-coordinated categories
   held back until later in the season -- see CATEGORY_STAGE) so
   nothing gets neglected, lean foundational early and ease into
   standard/advanced as the weeks go on, and close with a scrimmage
   periodically. Purely additive -- it only ever creates new plans,
   never touches or replaces existing ones.
   ============================================================ */
(function () {
  const PRESETS = ['Warm-up / Stretch', 'Throwing', 'Infield/Outfield', 'Batting Practice', 'Base Running', 'Live BP / Scrimmage', 'Cool-down'];
  const TIER_ORDER = ['foundational', 'standard', 'advanced'];
  const TIER_LABEL = { foundational: 'Foundational', standard: 'Standard', advanced: 'Advanced' };
  const TOOL_LABEL = { ath: 'Around the Horn', baserunning: 'Base Running', pitching: 'Pitch Chart' };
  // Season plan generator's category rotation -- roughly the order a
  // practice naturally moves through (arm care before live reps, skill
  // work before team concepts), filtered per division to whichever
  // categories that division's drills actually use (T-Ball has no
  // Pitching/Team Situational entries, for instance).
  const CATEGORY_ROTATION_ORDER = ['Throwing', 'Catching', 'Ground Ball/Infield', 'Hitting', 'Base Running', 'Pitching', 'Catching concepts', 'Basic Positioning', 'Team Situational', 'Multi-Station'];
  // How far into the season (0 = session 1) a category is even eligible to
  // enter the rotation -- separate from the foundational/standard/advanced
  // TIER pacing within a category, which only reorders drills already
  // filtered to one division. Tier pacing alone isn't enough: a round-robin
  // that touches every category starting session 1 can still hand a brand
  // new team a team-coordinated concept (a relay, a cutoff) in week one
  // just because its turn came up, even at that category's own easiest
  // tier. Pitching/catcher-specific work (specialized positions, not every
  // player) and Team Situational (relays, cutoffs, rundowns, bunt defense
  // -- needs individual catch/throw/field reps already underway to mean
  // anything) wait; everything else, including Multi-Station rotations
  // (which just bundle whatever categories are already unlocked), is
  // available from session 1. A category not listed here defaults to 0.
  const CATEGORY_STAGE = { Pitching: 0.2, 'Catching concepts': 0.2, 'Team Situational': 0.4 };

  const cache = {}; // teamId -> plans[]
  const pending = {}; // teamId -> in-flight ensurePlans() promise

  // Caches the in-flight fetch, not just the resolved value -- the
  // Practice Catalog tab's "+ Add to my Practice Plan" button and this
  // tool's own render() can each call this for the same team within
  // moments of each other (e.g. a coach adds a drill, then immediately
  // switches to Practice Plan itself), and without this guard whichever
  // dbGet resolved second would clobber cache[teamId] with its own array,
  // silently orphaning the block the other call had just added and saved
  // -- same shape as the play-diagram.js cache race fixed earlier this
  // session, same fix.
  async function ensurePlans(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const data = await window.dbGet(window.teamPath(teamId, 'practicePlans'));
        cache[teamId] = Array.isArray(data) ? data : [];
        return cache[teamId];
      } finally {
        delete pending[teamId];
      }
    })();
    return pending[teamId];
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
      equipment: drill.equipment,
    };
  }
  function addDaysIso(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Season plan generator -- "balanced and gradual": every session opens
  // with Warm-up, then rotates through this division's other categories
  // in a fair round-robin (shift the one just used to the back of the
  // queue) so nothing gets neglected and nothing repeats until everything
  // else has had a turn, closing with a scrimmage periodically rather
  // than every single time. Tier preference shifts foundational -> standard
  // -> advanced across the arc of the season -- tier already encodes
  // "build this before that" at the drill level (see this division's own
  // drills in data/practice-catalog-seed.json), so this paces off tier
  // instead of re-deriving a full prerequisite order from the benchmark
  // graph, which only exists at the finer-grained benchmark level, not
  // the drill level this planner actually schedules.
  //
  // Pure function (division/drills/opts in, an array of plan-shaped
  // objects out) -- doesn't touch teamId or storage itself, same as
  // blockFromDrill() above; the caller saves the result.
  function buildSeasonPlan(division, drills, opts) {
    const weeks = Math.max(1, Math.round(opts.weeks) || 1);
    const practicesPerWeek = Math.max(1, Math.round(opts.practicesPerWeek) || 1);
    const minutesPerPractice = Math.max(10, Math.round(opts.minutesPerPractice) || 60);
    const startDate = opts.startDate || todayIso();

    const byCategory = {};
    drills.forEach(d => { (byCategory[d.category] = byCategory[d.category] || []).push(d); });
    const warmupPool = byCategory['Warm-up'] || [];
    const gamePool = byCategory['Game/Scrimmage'] || [];
    const avgGameMinutes = gamePool.length ? gamePool.reduce((s, d) => s + (d.suggestedMinutes || 15), 0) / gamePool.length : 0;
    // Categories this division actually has content for, ordered by stage
    // first (CATEGORY_STAGE, unlisted = 0) then by CATEGORY_ROTATION_ORDER
    // -- Array#sort is stable, so within the same stage the curriculum
    // order above is preserved. `rotation` itself starts empty and fills
    // in as the season unlocks each category (see the per-session loop
    // below), rather than all at once up front.
    const eligibleCategories = CATEGORY_ROTATION_ORDER
      .filter(c => byCategory[c] && byCategory[c].length)
      .sort((a, b) => (CATEGORY_STAGE[a] || 0) - (CATEGORY_STAGE[b] || 0));
    const rotation = [];
    const unlocked = new Set();

    const usage = {}; // drillId -> times already used this season, for least-used-first picking
    function pickLeastUsed(pool) {
      if (!pool.length) return null;
      return pool.slice().sort((a, b) => (usage[a.id] || 0) - (usage[b.id] || 0))[0];
    }
    function pickByTier(pool, tierPref) {
      for (const tier of tierPref) {
        const picked = pickLeastUsed(pool.filter(d => d.tier === tier));
        if (picked) return picked;
      }
      return pickLeastUsed(pool); // no drill at any preferred tier -- take whatever this category has
    }
    function use(d) { usage[d.id] = (usage[d.id] || 0) + 1; return d; }

    const totalSessions = weeks * practicesPerWeek;
    const plans = [];
    for (let s = 0; s < totalSessions; s++) {
      const weekNum = Math.floor(s / practicesPerWeek) + 1;
      const practiceNum = (s % practicesPerWeek) + 1;
      // 0 on the very first session, ~1 on the last. A single-session
      // "season" gets 0, not a mid-season blend -- a lone planned practice
      // reads as day one, not a random sample of the whole arc, so it
      // should default to the same foundational, nothing-unlocked-yet
      // starting point every real season begins at.
      const progress = totalSessions > 1 ? s / (totalSessions - 1) : 0;
      const tierPref = progress < 0.34 ? ['foundational', 'standard']
        : progress < 0.7 ? ['standard', 'foundational', 'advanced']
        : ['standard', 'advanced'];
      // Unlock any category whose stage threshold this session's progress
      // has now reached, appending each to the back of the rotation queue
      // in curriculum order the first time it qualifies.
      eligibleCategories.forEach(c => {
        if (!unlocked.has(c) && (CATEGORY_STAGE[c] || 0) <= progress) { unlocked.add(c); rotation.push(c); }
      });
      // One team's whole week closes with a scrimmage (the last practice
      // of the week) if they practice more than once a week; a once-a-week
      // team gets one every other week instead, so skill work still gets
      // most sessions to itself.
      const wantsClosingGame = gamePool.length > 0 && (practicesPerWeek > 1 ? practiceNum === practicesPerWeek : weekNum % 2 === 0);

      const blocks = [];
      let minutesUsed = 0;
      if (warmupPool.length) {
        const d = use(pickLeastUsed(warmupPool));
        blocks.push(blockFromDrill(d));
        minutesUsed += d.suggestedMinutes || 10;
      }
      while (rotation.length) {
        const cat = rotation[0];
        const d = pickByTier(byCategory[cat], tierPref);
        const dMin = d ? (d.suggestedMinutes || 15) : 0;
        const reserve = wantsClosingGame ? avgGameMinutes : 0;
        if (!d || minutesUsed + dMin > minutesPerPractice - reserve) break;
        rotation.push(rotation.shift()); // consumed this turn -- cycle to the back of the queue
        use(d);
        blocks.push(blockFromDrill(d));
        minutesUsed += dMin;
      }
      if (wantsClosingGame) {
        const d = pickLeastUsed(gamePool);
        if (d) { use(d); blocks.push(blockFromDrill(d)); minutesUsed += d.suggestedMinutes || 15; }
      }

      const weekStartDay = (weekNum - 1) * 7;
      const withinWeekDay = Math.floor((practiceNum - 1) * 7 / practicesPerWeek);
      plans.push({
        id: uid('pp'),
        name: `Week ${weekNum}${practicesPerWeek > 1 ? ' · Practice ' + practiceNum : ''}`,
        date: addDaysIso(startDate, weekStartDay + withinWeekDay),
        blocks,
      });
    }
    return plans;
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
      p = { id: uid('pp'), name: '', date: todayIso(), blocks: [] };
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
      let genOpen = false;
      const genForm = { weeks: 6, practicesPerWeek: 1, minutesPerPractice: 60, startDate: todayIso() };

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
          <button class="btn" id="ppNew" style="width:100%;margin-bottom:10px;">+ New plan</button>
          <button class="btn btnGhost" id="ppGenToggle" style="width:100%;margin-bottom:14px;">${genOpen ? '&times; Cancel' : '✨ Generate a season plan'}</button>
          ${genOpen ? generateFormHtml() : ''}
          <div class="listBody">${rows || '<div class="emptyState">No practice plans saved yet.</div>'}</div>`;
      }

      function generateFormHtml() {
        const division = defaultDivision;
        const totalSessions = (Number(genForm.weeks) || 0) * (Number(genForm.practicesPerWeek) || 0);
        return `
          <div class="drillCard" style="margin-bottom:14px;">
            <div class="drillCardTitle">Generate a season plan</div>
            <div class="helpText" style="margin:6px 0 12px;">
              ${division ? `Builds ${escapeHtml(division)} practices` : 'Builds each practice'} starting with warm-up and
              rotating through every skill category so nothing gets neglected, leaning foundational early and easing
              into standard/advanced as the weeks go on, with a scrimmage worked in periodically. Creates one new
              plan per practice -- nothing existing is touched, and every plan it creates is yours to edit or delete
              afterward like any other.
            </div>
            <label class="drillFieldLabel">Weeks
              <input class="drillFreeInput" type="number" min="1" max="30" id="genWeeks" value="${escapeHtml(String(genForm.weeks))}">
            </label>
            <label class="drillFieldLabel" style="margin-top:10px;">Practices per week
              <input class="drillFreeInput" type="number" min="1" max="4" id="genPerWeek" value="${escapeHtml(String(genForm.practicesPerWeek))}">
            </label>
            <label class="drillFieldLabel" style="margin-top:10px;">Minutes per practice
              <input class="drillFreeInput" type="number" min="20" max="180" step="5" id="genMinutes" value="${escapeHtml(String(genForm.minutesPerPractice))}">
            </label>
            <label class="drillFieldLabel" style="margin-top:10px;">Starting
              <input class="drillFreeInput" type="date" id="genStart" value="${escapeHtml(genForm.startDate)}">
            </label>
            ${!division ? '<div class="helpText" style="margin-top:10px;color:var(--gold);">Set this team\'s MAC League division first (Team Access/setup) -- the generator needs to know which division\'s drills to pull from.</div>' : ''}
            <button class="btn" id="genSubmit" style="width:100%;margin-top:14px;" ${division ? '' : 'disabled'}>Generate ${totalSessions || ''} practice${totalSessions === 1 ? '' : 's'}</button>
          </div>`;
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
        // Equipment only -- the fuller setup-steps/coaching-points detail
        // stays in the Drill Library's own detail screen (js/practice-
        // catalog.js) rather than repeating in full here, where a plan
        // with several blocks would otherwise turn into a wall of text; a
        // coach packing a bag before practice is exactly who wants the
        // quick equipment list right on the plan itself though.
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
              ${block.equipment && block.equipment.length ? `<div class="helpText" style="margin-top:4px;">Equipment: ${block.equipment.map(escapeHtml).join(', ')}</div>` : ''}
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
            ${divisions.map(d => `<button class="drillChip ${libFilter.division === d ? 'drillChipOn' : ''}" data-libdivision="${escapeHtml(d)}" aria-pressed="${libFilter.division === d}">${escapeHtml(d)}</button>`).join('')}
          </div>
          <div class="drillChipRow" style="margin-bottom:6px;">
            ${TIER_ORDER.map(t => `<button class="drillChip ${libFilter.tiers.has(t) ? 'drillChipOn' : ''}" data-libtier="${t}" aria-pressed="${libFilter.tiers.has(t)}">${escapeHtml(TIER_LABEL[t])}</button>`).join('')}
          </div>
          <div class="drillChipRow" style="margin-bottom:10px;">
            <button class="drillChip ${!libFilter.category ? 'drillChipOn' : ''}" data-libcategory="" aria-pressed="${!libFilter.category}">All categories</button>
            ${categories.map(c => `<button class="drillChip ${libFilter.category === c ? 'drillChipOn' : ''}" data-libcategory="${escapeHtml(c)}" aria-pressed="${libFilter.category === c}">${escapeHtml(c)}</button>`).join('')}
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
          containerEl.querySelector('#ppGenToggle').addEventListener('click', () => { genOpen = !genOpen; refresh(); });
          const genSubmit = containerEl.querySelector('#genSubmit');
          if (genSubmit) {
            genSubmit.addEventListener('click', async btnEvt => {
              genForm.weeks = Number(containerEl.querySelector('#genWeeks').value) || genForm.weeks;
              genForm.practicesPerWeek = Number(containerEl.querySelector('#genPerWeek').value) || genForm.practicesPerWeek;
              genForm.minutesPerPractice = Number(containerEl.querySelector('#genMinutes').value) || genForm.minutesPerPractice;
              genForm.startDate = containerEl.querySelector('#genStart').value || genForm.startDate;
              let addedCount = 0;
              await withBusyButton(btnEvt.target, 'Generating...', async () => {
                const drills = window.PracticeCatalog.getDrills().filter(d => d.division === defaultDivision);
                const newPlans = buildSeasonPlan(defaultDivision, drills, genForm);
                addedCount = newPlans.length;
                plans.unshift(...newPlans);
                await savePlans(teamId, plans);
              });
              genOpen = false;
              window.showToast(`${addedCount} practice${addedCount === 1 ? '' : 's'} added`, 'info');
              refresh();
            });
          }
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
            btn.addEventListener('click', () => {
              const drill = window.PracticeCatalog.getDrills().find(d => d.id === btn.dataset.adddrill);
              if (!drill) return;
              withBusyButton(btn, 'Adding...', async () => {
                p.blocks.push(blockFromDrill(drill));
                await savePlans(teamId, plans); refresh();
              });
            });
          });
          const libSearch = containerEl.querySelector('#ppLibSearch');
          // refresh() rebuilds this whole panel's innerHTML (including this
          // input) on every keystroke -- same bug shape js/rules.js's search
          // box had, fixed there by restoring focus/cursor right after.
          if (libSearch) libSearch.addEventListener('input', e => {
            const pos = e.target.selectionStart;
            libFilter.query = e.target.value;
            refresh();
            const newSearch = containerEl.querySelector('#ppLibSearch');
            if (newSearch) { newSearch.focus(); newSearch.setSelectionRange(pos, pos); }
          });
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
            if (!(await confirmModal('Delete this practice plan?'))) return;
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
