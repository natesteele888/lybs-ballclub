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
    const data = await fetch('data/pitch-smart-rules.json').then(r => r.json()).catch(() => ({ divisions: {} }));
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

  window.PitchSmart = {
    ensureLoaded,
    computeStatus,
    appearancesByPitcher,

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
  };
})();
