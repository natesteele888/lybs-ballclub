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

  // order: [name, ...], index 0 = ace. -> {name: rank (1-based)}. A pitcher
  // missing from `order` just gets no rank -- sorts after ranked pitchers
  // rather than erroring, since not every pitcher needs a set depth spot.
  function rankMapFromOrder(order) {
    const map = {};
    (order || []).forEach((name, i) => { map[name] = i + 1; });
    return map;
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

  // rank/team are both optional -- omitted entirely in the simpler
  // single-team previews (a game's detail page, Home's "Who Can Pitch
  // Today", an opponent's Team Page) that existed before depth order did.
  function statusHtml(name, status, rank, team) {
    const cls = status.eligible ? 'badgeW' : 'badgeL';
    const label = status.eligible ? 'Eligible' : `Out until ${status.eligibleOn}`;
    const sub = [team, status.lastDate ? `Last pitched ${status.lastDate} (${status.lastPitches} pitches)` : 'No appearances logged']
      .filter(Boolean).map(escapeHtml).join(' &middot; ');
    return `
      <div class="listRow" style="cursor:default;">
        <div class="listRowMain">
          <div class="listRowTitle">${rank ? `<span class="pcPitcherRank">#${rank}</span> ` : ''}${escapeHtml(name)}</div>
          <div class="listRowSub">${sub}</div>
        </div>
        <span class="badge ${cls}">${escapeHtml(label)}</span>
      </div>`;
  }

  // Unavailable pitchers first and called out by count -- that's the actual
  // question a coach has open this page to answer ("who CAN'T I use"), not
  // a flat alphabetical roster dump that happens to include a badge. Eligible
  // names still follow underneath, just not competing for top billing.
  // Within each group, a known depth rank sorts first (losing the #1 is a
  // bigger deal than losing the #4, so that's the row that should catch
  // your eye first) -- rankMap/teamLabel are both optional.
  function eligibilityListHtml(byPitcher, division, asOfDate, rankMap, teamLabel) {
    const names = Object.keys(byPitcher);
    if (!names.length) return '<div class="emptyState">No pitch counts logged yet. Log them on each completed game\'s detail page.</div>';
    const statuses = names.map(name => ({ name, status: computeStatus(byPitcher[name], division, asOfDate), rank: rankMap && rankMap[name] }));
    const byRankThen = (fallback) => (a, b) => (a.rank || 999) - (b.rank || 999) || fallback(a, b);
    const unavailable = statuses.filter(s => !s.status.eligible)
      .sort(byRankThen((a, b) => (a.status.eligibleOn || '').localeCompare(b.status.eligibleOn || '')));
    const eligible = statuses.filter(s => s.status.eligible)
      .sort(byRankThen((a, b) => a.name.localeCompare(b.name)));
    return `
      ${unavailable.length
        ? `<div class="sectionLabel" style="color:#ff8a8a;">Unavailable (${unavailable.length})</div>
           <div class="listBody">${unavailable.map(s => statusHtml(s.name, s.status, s.rank, teamLabel)).join('')}</div>`
        : '<div class="emptyState" style="color:#5fd989;">Everyone\'s eligible right now.</div>'}
      ${eligible.length
        ? `<div class="sectionLabel" style="margin-top:14px;">Eligible (${eligible.length})</div>
           <div class="listBody">${eligible.map(s => statusHtml(s.name, s.status, s.rank, teamLabel)).join('')}</div>`
        : ''}`;
  }

  // The actual daily-max + rest-day table, on full display -- the weekly
  // calendar below shows what it means for a given pitcher, but a coach
  // needs the raw numbers in front of them too, not just a computed
  // eligible/resting badge. A division picker lets a coach check another
  // division's table for reference (a player moving up, a cross-division
  // question) without it defaulting to anything but this team's own.
  function rulesCardHtml(division, divisions) {
    const rules = rulesCache && rulesCache[division];
    // Small cards in a wrapping row, not one full-width row per tier -- five
    // tiers were costing five row-heights of vertical space for what's
    // really just five short number pairs, pushing the actually-important
    // content (who's unavailable) below the fold.
    const tierRow = (t) => {
      const range = t.max >= 999 ? `${t.min}+` : `${t.min}-${t.max}`;
      const rest = t.restDays === 0 ? 'No rest' : `${t.restDays}d rest`;
      return `
        <div class="pcTierCard">
          <div class="pcTierRange">${escapeHtml(range)}</div>
          <div class="pcTierRest">${escapeHtml(rest)}</div>
        </div>`;
    };
    const picker = divisions.length > 1
      ? `<select id="pcRulesDivision" class="pcRulesSelect">${divisions.map(d => `<option value="${escapeHtml(d)}" ${d === division ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select>`
      : `<div class="pcRulesSelect" style="cursor:default;">${escapeHtml(division)}</div>`;
    if (!rules) {
      return `
        <div class="detailCard pcRulesCard">
          <div class="sectionLabel" style="margin:0 0 4px;">Pitch Count Rules</div>
          ${picker}
          <div class="emptyState">No pitch-count table for this division.</div>
        </div>`;
    }
    return `
      <div class="detailCard pcRulesCard">
        <div class="pcRulesHeader">
          <div>
            <div class="sectionLabel" style="margin:0 0 4px;">Pitch Count Rules</div>
            ${picker}
          </div>
          <div class="pcStatTile pcRulesMaxTile">
            <div class="pcStatValue">${escapeHtml(String(rules.dailyMax))}</div>
            <div class="pcStatLabel">Daily Max</div>
          </div>
        </div>
        <div class="pcRulesList">${rules.tiers.map(tierRow).join('')}</div>
      </div>`;
  }

  // Collapsed by default behind a toggle (own section, below the main
  // eligible/unavailable list) -- most visits are "who's out", not "let me
  // re-rank the staff". canEdit gates the editing controls only; the
  // ranked list itself stays visible to anyone once it exists, same as
  // Awards' winners are visible to non-coaches.
  function depthOrderEditorHtml(order, canEdit, expanded, addingCustom, addOptions, canSuggest) {
    if (!expanded) {
      if (!canEdit && !order.length) return '';
      return `<button class="btn btnGhost btnTiny" id="pdToggle" style="margin-top:12px;">${order.length ? `Depth order (${order.length}) &rsaquo;` : 'Set depth order &rsaquo;'}</button>`;
    }
    const rows = order.map((name, i) => `
      <div class="listRow" style="cursor:default;">
        <div class="depthRank">${i + 1}</div>
        <div class="listRowMain"><div class="listRowTitle">${escapeHtml(name)}</div></div>
        ${canEdit ? `
          <div class="depthRowActions">
            <button class="btn btnTiny" data-pdup="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
            <button class="btn btnTiny" data-pddown="${i}" ${i === order.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button class="btn btnTiny" data-pdremove="${i}">&times;</button>
          </div>` : ''}
      </div>`).join('') || '<div class="emptyState">No depth order set yet.</div>';
    return `
      <div class="sectionHeader" style="margin-top:14px;margin-bottom:0;">
        <div class="sectionLabel" style="margin:0;">Pitching Depth Order</div>
        <button class="btn btnGhost btnTiny" id="pdToggle">Collapse</button>
      </div>
      <div class="helpText" style="margin:4px 0 8px;">Rank matters when someone's unavailable -- losing the #1 means more than losing the #4.</div>
      <div class="listBody">${rows}</div>
      ${canEdit ? `
        ${canSuggest ? '<button class="btn btnGhost btnTiny" id="pdSuggest" style="margin-top:10px;">Suggest from imported stats</button>' : ''}
        ${addOptions && addOptions.length ? `
          <div class="drillChipRow" style="margin-top:10px;">
            ${addOptions.map(n => `<button class="drillChip" data-pdadd="${escapeHtml(n)}">+ ${escapeHtml(n)}</button>`).join('')}
          </div>` : ''}
        ${addingCustom
          ? `<div class="drillAddRow" style="margin-top:8px;">
               <input class="drillFreeInput" id="pdCustomInput" placeholder="Pitcher name" maxlength="40" autofocus>
               <button class="btn btnSmall" id="pdCustomSave">Add</button>
             </div>`
          : '<button class="btn btnGhost btnTiny" id="pdAddCustom" style="margin-top:8px;">+ Add by name&hellip;</button>'}
      ` : ''}`;
  }

  // The "default to ineligible, across every team we have data for" view --
  // merges our own logged pitch counts with every division team mirrored
  // into shared/pitchSmart, sorted by depth rank first (a #1 going down
  // matters more than a #4, regardless of whose #1 it is) and by return
  // date second. Only ever lists UNAVAILABLE pitchers -- a combined
  // "everyone who's fine" list across a whole division would be a long,
  // mostly-irrelevant wall of names; the single-team picker below still
  // covers that when a coach wants one team's full breakdown.
  async function allTeamsUnavailableHtml(opts, ourRankMap) {
    const sharedData = (await window.dbGet(window.sharedPath('pitchSmart'))) || {};
    const groups = [{ label: opts.ourLabel || 'Our Team', byPitcher: appearancesByPitcher(opts.games), rankMap: ourRankMap }];
    (opts.teamOptions || []).forEach(t => {
      const team = sharedData[t];
      if (team && team.pitchers && team.pitchers.length) {
        const byPitcher = {};
        team.pitchers.forEach(p => { byPitcher[p.name] = p.appearances; });
        groups.push({ label: t, byPitcher, rankMap: rankMapFromOrder(team.depthOrder) });
      }
    });
    const all = [];
    groups.forEach(g => {
      Object.keys(g.byPitcher).forEach(name => {
        const status = computeStatus(g.byPitcher[name], opts.division, opts.asOfDate);
        if (!status.eligible) all.push({ name, team: g.label, status, rank: g.rankMap[name] });
      });
    });
    if (!all.length) {
      return '<div class="emptyState" style="color:#5fd989;">No one\'s unavailable across the teams we have data for.</div>';
    }
    all.sort((a, b) => (a.rank || 999) - (b.rank || 999) || (a.status.eligibleOn || '').localeCompare(b.status.eligibleOn || ''));
    return `
      <div class="sectionLabel" style="color:#ff8a8a;">Unavailable Across the League (${all.length})</div>
      <div class="listBody">${all.map(s => statusHtml(s.name, s.status, s.rank, s.team)).join('')}</div>
      <div class="helpText" style="margin-top:10px;">Only covers teams with logged pitch counts -- ours directly, others from whatever's been mirrored or shared. Switch the picker above for one team's full eligible list too.</div>`;
  }

  window.PitchSmart = {
    ensureLoaded,
    computeStatus,
    appearancesByPitcher,

    // Renders the full daily-max/rest-day table for a division -- call once
    // ensureLoaded() has resolved. Owns its own division picker (defaults to
    // this team's own division, switchable to any other one in
    // data/pitch-smart-rules.json purely for reference -- not remembered
    // across visits, so it's never silently showing the wrong division).
    renderRulesCard(containerEl, defaultDivision) {
      const divisions = Object.keys(rulesCache || {});
      if (!divisions.length) { containerEl.innerHTML = ''; return; }
      let selected = divisions.includes(defaultDivision) ? defaultDivision : divisions[0];
      function draw() {
        containerEl.innerHTML = rulesCardHtml(selected, divisions);
        const sel = containerEl.querySelector('#pcRulesDivision');
        if (sel) sel.addEventListener('change', () => { selected = sel.value; draw(); });
      }
      draw();
    },

    // Renders our own roster's current eligibility, computed from this
    // team's own logged pitchCounts across teams/{teamId}/schedule.
    renderOurEligibility(containerEl, games, division, asOfDate) {
      containerEl.innerHTML = eligibilityListHtml(appearancesByPitcher(games), division, asOfDate);
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
      const byPitcher = {};
      team.pitchers.forEach(p => { byPitcher[p.name] = p.appearances; });
      containerEl.innerHTML = `
        <div class="helpText">Mirrored from macleague.org's Pitch Smart page.</div>
        ${eligibilityListHtml(byPitcher, division, asOfDate)}`;
    },

    // The Pitching tab's main section: unavailable pitchers across every
    // team we have data for by default ("ALL"), or one team's full
    // eligible+unavailable breakdown when the picker is switched -- our own
    // roster, or any team in our division (same daily-max/rest-day table
    // applies to all of them). Owns the team picker itself, same
    // self-contained pattern as renderRulesCard's division picker above.
    // teamOptions is this team's own division roster from
    // LeagueTeams.teamsInDivision() -- the caller resolves that (and awaits
    // LeagueTeams.ensureLoaded() first) since this module has no reason to
    // know about league-teams.js otherwise. opts.teamId/opts.roster feed
    // the depth-order editor (our own pitcherDepth, and roster names to
    // quick-add from) -- everything else about depth order, including
    // opponent teams', is self-contained in here same as the rest.
    renderEligibilityPanel(containerEl, opts) {
      opts = opts || {};
      let selected = 'ALL';
      let ourDepth = null; // lazy-loaded teams/{teamId}/pitcherDepth
      let editingDepth = false;
      let addingCustomDepth = false;

      async function loadOurDepth() {
        if (ourDepth) return ourDepth;
        const data = await window.dbGet(window.teamPath(opts.teamId, 'pitcherDepth'));
        ourDepth = Array.isArray(data) ? data : [];
        return ourDepth;
      }

      function wireDepthEditor(slotEl, cfg) {
        // cfg.addOptions is the full candidate pool (every roster/known
        // name), fixed for this draw() -- filtered fresh against cfg.order
        // on every redraw so a name just added (or removed) stops (or
        // starts) showing as a quick-add chip immediately. A rank change
        // re-runs the outer draw() (not just this editor's own redraw())
        // so the eligible/unavailable list above picks up the new ranks
        // too, instead of showing them only after the team picker is
        // touched again -- editingDepth/addingCustomDepth are both outer-
        // scoped and survive a full draw(), so the editor stays open.
        function redraw() {
          const available = (cfg.addOptions || []).filter(n => !cfg.order.includes(n));
          slotEl.innerHTML = depthOrderEditorHtml(cfg.order, cfg.canEdit, editingDepth, addingCustomDepth, available, !!cfg.suggestFrom);
          const toggle = slotEl.querySelector('#pdToggle');
          if (toggle) toggle.addEventListener('click', () => { editingDepth = !editingDepth; addingCustomDepth = false; redraw(); });
          if (!editingDepth || !cfg.canEdit) return;
          slotEl.querySelectorAll('[data-pdup]').forEach(btn => btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.pdup);
            [cfg.order[i - 1], cfg.order[i]] = [cfg.order[i], cfg.order[i - 1]];
            await cfg.onSave(cfg.order); draw();
          }));
          slotEl.querySelectorAll('[data-pddown]').forEach(btn => btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.pddown);
            [cfg.order[i + 1], cfg.order[i]] = [cfg.order[i], cfg.order[i + 1]];
            await cfg.onSave(cfg.order); draw();
          }));
          slotEl.querySelectorAll('[data-pdremove]').forEach(btn => btn.addEventListener('click', async () => {
            cfg.order.splice(Number(btn.dataset.pdremove), 1);
            await cfg.onSave(cfg.order); draw();
          }));
          slotEl.querySelectorAll('[data-pdadd]').forEach(btn => btn.addEventListener('click', async () => {
            cfg.order.push(btn.dataset.pdadd);
            await cfg.onSave(cfg.order); draw();
          }));
          const customBtn = slotEl.querySelector('#pdAddCustom');
          if (customBtn) customBtn.addEventListener('click', () => { addingCustomDepth = true; redraw(); });
          const customSave = slotEl.querySelector('#pdCustomSave');
          if (customSave) customSave.addEventListener('click', async () => {
            const input = slotEl.querySelector('#pdCustomInput');
            const name = (input.value || '').trim();
            addingCustomDepth = false;
            if (name && !cfg.order.includes(name)) { cfg.order.push(name); await cfg.onSave(cfg.order); draw(); }
            else redraw();
          });
          const suggestBtn = slotEl.querySelector('#pdSuggest');
          if (suggestBtn) suggestBtn.addEventListener('click', async () => {
            const suggested = window.StatsImport.suggestedPitchingOrder(cfg.suggestFrom).map(r => r.name);
            cfg.order.length = 0;
            cfg.order.push(...suggested);
            await cfg.onSave(cfg.order); draw();
          });
        }
        redraw();
      }

      async function draw() {
        const options = [
          '<option value="ALL">All Teams</option>',
          `<option value="OUR_TEAM">${escapeHtml(opts.ourLabel || 'Our Team')}</option>`,
          ...(opts.teamOptions || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
        ].join('');
        containerEl.innerHTML = `
          <div class="detailCard pcRulesCard">
            <div class="sectionLabel" style="margin:0 0 4px;">Pitcher Availability</div>
            <select id="pcEligTeam" class="pcRulesSelect">${options}</select>
            <div id="pcEligBody" style="margin-top:12px;"><div class="emptyState">Loading&hellip;</div></div>
            <div id="pcDepthSlot"></div>
          </div>`;
        const sel = containerEl.querySelector('#pcEligTeam');
        sel.value = selected;
        sel.addEventListener('change', () => { selected = sel.value; editingDepth = false; addingCustomDepth = false; draw(); });
        const body = containerEl.querySelector('#pcEligBody');
        const depthSlot = containerEl.querySelector('#pcDepthSlot');

        if (selected === 'ALL') {
          await loadOurDepth();
          body.innerHTML = await allTeamsUnavailableHtml(opts, rankMapFromOrder(ourDepth));
          depthSlot.innerHTML = '';
          return;
        }
        if (selected === 'OUR_TEAM') {
          await loadOurDepth();
          body.innerHTML = eligibilityListHtml(appearancesByPitcher(opts.games), opts.division, opts.asOfDate, rankMapFromOrder(ourDepth));
          const importedStats = opts.teamId ? await window.dbGet(window.teamPath(opts.teamId, 'importedStats')) : null;
          const pitchingRows = importedStats && Array.isArray(importedStats.pitchingRows) ? importedStats.pitchingRows : [];
          wireDepthEditor(depthSlot, {
            order: ourDepth, canEdit: !!opts.canEdit,
            addOptions: (opts.roster || []).map(p => p.name),
            suggestFrom: pitchingRows.length ? pitchingRows : null,
            onSave: async (order) => { await window.dbPut(window.teamPath(opts.teamId, 'pitcherDepth'), order); },
          });
          return;
        }
        // A specific opponent team -- shared/pitchSmart, same as before,
        // now carrying an optional depthOrder any coach can set/edit
        // alongside the pitch-count mirror (same crowdsourced trust model).
        const data = (await window.dbGet(window.sharedPath('pitchSmart'))) || {};
        const team = data[selected] || {};
        const order = Array.isArray(team.depthOrder) ? team.depthOrder : [];
        if (!team.pitchers || !team.pitchers.length) {
          body.innerHTML = `
            <div class="emptyState">
              No MAC League pitch count data mirrored for ${escapeHtml(selected)} yet.<br>
              <span class="helpText">This mirrors from macleague.org once Spring pitch-count reporting is active.</span>
            </div>`;
        } else {
          const byPitcher = {};
          team.pitchers.forEach(p => { byPitcher[p.name] = p.appearances; });
          body.innerHTML = eligibilityListHtml(byPitcher, opts.division, opts.asOfDate, rankMapFromOrder(order));
        }
        wireDepthEditor(depthSlot, {
          order, canEdit: true,
          addOptions: (team.pitchers || []).map(p => p.name),
          suggestFrom: null,
          onSave: async (newOrder) => {
            const fresh = (await window.dbGet(window.sharedPath('pitchSmart'))) || {};
            fresh[selected] = Object.assign({}, fresh[selected], { depthOrder: newOrder });
            await window.dbPut(window.sharedPath('pitchSmart'), fresh);
          },
        });
      }
      draw();
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
