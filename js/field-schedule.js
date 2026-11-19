/* ============================================================
   Field Time -- one shared booking sheet per LYBS field, so the
   teams that share a field stop scheduling it by text message.

   Starts with Fitzgerald Softball (8U and 10U softball share it),
   but every path is keyed by field from day one, so Marshall Upper,
   Marshall Lower, McNally and Fitzgerald Baseball are a board toggle
   in Settings away, not new code.

   How booking works
   - The board sets each field's season, its weekly time blocks
     (e.g. Tue 5:30-7:00) and which teams use it (Settings).
   - A coach taps an open block and books it for their team, as a
     practice or a home game. One booking per block: the database
     rule (database.rules.json, fieldSched/slots) only lets a coach
     CREATE a block that is empty, so two coaches tapping the same
     block at once can't both win. The page also re-reads the block
     right before booking and says who got it first.
   - A coach can drop or edit their own booking. They can't move it
     to another team themselves.
   - To get another team's block, a coach sends a request: "swap
     for one of mine" or "can we have it". Only that team's coach
     can accept. Accepting moves both blocks in one atomic update,
     and the rule only allows that move while the request is still
     pending, so a request can't be replayed.
   - The board can book, change or lock any block (a league game the
     coaches shouldn't move), and edit Settings.

   Telling everyone
   - fieldSched/inbox/{teamId}: a team's messages (request sent to
     you, answered, your block changed by the board). Unread count
     shows on the tab.
   - fieldSched/log/{fieldId}: "what changed" on the field, for
     everyone on it.
   - Phone alerts: requests, answers and freed-up blocks also go out
     as Web Push through functions/index.js (onFieldRequest,
     onFieldAnswer, onFieldOpened) to the same coach subscriptions the
     walk-up song alerts use (pushSubs/{teamId}/coach).

   Data (all under fieldSched/, outside teams/{teamId} because a field
   is shared by several teams -- same reason leagueEvents is):
     fields/{fieldId}              {name, site, sport, divisions, live, order}
     settings/{fieldId}            {seasonStart, seasonEnd, blocks{0..6:[{start,end}]},
                                    practicesPerWeek, blackouts[], placeholder}
     teams/{fieldId}/{teamId}      {name, division, color}
     slots/{fieldId}/{date}/{HHMM} {team, kind, opp, note, locked, req, at, by}
     requests/{fieldId}/{rid}      {from, to, want, give, note, st, at, by, answeredAt}
     inbox/{teamId}/{nid}          {text, from, field, kind, at, read}
     log/{fieldId}/{id}            {text, team, at}
   A field team's id is its Ballclub teamId, so the coach signed in to
   that team is the coach of that field team. No player or family data
   lives anywhere in here.

   window.FieldSchedule.render(containerEl, opts)
     opts.teamId   -- the team this device is signed in to
     opts.isCoach  -- coach of opts.teamId
     opts.isBoard  -- board member (Settings, book for anyone, lock)
     opts.name     -- who is acting, for "booked by"
     opts.onBadge(n) -- optional, called with the unread message count
   ============================================================ */
