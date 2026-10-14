/* ============================================================
   Player Benchmarks -- a coach's record of which skill-ladder
   benchmarks (data/skill-benchmarks-seed.json -- 34 benchmarks
   across T-Ball/Rookies/Minors/Majors, sourced from USA Baseball's
   Skills Matrix + ADM report, the same list js/practice-catalog.js's
   Benchmarks tab already shows read-only) a given player has
   cleared. Shown inside that player's Roster edit screen, same
   "mount a small module inside player-detail, own its own subtree"
   shape as js/coach-notes.js right above it -- but visible to the
   whole team, not private the way a coach's own notes are: a
   cleared benchmark is closer to Awards than a coach's notebook.

   Scoped by DIVISION, not literal age. This app stores no
   birthdate anywhere (see lybs-reporting's own privacy rules,
   mirrored here, and js/roster.js's own header comment) -- so
   "benchmarks tied to league-age timing" means "whichever division
   this player's TEAM currently plays," read the same way
   js/team-page.js/js/pitch-smart.js already read it
   (window.TeamConfig.current().macLeagueDivisionName), passed
   through window.shortDivisionName() for the same raw-name-to-
   seed-name bridge that function exists for. A player's benchmark
   ladder is simply their team's division -- there's no per-player
   division field, and none is needed.

   Benchmarks themselves are NOT re-fetched here -- reuses
   window.PracticeCatalog's own shared cache (ensureLoaded/
   getBenchmarks), same seed, same shared/skillBenchmarks mirror,
   not a second copy. ensureLoaded(false) is always safe to call
   from here even if a board member already loaded it with the real
   isBoard flag elsewhere this session -- see that function's own
   header comment: it memoizes and never downgrades.

   Prerequisite locking only looks WITHIN the player's current
   division (e.g. Majors' "Situational hitting" requires Majors'
   "Live pitching" be cleared first) -- a prerequisite that belongs
   to an EARLIER division is shown as plain "Builds on" context, not
   enforced, since this app has no per-player promotion history to
   check it against (a player who just joined at Majors has no
   tracked Minors benchmarks to have cleared). Locking on those
   would make most of Majors permanently unclearable for exactly the
   players this is meant to help track.

   Stored at teams/{teamId}/playerBenchmarks/{playerId} =
   [benchmarkId, ...], coach-write (same gate as roster edits),
   team-read (see database.rules.json).
   ============================================================ */
(function () {
  const cache = {}; // teamId -> {playerId: [benchmarkId,...]}
  const pending = {}; // teamId -> in-flight ensureLoaded() promise

  // Same pending[teamId] in-flight-promise guard as awards.js/equipment.js/
  // roster.js etc -- cheap insurance against two near-simultaneous renders
  // (e.g. opening two different players' edit screens in quick succession)
  // clobbering each other's cache entry.
  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const data = await window.dbGet(window.teamPath(teamId, 'playerBenchmarks'));
        cache[teamId] = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
        return cache[teamId];
      } finally {
        delete pending[teamId];
      }
    })();
    return pending[teamId];
  }
  async function save(teamId) {
    await window.dbPut(window.teamPath(teamId, 'playerBenchmarks'), cache[teamId]);
  }

  window.PlayerBenchmarks = {
    // containerEl already exists in the DOM (inside the player edit
    // form) -- this owns just its own subtree and re-renders itself
    // independently of the form around it, same contract as
    // window.CoachNotes.render.
    async render(containerEl, teamId, playerId) {
      const [all] = await Promise.all([
        ensureLoaded(teamId),
        window.PracticeCatalog.ensureLoaded(false),
      ]);
      const cleared = new Set(all[playerId] || (all[playerId] = []));

      const division = window.shortDivisionName(window.TeamConfig.current().macLeagueDivisionName || '');
      const allBenchmarks = window.PracticeCatalog.getBenchmarks();
      const allBenchmarksById = {};
      allBenchmarks.forEach(b => { allBenchmarksById[b.id] = b; });
      const benchmarks = allBenchmarks.filter(b => b.division === division);
      const benchmarksById = {};
      benchmarks.forEach(b => { benchmarksById[b.id] = b; });

      if (!division || !benchmarks.length) {
        containerEl.innerHTML = `
          <div class="sectionLabel" style="margin-top:18px;">Benchmarks</div>
          <div class="helpText">No benchmark ladder for this team's division yet.</div>`;
        return;
      }

      const categories = [...new Set(benchmarks.map(b => b.category))];

      function refresh() {
        containerEl.innerHTML = `
          <div class="sectionLabel" style="margin-top:18px;">Benchmarks</div>
          <div class="helpText" style="margin-bottom:8px;">${escapeHtml(division)} skill ladder -- what this player has cleared so far.</div>
          ${categories.map(cat => {
            const rows = benchmarks.filter(b => b.category === cat).map(b => {
              // Only a same-division prerequisite gates this one -- see
              // header comment on why a prior-division prerequisite is
              // shown but not enforced.
              const samedivisionPrereqs = (b.prerequisiteIds || []).map(id => benchmarksById[id]).filter(Boolean);
              const locked = !cleared.has(b.id) && samedivisionPrereqs.some(p => !cleared.has(p.id));
              const allPrereqNames = (b.prerequisiteIds || []).map(id => allBenchmarksById[id] && allBenchmarksById[id].skill).filter(Boolean);
              return `
                <label class="teamCheckRow ${locked ? 'playerBenchmarkLocked' : ''}">
                  <input type="checkbox" class="teamCheck" data-benchmark="${escapeHtml(b.id)}" ${cleared.has(b.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                  <span class="listRowMain">
                    <span class="listRowTitle" style="font-weight:600;font-size:13.5px;">${escapeHtml(b.skill)}</span>
                    ${allPrereqNames.length ? `<span class="listRowSub">Builds on: ${allPrereqNames.map(escapeHtml).join(', ')}</span>` : ''}
                  </span>
                </label>`;
            }).join('');
            return `
              <div class="rulesGroup">
                <div class="rulesGroupHeader">${escapeHtml(cat)}</div>
                <div class="teamCheckList" style="margin-top:8px;">${rows}</div>
              </div>`;
          }).join('')}`;

        containerEl.querySelectorAll('[data-benchmark]').forEach(cb => {
          cb.addEventListener('change', async () => {
            const id = cb.dataset.benchmark;
            if (cb.checked) cleared.add(id); else cleared.delete(id);
            all[playerId] = [...cleared];
            await save(teamId);
            refresh();
          });
        });
      }
      refresh();
    },
  };
})();
