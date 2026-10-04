/* ============================================================
   Pitch Smart eligibility -- computes who's eligible to pitch based
   on recent pitch counts, using MAC League's own daily-max/rest-day
   tables (data/pitch-smart-rules.json). Two data sources feed the
   same calculator:

   1. OUR team's pitch counts -- logged by the coach directly on
      each completed game (teams/{teamId}/schedule's games get an
      optional `pitchCounts: [{name, pitches}]` array alongside the
      score). Works today, no dependency on macleague.org at all.

   2. Opponent pitch counts -- meant to mirror from MAC League's own
      public Pitch Smart page (macleague.org/division/{id}/pitchsmart),
      into shared/pitchSmart, same scheduled-job pattern as
      standings. AS OF THIS WRITING that page has no data to verify
      its structure against (pitch-count reporting is a Spring-only
      requirement; it's empty in Summer/Fall) -- see
      scripts/scrape-pitchsmart.mjs's header for the honest state of
      that piece. The UI below degrades gracefully to an empty state
      when shared/pitchSmart has nothing for a team yet, rather than
      pretending data exists.

   Both sources feed the SAME computeStatus() below -- we compute
   eligibility ourselves from raw {date, pitches} appearances rather
   than trusting a pre-computed "eligible" flag from either source,
   so the logic only has to be right once.

   IMPORTANT: this is a planning aid, not an official ruling. The
   umpire's and league's own records are what actually count for a
   forfeit -- always double check anything borderline.
   ============================================================ */