(function () {
  const ROOT = 'fieldSched';
  const path = {
    fields: () => `${ROOT}/fields`,
    settings: f => `${ROOT}/settings/${f}`,
    teams: f => `${ROOT}/teams/${f}`,
    slots: f => `${ROOT}/slots/${f}`,
    slot: (f, key) => `${ROOT}/slots/${f}/${key}`,
    requests: f => `${ROOT}/requests/${f}`,
    request: (f, rid) => `${ROOT}/requests/${f}/${rid}`,
    inbox: t => `${ROOT}/inbox/${t}`,
    inboxItem: (t, id) => `${ROOT}/inbox/${t}/${id}`,
    log: f => `${ROOT}/log/${f}`,
    logItem: (f, id) => `${ROOT}/log/${f}/${id}`,
  };

  /* ---------- Starter setup ----------
     The fields are real. Everything in DEFAULT_SETTINGS is a
     PLACEHOLDER until the league's softball numbers are in (number of
     teams, home games, start dates, block times). The board changes
     all of it on the Settings screen; nothing here needs a code change.
     A field whose settings were never saved shows a banner saying so. */
  const DEFAULT_FIELDS = {
    'fitz-softball': { name: 'Fitzgerald Softball', site: 'Fitzgerald', sport: 'Softball', divisions: ['8U Softball', '10U Softball'], live: true, order: 1 },
    'marshall-upper': { name: 'Marshall Upper', site: 'Marshall Park', sport: 'Softball', divisions: ['12U Softball', '16U Softball'], live: false, order: 2 },
    'marshall-lower': { name: 'Marshall Lower', site: 'Marshall Park', sport: 'Baseball', divisions: ['12U / Majors'], live: false, order: 3 },
    mcnally: { name: 'McNally', site: 'McNally', sport: 'Baseball', divisions: ['Minors'], live: false, order: 4 },
    'fitz-baseball': { name: 'Fitzgerald Baseball', site: 'Fitzgerald', sport: 'Baseball', divisions: ['Rookies'], live: false, order: 5 },
  };
  const WEEKNIGHT = [{ start: '1730', end: '1900' }, { start: '1900', end: '2030' }];
  const DEFAULT_SETTINGS = {
    placeholder: true, // PLACEHOLDER -- cleared the first time the board saves Settings
    seasonStart: '2027-04-05', // PLACEHOLDER
    seasonEnd: '2027-06-19', // PLACEHOLDER
    practicesPerWeek: 2, // PLACEHOLDER -- per team, per week (Mon-Sun); 0 = no cap
    blackouts: [], // PLACEHOLDER -- dates the field is closed (YYYY-MM-DD)
    blocks: { // PLACEHOLDER -- 0 = Sunday ... 6 = Saturday, times as HHMM
      0: [{ start: '1300', end: '1430' }, { start: '1430', end: '1600' }],
      1: WEEKNIGHT, 2: WEEKNIGHT, 3: WEEKNIGHT, 4: WEEKNIGHT, 5: WEEKNIGHT,
      6: [{ start: '0900', end: '1030' }, { start: '1030', end: '1200' }, { start: '1200', end: '1330' }, { start: '1330', end: '1500' }],
    },
  };
  const TEAM_COLORS = ['#2E52E8', '#E8599E', '#F0C84B', '#5fd989', '#b98af0', '#FF9A5A', '#6ea8c9', '#B4BBBF'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- Pure helpers (tested in tests/field-schedule.test.js) ---------- */
  const pad = n => String(n).padStart(2, '0');
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function dateStr(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function mondayOf(s) { const d = parseDate(s); const back = (d.getDay() + 6) % 7; return addDays(s, -back); }
  function weekDates(monday) { return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i)); }
  function fmtTime(hhmm) {
    const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(2);
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function fmtRange(b) { return `${fmtTime(b.start)}–${fmtTime(b.end)}`; }
  function fmtDay(s) { const d = parseDate(s); return `${DAY_SHORT[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`; }
  function fmtKey(key, settings) {
    const [d, t] = key.split('/');
    const b = blocksFor(settings, d, true).find(x => x.start === t);
    return `${fmtDay(d)}, ${b ? fmtRange(b) : fmtTime(t)}`;
  }
  function validTime(t) { return /^([01]\d|2[0-3])[0-5]\d$/.test(t); }
  function toHHMM(v) { const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? pad(m[1]) + m[2] : ''; }
  function fromHHMM(t) { return t ? `${t.slice(0, 2)}:${t.slice(2)}` : ''; }

  // The bookable blocks on one date: that weekday's blocks, unless the
  // date is outside the season or blacked out. anyDate skips both checks
  // (used to label a block that already exists).
  function blocksFor(settings, date, anyDate) {
    const s = settings || DEFAULT_SETTINGS;
    if (!anyDate) {
      if (s.seasonStart && date < s.seasonStart) return [];
      if (s.seasonEnd && date > s.seasonEnd) return [];
      if ((s.blackouts || []).includes(date)) return [];
    }
    const list = (s.blocks && s.blocks[parseDate(date).getDay()]) || [];
    return list.filter(b => b && validTime(b.start) && validTime(b.end) && b.end > b.start)
      .slice().sort((a, b) => a.start.localeCompare(b.start));
  }
  // slots tree {date: {HHMM: booking}} -> flat [{key, date, time, ...booking}]
  function flatSlots(tree) {
    const out = [];
    Object.keys(tree || {}).forEach(d => Object.keys(tree[d] || {}).forEach(t => {
      if (tree[d][t]) out.push(Object.assign({ key: `${d}/${t}`, date: d, time: t }, tree[d][t]));
    }));
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  function slotAt(tree, key) { const [d, t] = key.split('/'); return (tree && tree[d] && tree[d][t]) || null; }
  function practiceCount(tree, team, monday) {
    const days = new Set(weekDates(monday));
    return flatSlots(tree).filter(s => s.team === team && s.kind === 'practice' && days.has(s.date)).length;
  }
  // Can `team` book this block as `kind` right now? {ok, why}
  function canBook(state, team, key, kind, today) {
    const [d, t] = key.split('/');
    if (!team) return { ok: false, why: 'Pick a team first.' };
    if (!state.teams[team]) return { ok: false, why: 'That team isn’t on this field.' };
    if (d < today) return { ok: false, why: 'That date has passed.' };
    if (!blocksFor(state.settings, d).some(b => b.start === t)) return { ok: false, why: 'That block isn’t open on this field.' };
    const held = slotAt(state.slots, key);
    if (held) return { ok: false, why: `${teamName(state, held.team)} already has it.` };
    const cap = Number(state.settings.practicesPerWeek) || 0;
    if (kind === 'practice' && cap > 0 && practiceCount(state.slots, team, mondayOf(d)) >= cap) {
      return { ok: false, why: `${teamName(state, team)} already has ${cap} practice${cap === 1 ? '' : 's'} that week. Book it as a game, or drop one first.` };
    }
    return { ok: true };
  }
  function teamName(state, id) { return (state.teams[id] && state.teams[id].name) || id || 'Unknown team'; }

  // The one atomic update that answers "yes" to a request: the wanted
  // block goes to the asking team, the offered block (a swap) goes to the
  // answering team, the request is marked accepted, and both teams hear
  // about it. Returns {updates} or {error} when a block has changed since.
  function acceptUpdates(state, fieldId, rid, req, who, now, ids) {
    const want = slotAt(state.slots, req.want);
    if (!want || want.team !== req.to) return { error: 'That block has changed since the request was sent.' };
    const give = req.give ? slotAt(state.slots, req.give) : null;
    if (req.give && (!give || give.team !== req.from)) return { error: 'The block offered in trade has changed since the request was sent.' };
    const u = {};
    u[path.slot(fieldId, req.want)] = clean({ team: req.from, kind: want.kind, opp: want.kind === 'game' ? want.opp : '', req: rid, at: now, by: who });
    if (req.give) u[path.slot(fieldId, req.give)] = clean({ team: req.to, kind: give.kind, opp: give.kind === 'game' ? give.opp : '', req: rid, at: now, by: who });
    u[path.request(fieldId, rid) + '/st'] = 'accepted';
    u[path.request(fieldId, rid) + '/answeredAt'] = now;
    const what = req.give
      ? `${teamName(state, req.to)} swapped ${fmtKey(req.want, state.settings)} for ${fmtKey(req.give, state.settings)} with ${teamName(state, req.from)}.`
      : `${teamName(state, req.to)} gave ${fmtKey(req.want, state.settings)} to ${teamName(state, req.from)}.`;
    u[path.inboxItem(req.from, ids[0])] = { text: `Yes: ${what}`, from: req.to, field: fieldId, kind: 'answer', at: now };
    u[path.logItem(fieldId, ids[1])] = { text: what, team: req.to, at: now };
    return { updates: u };
  }
  function clean(o) { const out = {}; Object.keys(o).forEach(k => { if (o[k] !== '' && o[k] != null) out[k] = o[k]; }); return out; }
  function mergeSettings(saved) {
    const s = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    s.blocks = Object.assign({}, DEFAULT_SETTINGS.blocks, (saved && saved.blocks) || {});
    // RTDB turns an empty array into "missing" and a dense numeric-key
    // object back into an array, so normalize both ways.
    [0, 1, 2, 3, 4, 5, 6].forEach(i => { s.blocks[i] = Array.isArray(s.blocks[i]) ? s.blocks[i] : Object.values(s.blocks[i] || {}); });
    if (saved && saved.blocks) [0, 1, 2, 3, 4, 5, 6].forEach(i => { if (!(i in saved.blocks)) s.blocks[i] = []; });
    s.blackouts = Array.isArray(s.blackouts) ? s.blackouts : Object.values(s.blackouts || {});
    s.placeholder = !saved || saved.placeholder === true; // saved by the board = real settings
    return s;
  }

  /* ---------- Data ---------- */
  const cache = {}; // fieldId -> state
  let fieldsCache = null;
  async function loadFields() {
    const saved = await window.dbGet(path.fields());
    const merged = {};
    Object.keys(DEFAULT_FIELDS).forEach(id => { merged[id] = Object.assign({}, DEFAULT_FIELDS[id], (saved || {})[id] || {}); });
    Object.keys(saved || {}).forEach(id => { if (!merged[id]) merged[id] = saved[id]; });
    fieldsCache = merged;
    return merged;
  }
  async function loadField(fieldId) {
    const [settings, teams, slots, requests, log] = await Promise.all([
      window.dbGet(path.settings(fieldId)), window.dbGet(path.teams(fieldId)), window.dbGet(path.slots(fieldId)),
      window.dbGet(path.requests(fieldId)), window.dbGet(path.log(fieldId)),
    ]);
    const state = { settings: mergeSettings(settings), teams: teams || {}, slots: slots || {}, requests: requests || {}, log: log || {} };
    cache[fieldId] = state;
    return state;
  }
  async function loadInbox(teamId) {
    if (!teamId) return {};
    try { return (await window.dbGet(path.inbox(teamId))) || {}; } catch (e) { return {}; }
  }
  const nowStamp = () => Date.now();
  const newId = p => window.uid(p);

  /* ---------- Render ---------- */
  const esc = s => window.escapeHtml(s == null ? '' : String(s));
  let view = { fieldId: 'fitz-softball', monday: null, panel: 'week', actAs: null };

  async function render(el, opts) {
    opts = opts || {};
    el.innerHTML = '<div class="emptyState">Loading&hellip;</div>';
    const fields = await loadFields();
    if (!fields[view.fieldId] || (!fields[view.fieldId].live && !opts.isBoard)) {
      view.fieldId = Object.keys(fields).find(id => fields[id].live) || 'fitz-softball';
    }
    const state = await loadField(view.fieldId);
    const inbox = await loadInbox(myTeam(state, opts));
    draw(el, opts, fields, state, inbox);
  }

  // The field team this device acts as: its own team when it's a coach of
  // a team on this field; the board can act as any team on the field.
  function myTeam(state, opts) {
    if (opts.isBoard && view.actAs && state.teams[view.actAs]) return view.actAs;
    if (opts.isCoach && opts.teamId && state.teams[opts.teamId]) return opts.teamId;
    return null;
  }
  function today() { return window.todayIso(); }

  function draw(el, opts, fields, state, inbox) {
    const fieldId = view.fieldId, field = fields[fieldId], s = state.settings;
    const me = myTeam(state, opts);
    if (!view.monday) {
      const t = today();
      view.monday = mondayOf(t < s.seasonStart ? s.seasonStart : (t > s.seasonEnd ? s.seasonEnd : t));
    }
    const unread = Object.values(inbox).filter(n => n && !n.read).length;
    if (opts.onBadge) opts.onBadge(unread);
    const pending = Object.entries(state.requests).filter(([, r]) => r && r.st === 'pending');
    const incoming = me ? pending.filter(([, r]) => r.to === me) : [];
    const outgoing = me ? pending.filter(([, r]) => r.from === me) : [];

    const fieldChips = Object.keys(fields).sort((a, b) => (fields[a].order || 99) - (fields[b].order || 99))
      .filter(id => fields[id].live || opts.isBoard)
      .map(id => `<button class="fsChip ${id === fieldId ? 'fsChipOn' : ''}" data-field="${esc(id)}">${esc(fields[id].name)}${fields[id].live ? '' : ' <span class="fsSoon">off</span>'}</button>`).join('');
    const comingSoon = Object.values(fields).filter(f => !f.live).map(f => f.name);

    const teamIds = Object.keys(state.teams);
    teamIds.forEach((id, i) => { if (!state.teams[id].color) state.teams[id].color = TEAM_COLORS[i % TEAM_COLORS.length]; });
    const legend = teamIds.length
      ? teamIds.map(id => `<span class="fsLegend"><span class="fsDot" style="background:${esc(state.teams[id].color)}"></span>${esc(state.teams[id].name)}${id === me ? ' (you)' : ''}</span>`).join('')
      : '<span class="helpText">No teams on this field yet.' + (opts.isBoard ? ' Add them in Settings.' : ' The board adds them.') + '</span>';

    const cap = Number(s.practicesPerWeek) || 0;
    const myCount = me ? practiceCount(state.slots, me, view.monday) : 0;

    let html = `
      <div class="fsHead">
        <div class="fsFieldRow">${fieldChips}</div>
        ${s.placeholder ? `<div class="fsBanner">Starter settings: block times, season dates and the practice limit are placeholders until the league’s softball numbers are in.${opts.isBoard ? ' Change them in Settings.' : ''}</div>` : ''}
        ${!field.live ? '<div class="fsBanner">This field is off. Coaches can’t see it until the board turns it on in Settings.</div>' : ''}
        <div class="fsToolbar">
          ${opts.isBoard ? `<label class="fsActAs">Acting as <select data-act-as><option value="">Board (any team)</option>${teamIds.map(id => `<option value="${esc(id)}" ${id === view.actAs ? 'selected' : ''}>${esc(state.teams[id].name)}</option>`).join('')}</select></label>` : ''}
          <button class="btn btnSmall btnGhost" data-panel="week" ${view.panel === 'week' ? 'aria-pressed="true"' : ''}>Week</button>
          <button class="btn btnSmall btnGhost" data-panel="mine" ${view.panel === 'mine' ? 'aria-pressed="true"' : ''}>${me ? 'My bookings' : 'All bookings'}</button>
          ${me ? `<button class="btn btnSmall btnGhost" data-panel="inbox">Messages${unread ? ` <span class="fsCount">${unread}</span>` : ''}</button>` : ''}
          <button class="btn btnSmall btnGhost" data-panel="log">What changed</button>
          ${opts.isBoard ? '<button class="btn btnSmall btnGhost" data-panel="settings">Settings</button>' : ''}
        </div>
        <div class="fsLegendRow">${legend}</div>
      </div>`;

    if (incoming.length || outgoing.length) {
      html += `<div class="detailCard fsReqCard"><div class="sectionLabel">Requests</div>
        ${incoming.map(([rid, r]) => `<div class="fsReq">
          <div><b>${esc(teamName(state, r.from))}</b> ${r.give ? `wants to swap their <b>${esc(fmtKey(r.give, s))}</b> for your <b>${esc(fmtKey(r.want, s))}</b>` : `asks for your <b>${esc(fmtKey(r.want, s))}</b>`}${r.note ? `<div class="helpText">“${esc(r.note)}”</div>` : ''}</div>
          <div class="fsReqBtns"><button class="btn btnSmall" data-accept="${esc(rid)}">${r.give ? 'Swap' : 'Give it'}</button><button class="btn btnSmall btnGhost" data-decline="${esc(rid)}">No thanks</button></div>
        </div>`).join('')}
        ${outgoing.map(([rid, r]) => `<div class="fsReq">
          <div>Waiting on <b>${esc(teamName(state, r.to))}</b> for <b>${esc(fmtKey(r.want, s))}</b>${r.give ? ` (swap for your ${esc(fmtKey(r.give, s))})` : ''}</div>
          <div class="fsReqBtns"><button class="btn btnSmall btnGhost" data-withdraw="${esc(rid)}">Cancel request</button></div>
        </div>`).join('')}
      </div>`;
    }

    if (view.panel === 'week') html += weekHtml(state, me, opts, cap, myCount);
    else if (view.panel === 'mine') html += mineHtml(state, me);
    else if (view.panel === 'inbox') html += inboxHtml(inbox);
    else if (view.panel === 'log') html += logHtml(state);
    else if (view.panel === 'settings' && opts.isBoard) html += settingsHtml(fields, state);

    if (comingSoon.length && !opts.isBoard) html += `<p class="helpText fsFoot">Coming to Field Time later: ${esc(comingSoon.join(', '))}.</p>`;
    el.innerHTML = html;
    wire(el, opts, fields, state, inbox, me);
  }

  function weekHtml(state, me, opts, cap, myCount) {
    const s = state.settings, t = today();
    const days = weekDates(view.monday);
    const rows = days.map(d => {
      const blocks = blocksFor(s, d);
      const extra = flatSlots({ [d]: (state.slots[d] || {}) }).filter(x => !blocks.some(b => b.start === x.time)); // booked before a block time changed
      if (!blocks.length && !extra.length) {
        const why = (s.blackouts || []).includes(d) ? 'Field closed' : (d < s.seasonStart || d > s.seasonEnd ? 'Outside the season' : 'No field time');
        return `<div class="fsDay fsDayEmpty"><div class="fsDayName">${esc(fmtDay(d))}</div><div class="helpText">${why}</div></div>`;
      }
      const cells = blocks.map(b => ({ b, slot: slotAt(state.slots, `${d}/${b.start}`) }))
        .concat(extra.map(x => ({ b: { start: x.time, end: x.time }, slot: x })));
      return `<div class="fsDay ${d === t ? 'fsToday' : ''}"><div class="fsDayName">${esc(fmtDay(d))}</div><div class="fsBlocks">${cells.map(({ b, slot }) => {
        const key = `${d}/${b.start}`, past = d < t;
        const label = b.end === b.start ? fmtTime(b.start) : fmtRange(b);
        if (!slot) return `<button class="fsBlock fsOpen" data-key="${esc(key)}" ${past ? 'disabled' : ''}><span class="fsTime">${esc(label)}</span><span class="fsWho">${past ? '—' : 'Open'}</span></button>`;
        const team = state.teams[slot.team] || { name: slot.team, color: '#7E8284' };
        const mine = slot.team === me;
        const what = slot.kind === 'game' ? `Game${slot.opp ? ' vs ' + slot.opp : ''}` : 'Practice';
        return `<button class="fsBlock ${mine ? 'fsMine' : 'fsTaken'}" data-key="${esc(key)}" style="--fs-team:${esc(team.color)}"><span class="fsTime">${esc(label)}${slot.locked ? ' \u{1F512}' : ''}</span><span class="fsWho">${esc(team.name)}</span><span class="fsWhat">${esc(what)}</span></button>`;
      }).join('')}</div></div>`;
    }).join('');
    return `
      <div class="fsWeekNav">
        <button class="calNavBtn" data-week="-1" aria-label="Previous week">‹</button>
        <div class="fsWeekLabel">Week of ${esc(fmtDay(view.monday))}</div>
        <button class="calNavBtn" data-week="1" aria-label="Next week">›</button>
      </div>
      ${me && cap ? `<div class="helpText fsCap">${esc(teamName(state, me))}: ${myCount} of ${cap} practices booked this week.</div>` : ''}
      ${!me && !opts.isBoard ? '<div class="helpText fsCap">Coaches of the teams on this field can book here. Everyone else can see who has the field.</div>' : ''}
      <div class="fsWeek">${rows}</div>
      ${me || opts.isBoard ? '<p class="helpText">Tap an open block to book it. Tap another team’s block to ask for it or offer a swap.</p>' : ''}`;
  }

  function mineHtml(state, me) {
    const t = today();
    const list = flatSlots(state.slots).filter(x => x.date >= t && (!me || x.team === me));
    if (!list.length) return `<div class="emptyState">${me ? 'No upcoming bookings yet. Tap an open block on the Week view.' : 'Nothing booked yet.'}</div>`;
    return `<div class="detailCard">${list.map(x => `<div class="listRow" data-key="${esc(x.key)}" role="button" tabindex="0"><div class="listRowMain">
      <div class="listRowTitle">${esc(fmtKey(x.key, state.settings))}</div>
      <div class="listRowSub">${me ? '' : esc(teamName(state, x.team)) + ' · '}${x.kind === 'game' ? 'Game' + (x.opp ? ' vs ' + esc(x.opp) : '') : 'Practice'}${x.locked ? ' · locked by the league' : ''}</div></div></div>`).join('')}</div>`;
  }
  function inboxHtml(inbox) {
    const list = Object.entries(inbox).filter(([, n]) => n).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 40);
    if (!list.length) return '<div class="emptyState">No messages yet. Requests and answers from other teams land here.</div>';
    return `<div class="detailCard">
      <div class="fsInboxTools"><button class="btn btnSmall btnGhost" data-read-all>Mark all read</button><button class="btn btnSmall btnGhost" data-alerts>Phone alerts</button></div>
      ${list.map(([, n]) => `<div class="fsMsg ${n.read ? '' : 'fsUnread'}"><div>${esc(n.text)}</div><div class="helpText">${esc(ago(n.at))}</div></div>`).join('')}</div>`;
  }
  function logHtml(state) {
    const list = Object.values(state.log).filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 40);
    if (!list.length) return '<div class="emptyState">Nothing has changed on this field yet.</div>';
    return `<div class="detailCard">${list.map(n => `<div class="fsMsg"><div>${esc(n.text)}</div><div class="helpText">${esc(ago(n.at))}</div></div>`).join('')}</div>`;
  }
  function ago(at) {
    if (!at) return '';
    const m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} hr ago`;
    const d = new Date(at);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function settingsHtml(fields, state) {
    const f = fields[view.fieldId], s = state.settings;
    const dayRows = [1, 2, 3, 4, 5, 6, 0].map(i => `<div class="fsSetDay"><div class="fsSetDayName">${DAY_LONG[i]}</div><div class="fsSetBlocks" data-day="${i}">
      ${(s.blocks[i] || []).map(b => blockInputs(b)).join('')}
      <button class="btn btnTiny btnGhost" data-add-block="${i}">+ Block</button></div></div>`).join('');
    const teams = Object.entries(state.teams);
    return `<div class="detailCard fsSettings">
      <div class="sectionLabel">${esc(f.name)} settings</div>
      <label class="fsSetRow"><input type="checkbox" data-set="live" ${f.live ? 'checked' : ''}> Field is on (coaches can see and book it)</label>
      <div class="fsSetGrid">
        <label>Season starts<input type="date" data-set="seasonStart" value="${esc(s.seasonStart)}"></label>
        <label>Season ends<input type="date" data-set="seasonEnd" value="${esc(s.seasonEnd)}"></label>
        <label>Practices per team per week<input type="number" min="0" max="7" data-set="practicesPerWeek" value="${esc(s.practicesPerWeek)}"><span class="helpText">0 means no limit. Games don’t count.</span></label>
      </div>
      <div class="sectionLabel">Weekly blocks</div>
      <p class="helpText">Each block is one booking. Changing a time doesn’t move anything already booked.</p>
      ${dayRows}
      <label class="fsSetRow fsSetCol">Field closed on (one date per line, YYYY-MM-DD)<textarea rows="3" data-set="blackouts">${esc((s.blackouts || []).join('\n'))}</textarea></label>
      <div class="sectionLabel">Teams on this field</div>
      <p class="helpText">The team id must match the team’s id in this app, so its coaches can book.</p>
      <div class="fsTeamRows">${teams.map(([id, t]) => teamRow(id, t)).join('')}</div>
      <button class="btn btnSmall btnGhost" data-add-team>+ Team</button>
      <div class="detailActions"><button class="btn" data-save-settings>Save settings</button></div>
    </div>`;
  }
  function blockInputs(b) {
    return `<span class="fsSetBlock"><input type="time" value="${esc(fromHHMM(b.start))}" data-b="start"><span>to</span><input type="time" value="${esc(fromHHMM(b.end))}" data-b="end"><button class="btn btnTiny btnGhost" data-del-block aria-label="Remove block">×</button></span>`;
  }
  function teamRow(id, t) {
    return `<div class="fsTeamRow"><input data-t="name" placeholder="Team name" value="${esc(t.name || '')}"><input data-t="id" placeholder="team id" value="${esc(id)}" ${id ? 'readonly' : ''}><input data-t="division" placeholder="Division" value="${esc(t.division || '')}"><input type="color" data-t="color" value="${esc(t.color || '#2E52E8')}"><button class="btn btnTiny btnGhost" data-del-team aria-label="Remove team">×</button></div>`;
  }

  /* ---------- Actions ---------- */
  function wire(el, opts, fields, state, inbox, me) {
    const rerender = () => render(el, opts);
    const fieldId = view.fieldId;
    el.querySelectorAll('[data-field]').forEach(b => b.addEventListener('click', () => { view.fieldId = b.dataset.field; view.monday = null; view.actAs = null; rerender(); }));
    el.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => { view.panel = b.dataset.panel; rerender(); }));
    el.querySelectorAll('[data-week]').forEach(b => b.addEventListener('click', () => { view.monday = addDays(view.monday, 7 * Number(b.dataset.week)); draw(el, opts, fields, state, inbox); }));
    const actAs = el.querySelector('[data-act-as]');
    if (actAs) actAs.addEventListener('change', () => { view.actAs = actAs.value || null; rerender(); });
    el.querySelectorAll('[data-key]').forEach(b => {
      const go = () => openBlock(b.dataset.key, opts, state, me, rerender);
      b.addEventListener('click', go);
      if (b.tagName !== 'BUTTON') b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    el.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => window.withBusyButton(b, 'Saving…', () => accept(b.dataset.accept, opts, rerender))));
    el.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => window.withBusyButton(b, 'Saving…', () => answer(b.dataset.decline, 'declined', opts, rerender))));
    el.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', () => window.withBusyButton(b, 'Saving…', () => answer(b.dataset.withdraw, 'cancelled', opts, rerender))));
    const readAll = el.querySelector('[data-read-all]');
    if (readAll) readAll.addEventListener('click', async () => {
      const u = {};
      Object.entries(inbox).forEach(([id, n]) => { if (n && !n.read) u[path.inboxItem(me, id) + '/read'] = true; });
      if (Object.keys(u).length) { try { await window.dbUpdate(u); } catch (e) { return; } }
      rerender();
    });
    const alerts = el.querySelector('[data-alerts]');
    if (alerts) alerts.addEventListener('click', async () => {
      if (window.SongRequests && window.SongRequests.enableAlerts) {
        const ok = await window.SongRequests.enableAlerts(me, 'coach');
        if (ok) window.showToast('Alerts are on for this phone: requests, answers and freed-up field time.', 'info');
      } else window.showToast('Phone alerts aren’t set up in this version.', 'info');
    });
    if (view.panel === 'settings') wireSettings(el, opts, fields, state, rerender);
  }

  // One sheet for every block tap: book an open one, change your own,
  // ask for someone else's. The board gets the full set on any block.
  function openBlock(key, opts, state, me, done) {
    const fieldId = view.fieldId, s = state.settings, slot = slotAt(state.slots, key);
    const title = fmtKey(key, s);
    const teamOpts = Object.keys(state.teams).map(id => `<option value="${esc(id)}">${esc(state.teams[id].name)}</option>`).join('');
    let body = '';
    if (!slot) {
      if (!me && !opts.isBoard) { window.openInfoModal(title, '<p>Open. Coaches of the teams on this field can book it.</p>'); return; }
      body = `<div class="fsForm">
        ${me ? `<p>Book for <b>${esc(teamName(state, me))}</b></p>` : `<label>Team<select data-f="team">${teamOpts}</select></label>`}
        <div class="fsKind"><label><input type="radio" name="fsKind" value="practice" checked> Practice</label><label><input type="radio" name="fsKind" value="game"> Home game</label></div>
        <label class="fsOpp hide">Opponent<input data-f="opp" maxlength="60" placeholder="e.g. Townsend"></label>
        <label>Note (optional)<input data-f="note" maxlength="120" placeholder="e.g. need the pitching mound"></label>
        ${opts.isBoard ? '<label class="fsSetRow"><input type="checkbox" data-f="locked"> League game: lock it so coaches can’t move it</label>' : ''}
        <div class="detailActions"><button class="btn" data-go="book">Book it</button></div></div>`;
    } else {
      const team = teamName(state, slot.team), mine = slot.team === me;
      const what = slot.kind === 'game' ? `Home game${slot.opp ? ' vs ' + esc(slot.opp) : ''}` : 'Practice';
      body = `<p><b>${esc(team)}</b> · ${what}</p>${slot.note ? `<p class="helpText">${esc(slot.note)}</p>` : ''}${slot.by ? `<p class="helpText">Booked by ${esc(slot.by)}</p>` : ''}`;
      if (slot.locked && !opts.isBoard) body += '<p class="helpText">The league locked this one. Ask the board to change it.</p>';
      else if (mine || opts.isBoard) {
        body += `<div class="fsForm">
          <div class="fsKind"><label><input type="radio" name="fsKind" value="practice" ${slot.kind !== 'game' ? 'checked' : ''}> Practice</label><label><input type="radio" name="fsKind" value="game" ${slot.kind === 'game' ? 'checked' : ''}> Home game</label></div>
          <label class="fsOpp ${slot.kind === 'game' ? '' : 'hide'}">Opponent<input data-f="opp" maxlength="60" value="${esc(slot.opp || '')}"></label>
          <label>Note<input data-f="note" maxlength="120" value="${esc(slot.note || '')}"></label>
          ${opts.isBoard ? `<label>Team<select data-f="team">${teamOpts}</select></label><label class="fsSetRow"><input type="checkbox" data-f="locked" ${slot.locked ? 'checked' : ''}> League game: locked</label>` : ''}
          <div class="detailActions"><button class="btn" data-go="save">Save</button><button class="btn btnDanger" data-go="release">Give up this block</button></div></div>`;
      } else if (me) {
        const myUpcoming = flatSlots(state.slots).filter(x => x.team === me && x.date >= today() && !x.locked);
        body += `<div class="fsForm">
          <label>Ask ${esc(team)} for it<select data-f="give"><option value="">Just ask (no trade)</option>${myUpcoming.map(x => `<option value="${esc(x.key)}">Swap for my ${esc(fmtKey(x.key, s))}</option>`).join('')}</select></label>
          <label>Note (optional)<input data-f="note" maxlength="120" placeholder="e.g. we have a makeup game"></label>
          <div class="detailActions"><button class="btn" data-go="ask">Send request</button></div>
          <p class="helpText">${esc(team)}’s coaches get a message. Nothing moves unless they say yes.</p></div>`;
      }
    }
    window.openInfoModal(title, body);
    const sheet = document.getElementById('infoModalBody');
    const kindRadios = sheet.querySelectorAll('input[name="fsKind"]');
    const oppRow = sheet.querySelector('.fsOpp');
    kindRadios.forEach(r => r.addEventListener('change', () => { if (oppRow) oppRow.classList.toggle('hide', r.value !== 'game' || !r.checked); }));
    const teamSel = sheet.querySelector('[data-f="team"]');
    if (teamSel && slot) teamSel.value = slot.team;
    const val = k => { const x = sheet.querySelector(`[data-f="${k}"]`); return x ? (x.type === 'checkbox' ? x.checked : x.value.trim()) : ''; };
    const kind = () => { const r = sheet.querySelector('input[name="fsKind"]:checked'); return r ? r.value : 'practice'; };
    const go = (name, fn) => { const b = sheet.querySelector(`[data-go="${name}"]`); if (b) b.addEventListener('click', () => window.withBusyButton(b, 'Saving…', async () => { if (await fn() !== false) { closeModal(); done(); } })); };
    go('book', () => book(key, me || val('team'), kind(), val('opp'), val('note'), opts.isBoard && val('locked'), opts));
    go('save', () => saveOwn(key, slot, { kind: kind(), opp: val('opp'), note: val('note'), team: opts.isBoard ? val('team') : slot.team, locked: opts.isBoard ? val('locked') : !!slot.locked }, opts));
    go('release', async () => { if (!(await window.confirmModal(`Give up ${title}? Every team on this field can book it after.`))) return false; return release(key, slot, opts); });
    go('ask', () => ask(key, slot, me, val('give'), val('note'), opts));
  }
  function closeModal() {
    const c = document.getElementById('infoModalClose');
    if (c) c.click();
  }

  async function book(key, team, kind, opp, note, locked, opts) {
    const fieldId = view.fieldId;
    const state = await loadField(fieldId); // fresh read, so a block someone else just took says so
    const check = canBook(state, team, key, kind, today());
    if (!check.ok && !(opts.isBoard && !slotAt(state.slots, key))) { window.showToast(check.why); return false; }
    const now = nowStamp();
    const rec = clean({ team, kind, opp: kind === 'game' ? opp : '', note, locked: locked || null, at: now, by: opts.name || '' });
    try { await window.dbPut(path.slot(fieldId, key), rec); } catch (e) {
      // The rule refuses a block that isn't empty: someone got there first.
      const latest = await loadField(fieldId).catch(() => null);
      const held = latest && slotAt(latest.slots, key);
      if (held) window.showToast(`${teamName(latest, held.team)} booked it first.`);
      return false;
    }
    const msg = `${teamName(state, team)} booked ${fmtKey(key, state.settings)} (${kind === 'game' ? 'home game' + (opp ? ' vs ' + opp : '') : 'practice'}).`;
    const extra = {};
    extra[path.logItem(fieldId, newId('l'))] = { text: msg, team, at: now };
    if (opts.isBoard && team !== opts.teamId) extra[path.inboxItem(team, newId('n'))] = { text: `The league booked ${fmtKey(key, state.settings)} for you.`, from: team, field: fieldId, kind: 'board', at: now };
    await window.dbUpdate(extra).catch(() => {});
    window.showToast(`Booked: ${fmtKey(key, state.settings)}`, 'info');
  }
  async function saveOwn(key, slot, next, opts) {
    const fieldId = view.fieldId, state = cache[fieldId], now = nowStamp();
    const rec = clean({ team: next.team, kind: next.kind, opp: next.kind === 'game' ? next.opp : '', note: next.note, locked: next.locked || null, at: now, by: opts.name || '' });
    const u = { [path.slot(fieldId, key)]: rec };
    u[path.logItem(fieldId, newId('l'))] = { text: `${teamName(state, next.team)} changed ${fmtKey(key, state.settings)} to ${next.kind === 'game' ? 'a home game' + (next.opp ? ' vs ' + next.opp : '') : 'a practice'}.`, team: next.team, at: now };
    if (opts.isBoard && next.team !== slot.team) {
      u[path.inboxItem(slot.team, newId('n'))] = { text: `The league moved ${fmtKey(key, state.settings)} to ${teamName(state, next.team)}.`, from: next.team, field: fieldId, kind: 'board', at: now };
      u[path.inboxItem(next.team, newId('n'))] = { text: `The league gave you ${fmtKey(key, state.settings)}.`, from: next.team, field: fieldId, kind: 'board', at: now };
    }
    try { await window.dbUpdate(u); } catch (e) { return false; }
  }
  async function release(key, slot, opts) {
    const fieldId = view.fieldId, state = cache[fieldId], now = nowStamp();
    const u = { [path.slot(fieldId, key)]: null };
    u[path.logItem(fieldId, newId('l'))] = { text: `${teamName(state, slot.team)} gave up ${fmtKey(key, state.settings)}. It’s open.`, team: slot.team, at: now };
    if (opts.isBoard && slot.team !== opts.teamId) u[path.inboxItem(slot.team, newId('n'))] = { text: `The league cleared your ${fmtKey(key, state.settings)}.`, from: slot.team, field: fieldId, kind: 'board', at: now };
    // Any pending request for this block can't happen now.
    Object.entries(state.requests).forEach(([rid, r]) => {
      if (r && r.st === 'pending' && (r.want === key || r.give === key) && (r.to === slot.team || opts.isBoard)) u[path.request(fieldId, rid) + '/st'] = 'declined';
    });
    try { await window.dbUpdate(u); } catch (e) { return false; }
    window.showToast('Block released. Everyone on the field can see it’s open.', 'info');
  }
  async function ask(key, slot, me, give, note, opts) {
    const fieldId = view.fieldId, state = cache[fieldId], now = nowStamp();
    const dup = Object.values(state.requests).some(r => r && r.st === 'pending' && r.from === me && r.want === key);
    if (dup) { window.showToast('You already asked for that block.'); return false; }
    const rid = newId('r');
    const req = clean({ from: me, to: slot.team, want: key, give, note, st: 'pending', at: now, by: opts.name || '' });
    const text = give
      ? `${teamName(state, me)} wants to swap their ${fmtKey(give, state.settings)} for your ${fmtKey(key, state.settings)}.${note ? ' “' + note + '”' : ''}`
      : `${teamName(state, me)} asks for your ${fmtKey(key, state.settings)}.${note ? ' “' + note + '”' : ''}`;
    const u = {
      [path.request(fieldId, rid)]: req,
      [path.inboxItem(slot.team, newId('n'))]: { text: text.slice(0, 240), from: me, field: fieldId, kind: 'request', at: now },
    };
    try { await window.dbUpdate(u); } catch (e) { return false; }
    window.showToast(`Sent to ${teamName(state, slot.team)}.`, 'info');
  }
  async function accept(rid, opts, done) {
    const fieldId = view.fieldId, state = await loadField(fieldId), req = state.requests[rid];
    if (!req || req.st !== 'pending') { window.showToast('That request was already answered.'); done(); return; }
    const res = acceptUpdates(state, fieldId, rid, req, opts.name || '', nowStamp(), [newId('n'), newId('l')]);
    if (res.error) {
      window.showToast(res.error);
      await window.dbUpdate({ [path.request(fieldId, rid) + '/st']: 'declined', [path.request(fieldId, rid) + '/answeredAt']: nowStamp() }).catch(() => {});
      done(); return;
    }
    try { await window.dbUpdate(res.updates); } catch (e) { return; }
    window.showToast('Done. Both teams can see the change.', 'info');
    done();
  }
  async function answer(rid, st, opts, done) {
    const fieldId = view.fieldId, state = cache[fieldId], req = state.requests[rid], now = nowStamp();
    if (!req) return;
    const u = { [path.request(fieldId, rid) + '/st']: st, [path.request(fieldId, rid) + '/answeredAt']: now };
    if (st === 'declined') u[path.inboxItem(req.from, newId('n'))] = { text: `${teamName(state, req.to)} is keeping ${fmtKey(req.want, state.settings)}.`, from: req.to, field: fieldId, kind: 'answer', at: now };
    try { await window.dbUpdate(u); } catch (e) { return; }
    done();
  }

  function wireSettings(el, opts, fields, state, done) {
    el.querySelectorAll('[data-add-block]').forEach(b => b.addEventListener('click', () => {
      b.insertAdjacentHTML('beforebegin', blockInputs({ start: '1730', end: '1900' }));
      wireDel(el);
    }));
    el.querySelector('[data-add-team]').addEventListener('click', () => {
      el.querySelector('.fsTeamRows').insertAdjacentHTML('beforeend', teamRow('', { color: TEAM_COLORS[el.querySelectorAll('.fsTeamRow').length % TEAM_COLORS.length] }));
      const row = el.querySelector('.fsTeamRow:last-child');
      row.querySelector('[data-t="id"]').removeAttribute('readonly');
      row.querySelector('[data-t="name"]').addEventListener('input', e => {
        const idIn = row.querySelector('[data-t="id"]');
        if (!idIn.dataset.touched) idIn.value = slug(e.target.value);
      });
      row.querySelector('[data-t="id"]').addEventListener('input', e => { e.target.dataset.touched = '1'; });
      wireDel(el);
    });
    wireDel(el);
    el.querySelector('[data-save-settings]').addEventListener('click', e => window.withBusyButton(e.currentTarget, 'Saving…', async () => {
      const fieldId = view.fieldId, get = k => el.querySelector(`[data-set="${k}"]`);
      const blocks = {};
      let bad = '';
      el.querySelectorAll('[data-day]').forEach(dayEl => {
        blocks[dayEl.dataset.day] = Array.from(dayEl.querySelectorAll('.fsSetBlock')).map(row => ({ start: toHHMM(row.querySelector('[data-b="start"]').value), end: toHHMM(row.querySelector('[data-b="end"]').value) }))
          .filter(b => b.start || b.end);
        blocks[dayEl.dataset.day].forEach(b => { if (!b.start || !b.end || b.end <= b.start) bad = `Check the ${DAY_LONG[dayEl.dataset.day]} block times.`; });
      });
      const settings = {
        seasonStart: get('seasonStart').value, seasonEnd: get('seasonEnd').value,
        practicesPerWeek: Math.max(0, Math.min(7, Number(get('practicesPerWeek').value) || 0)),
        blackouts: get('blackouts').value.split(/\s+/).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
        blocks,
      };
      if (!settings.seasonStart || !settings.seasonEnd || settings.seasonEnd < settings.seasonStart) bad = 'Check the season dates.';
      const teams = {};
      el.querySelectorAll('.fsTeamRow').forEach(row => {
        const id = slug(row.querySelector('[data-t="id"]').value), name = row.querySelector('[data-t="name"]').value.trim();
        if (!id && !name) return;
        if (!id || !name) { bad = 'Each team needs a name and an id.'; return; }
        teams[id] = { name: name.slice(0, 40), division: row.querySelector('[data-t="division"]').value.trim().slice(0, 40), color: row.querySelector('[data-t="color"]').value };
      });
      if (bad) { window.showToast(bad); return; }
      const removed = Object.keys(state.teams).filter(id => !teams[id]);
      if (removed.length && flatSlots(state.slots).some(x => removed.includes(x.team) && x.date >= today())) {
        if (!(await window.confirmModal(`${removed.map(id => teamName(state, id)).join(', ')} still ha${removed.length > 1 ? 've' : 's'} upcoming bookings. Remove anyway? Their bookings stay until you clear them.`))) return;
      }
      const field = Object.assign({}, fields[fieldId], { live: get('live').checked });
      try {
        await window.dbUpdate({ [path.settings(fieldId)]: settings, [path.teams(fieldId)]: Object.keys(teams).length ? teams : null, [`${path.fields()}/${fieldId}`]: field, [path.logItem(fieldId, newId('l'))]: { text: 'The league updated this field’s settings.', team: '', at: nowStamp() } });
      } catch (err) { return; }
      window.showToast('Settings saved.', 'info');
      view.panel = 'week';
      done();
    }));
  }
  function wireDel(el) {
    el.querySelectorAll('[data-del-block]').forEach(b => { b.onclick = () => b.closest('.fsSetBlock').remove(); });
    el.querySelectorAll('[data-del-team]').forEach(b => { b.onclick = () => b.closest('.fsTeamRow').remove(); });
  }
  function slug(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

  // Unread count for a nav badge without drawing the tab.
  async function unreadCount(teamId) {
    const inbox = await loadInbox(teamId);
    return Object.values(inbox).filter(n => n && !n.read).length;
  }

  window.FieldSchedule = {
    render, unreadCount, DEFAULT_FIELDS, DEFAULT_SETTINGS,
    _test: { blocksFor, mondayOf, weekDates, addDays, fmtTime, fmtKey, flatSlots, slotAt, practiceCount, canBook, acceptUpdates, mergeSettings, toHHMM, slug, path, setView: v => Object.assign(view, v) },
  };
})();
