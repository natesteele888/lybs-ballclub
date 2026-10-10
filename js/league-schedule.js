/* ============================================================
   Fall League Schedule -- a hand-transcribed, point-in-time look at
   every remaining Fall 2026 MAC League game, every division, every
   town, not just ours. The live scraper (scripts/scrape-standings.mjs)
   can't reach this: macleague.org's real schedule lives at /schedule,
   which the site's own robots.txt explicitly disallows ("Disallow:
   /schedule") -- see that script's header for the existing precedent
   of not routing around a site's stated crawler policy. This file's
   data (data/mac-league-fall-2026-schedule.json) was hand-copied by
   the coach from macleague.org's own schedule page instead -- a real
   source, just not one this app can keep itself in sync with.

   NOT a live feed. There is no refresh process for this data (unlike
   shared/rules or shared/macLeagueStandings, which this app re-derives
   from a live source on a schedule) -- it goes stale the moment a game
   gets rescheduled or the season ends, and nothing will warn anyone
   when that happens. Revisit next season rather than trusting this
   file to still be accurate after capturedAt.

   Reuses window.TonightGames.mergedCardHtml() for the actual card --
   same component "League Tonight" uses, just fed {divisionId:'fall',
   divisionName, time, teams:[{name,teamId:null,score:null}], location}
   instead of a scraped game. teamId is deliberately null on every
   entry: these team names were never matched against
   shared/macLeagueStandings's own id list, so there's no logo to show
   and no "watch live" link to build -- mergedCardHtml() already
   handles a team with no teamId/logoUrl gracefully (js/tonight.js's
   teamHtml()), same as it does for a game whose scrape hasn't resolved
   a logo yet.
   ============================================================ */
(function () {
  let cache = null; // { source, season, capturedAt, note, weeks: [{date, games}] }

  // Same click-and-drag scroll js/homepage.js's own ticker uses -- that
  // file's own comment explains why it's not a shared util.js export:
  // deliberately self-contained modules, small enough not to matter.
  function enableDragScroll(el) {
    let down = false, dragged = false, startX = 0, startScroll = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      down = true; dragged = false;
      startX = e.clientX; startScroll = el.scrollLeft;
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) <= 4) return;
      dragged = true;
      el.classList.add('dragging');
      el.scrollLeft = startScroll - dx;
    });
    function end() { down = false; el.classList.remove('dragging'); }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    el.addEventListener('click', e => {
      if (dragged) { e.stopPropagation(); e.preventDefault(); }
      dragged = false;
    }, true);
  }

  function fmtWeekLabel(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  window.LeagueSchedule = {
    async ensureLoaded() {
      if (cache) return cache;
      cache = await fetch('data/mac-league-fall-2026-schedule.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => null);
      return cache;
    },

    render(containerEl) {
      if (!cache || !cache.weeks || !cache.weeks.length) {
        containerEl.innerHTML = '<div class="emptyState">No league schedule captured yet.</div>';
        return;
      }
      const today = todayStr();
      // Default to the next week that hasn't happened yet -- the whole
      // point of this tab is looking ahead, not landing on a date
      // that's already passed. Falls back to the last captured week if
      // every one of them is already in the past (the season's over).
      const nextIdx = cache.weeks.findIndex(w => w.date >= today);
      let activeIdx = nextIdx === -1 ? cache.weeks.length - 1 : nextIdx;

      function weekChipsHtml() {
        return `<div class="drillChipRow" style="margin-bottom:12px;">
          ${cache.weeks.map((w, i) => `<button class="drillChip ${i === activeIdx ? 'drillChipOn' : ''}" data-week="${i}">${escapeHtml(fmtWeekLabel(w.date))}</button>`).join('')}
        </div>`;
      }

      function gamesHtml() {
        const week = cache.weeks[activeIdx];
        const cards = week.games.map(g => window.TonightGames.mergedCardHtml({
          divisionId: 'fall', divisionName: g.division, time: g.from,
          teams: [{ name: g.home, teamId: null, score: null }, { name: g.away, teamId: null, score: null }],
          location: g.location,
        })).join('');
        return `<div class="homeTicker" id="fallScheduleTicker">${cards}</div>`;
      }

      function refresh() {
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">Fall League Schedule</div>
            <div class="drillHeroSub">Every MAC League game, any division, hand-captured from macleague.org on ${escapeHtml(cache.capturedAt)}.</div>
          </div>
          ${weekChipsHtml()}
          ${gamesHtml()}
          <div class="helpText" style="margin-top:14px;">${escapeHtml(cache.note)}</div>`;
        containerEl.querySelectorAll('[data-week]').forEach(btn => {
          btn.addEventListener('click', () => { activeIdx = Number(btn.dataset.week); refresh(); });
        });
        const ticker = containerEl.querySelector('#fallScheduleTicker');
        if (ticker) enableDragScroll(ticker);
      }
      refresh();
    },
  };
})();