(function () {
  let rulesCache = null; // {divisions: {...}}

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function tierFor(pitches, rules) {
    return rules.tiers.find(t => pitches >= t.min && pitches <= t.max) || rules.tiers[rules.tiers.length - 1];
  }

  async function ensureLoaded() {
    if (rulesCache) return rulesCache;
    const data = await fetch('data/pitch-smart-rules.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => ({ divisions: {} }));
    rulesCache = data.divisions || {};
    return rulesCache;
  }

  // appearances: [{date:'YYYY-MM-DD', pitches:N}] (any order, any staleness --
  // this filters to what's relevant itself). asOfDate: 'YYYY-MM-DD', defaults
  // to today. Returns {eligible, eligibleOn (null if eligible now), dailyMax,
  // recentPitches (sum over the last calendar day pitched), reason}.
  function computeStatus(appearances, division, asOfDate) {
    asOfDate = asOfDate || new Date().toISOString().slice(0, 10);
    const rules = rulesCache && rulesCache[division];
    if (!rules) return { eligible: true, eligibleOn: null, dailyMax: null, reason: 'No pitch-count table for this division.' };
    const sorted = (appearances || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    // Rule 1: rest days owed from any appearance in the last 10 days (covers
    // the longest rest tier, 4 days, with margin).
    const cutoff = addDays(asOfDate, -10);
    let eligibleFromRest = null;
    for (const a of sorted) {
      if (a.date < cutoff || a.date > asOfDate) continue;
      const tier = tierFor(a.pitches, rules);
      const elig = addDays(a.date, tier.restDays + 1);
      if (!eligibleFromRest || elig > eligibleFromRest) eligibleFromRest = elig;
    }

    // Rule 2: no pitcher may appear 3 consecutive calendar days, regardless
    // of pitch count.
    const yesterday = addDays(asOfDate, -1), dayBefore = addDays(asOfDate, -2);
    const pitchedYesterday = sorted.some(a => a.date === yesterday);
    const pitchedDayBefore = sorted.some(a => a.date === dayBefore);
    const eligibleFromConsecutive = (pitchedYesterday && pitchedDayBefore) ? addDays(asOfDate, 1) : null;

    const candidates = [eligibleFromRest, eligibleFromConsecutive].filter(Boolean);
    const eligibleOn = candidates.length ? candidates.sort().pop() : null;
    const eligible = !eligibleOn || eligibleOn <= asOfDate;
    const lastAppearance = sorted.length ? sorted[sorted.length - 1] : null;
    return {
      eligible,
      eligibleOn: eligible ? null : eligibleOn,
      dailyMax: rules.dailyMax,
      lastPitches: lastAppearance ? lastAppearance.pitches : null,
      lastDate: lastAppearance ? lastAppearance.date : null,
    };
  }

  // Flattens a team's games (each optionally carrying pitchCounts:
  // [{name, pitches}]) into {pitcherName: [{date, pitches}]}.
  function appearancesByPitcher(games) {
    const byPitcher = {};
    (games || []).forEach(g => {
      if (!g.date || !Array.isArray(g.pitchCounts)) return;
      g.pitchCounts.forEach(pc => {
        if (!pc.name || pc.pitches == null) return;
        (byPitcher[pc.name] = byPitcher[pc.name] || []).push({ date: g.date, pitches: Number(pc.pitches) });
      });
    });
    return byPitcher;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function statusHtml(name, status) {
    const cls = status.eligible ? 'badgeW' : 'badgeL';
    const label = status.eligible ? 'Eligible' : `Out until ${status.eligibleOn}`;
    const sub = status.lastDate ? `Last pitched ${status.lastDate} (${status.lastPitches} pitches)` : 'No appearances logged';
    return `
      <div class="listRow" style="cursor:default;">
        <div class="listRowMain">
          <div class="listRowTitle">${escapeHtml(name)}</div>
          <div class="listRowSub">${escapeHtml(sub)}</div>
        </div>
        <span class="badge ${cls}">${escapeHtml(label)}</span>
      </div>`;
  }

  // The actual daily-max + rest-day table, on full display -- the weekly
  // calendar below shows what it means for a given pitcher, but a coach
  // needs the raw numbers in front of them too, not just a computed
  // eligible/resting badge.
  function rulesCardHtml(division) {
    const rules = rulesCache && rulesCache[division];
    if (!rules) return '';
    const tierRow = (t) => {
      const range = t.max >= 999 ? `${t.min}+` : `${t.min}-${t.max}`;
      const rest = t.restDays === 0 ? 'No rest' : `${t.restDays} day${t.restDays > 1 ? 's' : ''} rest`;
      return `
        <div class="pcRuleRow">
          <span class="pcRuleRange">${escapeHtml(range)}</span>
          <span class="pcRuleRest">${escapeHtml(rest)}</span>
        </div>`;
    };
    return `
      <div class="detailCard" style="margin-bottom:16px;">
        <div class="sectionHeader" style="margin-bottom:12px;">
          <h3 style="margin:0;">${escapeHtml(division)} Pitch Count Rules</h3>
          <div class="pcStatTile" style="flex:0 0 auto;min-width:76px;padding:8px 14px;">
            <div class="pcStatValue">${escapeHtml(String(rules.dailyMax))}</div>
            <div class="pcStatLabel">Daily Max</div>
          </div>
        </div>
        <div class="pcRulesList">${rules.tiers.map(tierRow).join('')}</div>
      </div>`;
  }

  window.PitchSmart = {
    ensureLoaded,
    computeStatus,
    appearancesByPitcher,

    // Renders the full daily-max/rest-day table for a division -- call once
    // ensureLoaded() has resolved. No-op (empty) if the division isn't in
    // data/pitch-smart-rules.json.
    renderRulesCard(containerEl, division) {
      containerEl.innerHTML = rulesCardHtml(division);
    },

    // Renders our own roster's current eligibility, computed from this
    // team's own logged pitchCounts across teams/{teamId}/schedule.
    renderOurEligibility(containerEl, games, division, asOfDate) {
      const byPitcher = appearancesByPitcher(games);
      const names = Object.keys(byPitcher);
      if (!names.length) {
        containerEl.innerHTML = '<div class="emptyState">No pitch counts logged yet. Log them on each completed game\'s detail page.</div>';
        return;
      }
      const rows = names.map(name => statusHtml(name, computeStatus(byPitcher[name], division, asOfDate))).join('');
      containerEl.innerHTML = `<div class="listBody">${rows}</div>`;
    },

    // Renders an opponent's eligibility from shared/pitchSmart, with an
    // honest empty state when nothing's been mirrored for them yet.
    async renderOpponentEligibility(containerEl, opponentName, division, asOfDate) {
      const data = await window.dbGet(window.sharedPath('pitchSmart'));
      const team = data && data[opponentName];
      if (!team || !team.pitchers || !team.pitchers.length) {
        containerEl.innerHTML = `
          <div class="emptyState">
            No MAC League pitch count data mirrored for ${escapeHtml(opponentName)} yet.<br>
            <span class="helpText">This mirrors from macleague.org once Spring pitch-count reporting is active -- see scripts/scrape-pitchsmart.mjs.</span>
          </div>`;
        return;
      }
      const rows = team.pitchers.map(p => statusHtml(p.name, computeStatus(p.appearances, division, asOfDate))).join('');
      containerEl.innerHTML = `
        <div class="helpText">Mirrored from macleague.org's Pitch Smart page.</div>
        <div class="listBody">${rows}</div>`;
    },

    // Monday-start week containing dateStr.
    startOfWeek(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay(); // 0 = Sunday
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
      return d.toISOString().slice(0, 10);
    },
    addDays,

    // The calendar view MAC League's own rest-day example already describes
    // day by day ("pitches 36 on Monday -> can't pitch Tuesday or Wednesday
    // -> eligible again Thursday") -- one row per pitcher who has any logged
    // appearances, one column per day of the given week, our own scheduled
    // games marked on their column so eligibility reads directly against
    // the actual upcoming slate instead of a single yes/no badge.
    renderWeeklyCalendar(containerEl, games, division, weekStart) {
      const start = weekStart || window.PitchSmart.startOfWeek(new Date().toISOString().slice(0, 10));
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const dayLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      const gamesByDate = {};
      (games || []).forEach(g => { if (g.date) gamesByDate[g.date] = g; });
      const byPitcher = appearancesByPitcher(games);
      const names = Object.keys(byPitcher);

      const headerCells = days.map((d, i) => {
        const game = gamesByDate[d];
        const mmdd = d.slice(5).replace('-', '/');
        return `<th class="${game ? 'pcGameCol' : ''}">${dayLabels[i]}<br>${mmdd}${game ? `<div class="pcGameTag">${game.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(game.opponent || '')}</div>` : ''}</th>`;
      }).join('');

      const bodyRows = names.length ? names.map(name => {
        const apps = byPitcher[name];
        const cells = days.map(d => {
          const appearance = apps.find(a => a.date === d);
          if (appearance) return `<td class="pcCellPitched" title="${escapeHtml(name)} pitched ${appearance.pitches} on ${d}">${escapeHtml(String(appearance.pitches))}</td>`;
          const status = computeStatus(apps.filter(a => a.date <= d), division, d);
          return status.eligible
            ? '<td class="pcCellEligible">&#10003;</td>'
            : `<td class="pcCellRest" title="Out until ${status.eligibleOn}">R</td>`;
        }).join('');
        return `<tr><td class="pcPitcherName">${escapeHtml(name)}</td>${cells}</tr>`;
      }).join('') : `<tr><td colspan="8"><div class="emptyState">No pitch counts logged yet -- log them on each completed game's detail page.</div></td></tr>`;

      containerEl.innerHTML = `
        <div class="pitchCalendarWrap">
          <table class="pitchCalendar">
            <thead><tr><th>Pitcher</th>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
        <div class="helpText" style="margin-top:10px;">
          <span class="pcLegendDot pcCellEligible">&#10003;</span> eligible &nbsp;
          <span class="pcLegendDot pcCellRest">R</span> resting &nbsp;
          <span class="pcLegendDot pcCellPitched">#</span> pitched that day, pitch count shown
        </div>`;
    },
  };
})();
