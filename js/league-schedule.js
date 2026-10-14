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

   This tab's own week view lays its games out as a vertical stack
   (.tonightMergedList, the same class the Full Scoreboard widget uses
   for a whole division's worth of games) -- a week can run 17 games
   deep, and a horizontal ticker only ever showing ~2 of them at a time
   made browsing the whole week an extra, pointless scroll axis. The
   ticker treatment (.homeTicker, drag-to-scroll) moved to the Home
   screen instead (js/homepage.js's Upcoming section), where a quick
   glance at the next league date -- not reading every game -- is the
   actual job.
   ============================================================ */
(function () {
  let cache = null; // { source, season, capturedAt, note, weeks: [{date, games}] }

  function fmtWeekLabel(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Pure translation from a raw captured game record to the shared card
  // component -- exported so js/homepage.js's Upcoming ticker can build
  // the same cards for a date's games without duplicating this mapping.
  function gameCardHtml(g) {
    return window.TonightGames.mergedCardHtml({
      divisionId: 'fall', divisionName: g.division, time: g.from,
      teams: [{ name: g.home, teamId: null, score: null }, { name: g.away, teamId: null, score: null }],
      location: g.location,
    });
  }

  window.LeagueSchedule = {
    async ensureLoaded() {
      if (cache) return cache;
      cache = await fetch('data/mac-league-fall-2026-schedule.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => null);
      return cache;
    },

    // Sync getter -- same ensureLoaded-then-get convention as window.Schedule/
    // window.Practices. Every game in a week shares that week's single
    // `date`, so this is just a lookup, not a date-range scan.
    getGamesForDate(iso) {
      if (!cache || !cache.weeks) return [];
      const week = cache.weeks.find(w => w.date === iso);
      return week ? week.games : [];
    },

    // Every date any captured week covers, earliest first -- lets a caller
    // (homepage's Upcoming list) find "the next MAC League date" without
    // duplicating the nextIdx lookup render() already does.
    getAllDates() {
      if (!cache || !cache.weeks) return [];
      return cache.weeks.map(w => w.date);
    },

    gameCardHtml,

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
        if (!week.games.length) return '<div class="emptyState">No games captured for this week.</div>';
        return `<div class="tonightMergedList">${week.games.map(gameCardHtml).join('')}</div>`;
      }

      function refresh() {
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">Fall League Schedule</div>
            <div class="drillHeroSub">Every MAC League game, any division.</div>
          </div>
          ${weekChipsHtml()}
          ${gamesHtml()}
          <button class="btn btnGhost btnTiny" id="fallScheduleInfoBtn" style="margin-top:12px;">&#9432; About this data</button>`;
        const infoBtn = containerEl.querySelector('#fallScheduleInfoBtn');
        if (infoBtn) {
          infoBtn.addEventListener('click', () => {
            window.openInfoModal('About the Fall League Schedule', `<div class="helpText">${escapeHtml(cache.note)}</div>`);
          });
        }
        containerEl.querySelectorAll('[data-week]').forEach(btn => {
          btn.addEventListener('click', () => { activeIdx = Number(btn.dataset.week); refresh(); });
        });
      }
      refresh();
    },
  };
})();
