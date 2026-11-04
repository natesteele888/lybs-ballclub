/* ============================================================
   Situations Trainer -- "Where do I go?" Pick a ball event, a base
   state and an out count; this resolves all nine defensive
   responsibilities from a rules table and animates the play in real
   time (ball off the bat, runners breaking, fielders moving, throws
   base to base, an out/safe call). Ported from the .claude/skills/
   lybs-situations skill's standalone prototype
   (assets/baseball-situations.html) -- read that skill's reference
   docs (data-model.md, field-geometry.md, timing-and-animation.md)
   before changing the resolver, the field coordinates or the timing
   constants; every number below came out of that prototype and is
   covered by its own validator (scripts/validate.js).

   This is a player-facing teaching tool, not part of the coach/admin
   dashboard -- reachable only by non-coach roles (see index.html's
   NAV_CATEGORIES/NON_COACH_TABS), same way `coaching` is reachable
   only by coaches. Phase 1 only: the core trainer itself. Explicitly
   NOT built yet (deferred, needs its own data-persistence design):
   the quiz/leaderboard, the coach's rule-editing screen (MYRULES/
   localStorage overrides in the prototype), and a per-team roster/
   schedule tab (LYBS already has those -- this module never
   duplicates them). The prototype's own "Rules" tab (the five core
   principles, infield fly, dropped-third-strike, cut numbers) is
   folded into an (i) button using window.openInfoModal -- the same
   "explains how something works" pattern index.html already
   established for other reference content, rather than a second nav
   tab for what's static text.

   Content is baseball-only this phase -- data/situations.csv has no
   `sport` column yet (the skill's own guidance is to add one and
   filter, not fork, once a softball team actually needs it; Select
   is baseball-only today).

   Data: data/situations.csv (55 rows, what happened) and
   data/responsibilities.csv (707 rows, who does what -- resolved by
   specificity at runtime, see resolve() below) are the hand-editable
   source of truth, mirrored into shared/situationRules the first
   time any signed-in viewer loads this tab -- same "seed once, then
   that's the live copy" convention js/rules.js already uses for the
   league rulebook. Gated board-write in database.rules.json (like
   shared/skillBenchmarks/shared/practiceCatalog, not open-write like
   shared/rules): this is citation-grounded authored curriculum, not
   a self-correctable published rulebook.
   ============================================================ */
(function () {
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); cell = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(v => v !== '')) rows.push(row);
    const head = rows.shift() || [];
    return rows.map(r => { const o = {}; head.forEach((h, i) => o[h.trim()] = (r[i] ?? '').trim()); return o; });
  }

  /* ------------------------------ geometry (520x482 viewBox -- see
     field-geometry.md; do not change without updating every landmark
     and ball position that depends on it) ------------------------------ */
  const HOME = [260, 415], MOUND = [260, 334], B1 = [335, 340], B2 = [260, 265], B3 = [185, 340];
  const STARTS = {
    P: [260, 336], C: [260, 452], '1B': [348, 316], '2B': [312, 258], '3B': [172, 316],
    SS: [208, 258], LF: [108, 214], CF: [260, 162], RF: [412, 214],
  };
  const LM = {
    BASE_1: B1, BASE_2: B2, BASE_3: B3, PLATE: HOME, MOUND: MOUND, BALL: null,
    BU_1: [392, 308], BU_2: [260, 210], BU_3: [128, 308], BU_PLATE: [272, 464],
    BU_1_IN: [369, 334], BU_1_LINE: [318, 362], BU_3_IN: [151, 334],
    BU_2_L: [234, 232], BU_2_R: [286, 232],
    CHASE_TO_1: [318, 320], CHASE_TO_2: [238, 288], CHASE_TO_3: [208, 362],
    CUT_PLATE_L: [224, 372], CUT_PLATE_R: [296, 372],
    CUT_3: [214, 296], CUT_3_L: [198, 300], CUT_3_R: [230, 294],
    CUT_2: [260, 300], CUT_2_L: [224, 290], CUT_2_R: [296, 290],
    RELAY_LF: [150, 270], RELAY_LC: [198, 234], RELAY_CF: [252, 224], RELAY_RC: [322, 234], RELAY_RF: [370, 270],
    TRAIL_LC: [234, 270], TRAIL_RC: [288, 270],
    RELAY_CORNER_L: [152, 290], RELAY_CORNER_R: [368, 290],
    TRAIL_LF: [188, 300], TRAIL_RF: [332, 300],
    RELAY_DEEP_L: [176, 190], RELAY_DEEP_R: [344, 190],
    TRAIL_DEEP_L: [218, 238], TRAIL_DEEP_R: [302, 238],
  };
  Object.keys(STARTS).forEach(p => { LM['POS_' + p] = STARTS[p]; });
  const POSN = { P: '1', C: '2', '1B': '3', '2B': '4', '3B': '5', SS: '6', LF: '7', CF: '8', RF: '9' };
  const POSLIST = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const POSFULL = {
    P: 'Pitcher', C: 'Catcher', '1B': 'First baseman', '2B': 'Second baseman', '3B': 'Third baseman',
    SS: 'Shortstop', LF: 'Left fielder', CF: 'Center fielder', RF: 'Right fielder',
  };
  const ROLES = {
    FIELD: { c: 'var(--sit-amber)', t: 'Field the ball' },
    CHASE: { c: 'var(--sit-orange)', t: 'Run the runner back' },
    COVER: { c: 'var(--sit-chalk)', t: 'Cover a base' },
    CUT: { c: 'var(--sit-cyan)', t: 'Cutoff man' },
    RELAY: { c: 'var(--sit-cyan)', t: 'Relay man' },
    TRAIL: { c: 'var(--sit-cyan)', t: 'Trail the relay' },
    BACKUP: { c: 'var(--sit-violet)', t: 'Back up a throw' },
    PLATE: { c: 'var(--sit-chalk)', t: 'Protect the plate' },
    DIRECT: { c: 'var(--sit-lime)', t: 'Talk / direct traffic' },
    HOLD: { c: 'var(--sit-mute)', t: 'Hold your spot' },
  };
  const TAPTYPES = [
    ['ground', 'Grounder', ['ground']], ['air', 'In the air', ['fly', 'pop']],
    ['hit', 'Base hit', ['hit', 'gap']], ['bunt', 'Bunt', ['bunt']],
  ];

  /* ------------------------------ field drawing (see field-geometry.md
     for the drawing-order rationale) ------------------------------ */
  /* Field shape, drawn to scale from the reference image: 106px = 60ft.
     Majors dimensions: 60ft bases, 46ft mound, 200ft fence measured from home
     (353px), so the fence is an arc centred on home. Foul ground runs parallel
     to each foul line and the two sides meet in a point behind home. The
     skinned infield is an arc of 81ft around a point just in front of the
     mound, cut off at the foul lines. Recompute TRACK_* with GROUND_* if the
     fence moves: they're the same shape, 12px larger. */
  const FENCE_R = 353, FOUL_W = 62, TRACK_W = 12;
  function vPoint(offset, r) {
    // Where a side, `offset` px outside the foul line, meets a fence arc of radius r.
    const k = offset * Math.SQRT2, t = (k + Math.sqrt(2 * r * r - k * k)) / 2;
    return [260 - t, 415 + k - t];
  }
  function groundPath(offset, r) {
    const [x, y] = vPoint(offset, r), f = n => n.toFixed(1), k = offset * Math.SQRT2;
    return `M${f(x)},${f(y)} A${r},${r} 0 0 1 ${f(520 - x)},${f(y)} L260,${f(415 + k)} Z`;
  }
  const GROUND = groundPath(FOUL_W, FENCE_R);
  const TRACK = groundPath(FOUL_W + TRACK_W, FENCE_R + TRACK_W);
  const FOUL_END = 250; // 200ft down each line: 353px at 45 deg is 250px on each axis
  const SKIN = 'M260,415 L131.4,286.4 A143,143 0 0 1 388.6,286.4 Z';
  function fenceDist() { return FENCE_R; }
  function mowStripes() {
    let out = '';
    const N = 18, span = 180, a0 = -90;
    for (let i = 0; i < N; i++) {
      if (i % 2) continue;
      const r = 460, p = a => [260 + r * Math.sin(a * Math.PI / 180), 415 - r * Math.cos(a * Math.PI / 180)];
      const [x0, y0] = p(a0 + i * span / N), [x1, y1] = p(a0 + (i + 1) * span / N);
      out += `<path d="M260,415 L${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="var(--sit-grass2)" opacity=".62"/>`;
    }
    return out;
  }
  function fieldBase() {
    return `
    <defs>
      <clipPath id="sitGroundClip"><path d="${GROUND}"/></clipPath>
      <!-- 1B and 3B cutouts sit on a foul line, so they're trimmed to the fair
           side. Home's circle is full, as on a real field. -->
      <clipPath id="sitSkinClip"><path d="${SKIN}"/></clipPath>
      <radialGradient id="sitGLight" cx="50%" cy="74%" r="80%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".17"/>
        <stop offset=".5" stop-color="#ffffff" stop-opacity=".05"/>
        <stop offset="1" stop-color="#000814" stop-opacity=".30"/>
      </radialGradient>
      <radialGradient id="sitDLight" cx="50%" cy="86%" r="78%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".15"/>
        <stop offset=".6" stop-color="#ffffff" stop-opacity=".02"/>
        <stop offset="1" stop-color="#000814" stop-opacity=".22"/>
      </radialGradient>
      <radialGradient id="sitMLight" cx="42%" cy="34%" r="70%">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/>
        <stop offset="1" stop-color="#000814" stop-opacity=".16"/>
      </radialGradient>
    </defs>

    <rect x="-60" y="20" width="640" height="520" fill="#0e1a15"/>

    <path d="${TRACK}" fill="var(--sit-track)"/>
    <path d="${TRACK}" fill="none" stroke="#16241c" stroke-width="3.5" stroke-linejoin="round"/>

    <path d="${GROUND}" fill="var(--sit-grass)"/>
    <g clip-path="url(#sitGroundClip)">${mowStripes()}</g>
    <path d="${GROUND}" fill="url(#sitGLight)"/>
    <path d="${GROUND}" fill="none" stroke="#2a5a41" stroke-width="2" stroke-linejoin="round"/>

    <path d="${SKIN}" fill="var(--sit-dirt)"/>
    <path d="${SKIN}" fill="url(#sitDLight)"/>
    <path d="${SKIN}" fill="none" stroke="#7d5133" stroke-width="1.6" opacity=".7"/>

    <polygon points="260,395 315,340 260,285 205,340" fill="var(--sit-grass)"/>
    <polygon points="260,395 315,340 260,285 205,340" fill="url(#sitGLight)"/>
    <polygon points="260,395 315,340 260,285 205,340" fill="none" stroke="#2a5a41" stroke-width="1.6"/>
    <g clip-path="url(#sitSkinClip)"><circle cx="335" cy="340" r="17" fill="var(--sit-dirt)"/></g>
    <circle cx="260" cy="265" r="17" fill="var(--sit-dirt)"/>
    <g clip-path="url(#sitSkinClip)"><circle cx="185" cy="340" r="17" fill="var(--sit-dirt)"/></g>
    <circle cx="260" cy="417" r="26" fill="var(--sit-dirt)"/>
    <circle cx="260" cy="334" r="18" fill="var(--sit-dirt)"/>
    <circle cx="260" cy="334" r="18" fill="url(#sitMLight)"/>
    <rect x="254" y="332" width="12" height="4" rx="1" fill="#fff" opacity=".92"/>

    <line x1="260" y1="415" x2="${260 - FOUL_END}" y2="${415 - FOUL_END}" stroke="#fff" stroke-width="3"/>
    <line x1="260" y1="415" x2="${260 + FOUL_END}" y2="${415 - FOUL_END}" stroke="#fff" stroke-width="3"/>
    <line x1="${260 - FOUL_END}" y1="${415 - FOUL_END}" x2="${260 - FOUL_END}" y2="${415 - FOUL_END - 28}" stroke="#f5d76e" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="${260 + FOUL_END}" y1="${415 - FOUL_END}" x2="${260 + FOUL_END}" y2="${415 - FOUL_END - 28}" stroke="#f5d76e" stroke-width="4.5" stroke-linecap="round"/>

    <rect x="343" y="341" width="38" height="15" fill="none" stroke="#fff" stroke-width="1.6"
          opacity=".8" transform="rotate(-45 362 348.5)"/>
    <rect x="139" y="341" width="38" height="15" fill="none" stroke="#fff" stroke-width="1.6"
          opacity=".8" transform="rotate(45 158 348.5)"/>

    <rect x="241" y="406" width="10" height="17" fill="none" stroke="#fff" stroke-width="1.4" opacity=".8"/>
    <rect x="269" y="406" width="10" height="17" fill="none" stroke="#fff" stroke-width="1.4" opacity=".8"/>
    <rect x="249" y="425" width="22" height="13" fill="none" stroke="#fff" stroke-width="1.4" opacity=".65"/>

    <rect x="329" y="334" width="12" height="12" fill="#fff" transform="rotate(45 335 340)"/>
    <rect x="254" y="259" width="12" height="12" fill="#fff" transform="rotate(45 260 265)"/>
    <rect x="179" y="334" width="12" height="12" fill="#fff" transform="rotate(45 185 340)"/>
    <polygon points="252,408 268,408 268,417 260,424 252,417" fill="#fff"/>`;
  }

  /* ------------------------------ timing model (division tuning knob --
     see timing-and-animation.md) ------------------------------ */
  const TIME = {
    runner: 26, rounding: 1.15, fielder: 34, throw: 118, react: .25, transfer: .42,
    ball: { ground: 130, bunt: 74, hit: 150, gap: 150, loose: 95, run: 120, steal: 400, pick: 400 },
    hang: { fly: 3.2, pop: 2.5 },
    gather: { ground: .55, bunt: .75, hit: .7, gap: 2.6, fly: .55, pop: .4, loose: .85, steal: .9, pick: .1, run: .2 },
  };
  const BASEPT = { H: HOME, '1': B1, '2': B2, '3': B3 };
  const NEXT = { H: '1', '1': '2', '2': '3', '3': 'H' };
  const MAXSTEP = { H: 4, '1': 3, '2': 2, '3': 1 };
  const BASEKEY = { BASE_1: '1', BASE_2: '2', BASE_3: '3', PLATE: 'H' };
  const BASENAME = { '1': 'first', '2': 'second', '3': 'third', H: 'the plate' };
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  function along(pts, k) {
    if (pts.length < 2) return pts[0].slice();
    const seg = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); seg.push(d); tot += d; }
    if (!tot) return pts[0].slice();
    let want = k * tot;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const f = seg[i] ? Math.max(0, Math.min(1, want / seg[i])) : 1;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
      want -= seg[i];
    }
    return pts[pts.length - 1].slice();
  }

  /* ------------------------------ shared/situationRules load ------------------------------
     Bump this whenever data/situations.csv or data/responsibilities.csv changes.
     Without it, this follows js/rules.js's "seed once, then that's the live
     copy" convention literally -- fine for a rulebook that's re-pulled by hand
     once an offseason, wrong here: a CSV fix committed today would otherwise
     never reach a device that already seeded shared/situationRules from an
     earlier, buggier build (there is no coach-edit UI yet to justify treating
     the shared copy as authoritative over the shipped file -- see this file's
     header comment). Comparing rulesVersion makes every load -- board member
     or not -- re-pull the shipped CSVs instead of trusting a stale mirror;
     only the WRITE that re-seeds it for everyone else still needs a board
     member (shared/situationRules is gated board-write in database.rules.json). */
  const RULES_VERSION = '20261103e';
  let cache = null; // { situations:[...], responsibilities:[...] }
  let pending = null;

  async function loadShared(isBoard) {
    let data = await window.dbGet(window.sharedPath('situationRules'));
    if (!data || !Array.isArray(data.situations) || !data.situations.length || data.rulesVersion !== RULES_VERSION) {
      const [sitText, respText] = await Promise.all([
        fetch('data/situations.csv?v=' + window.BUILD_V).then(r => r.text()).catch(() => ''),
        fetch('data/responsibilities.csv?v=' + window.BUILD_V).then(r => r.text()).catch(() => ''),
      ]);
      data = { situations: parseCSV(sitText), responsibilities: parseCSV(respText), rulesVersion: RULES_VERSION };
      if (isBoard) {
        try { await window.dbPut(window.sharedPath('situationRules'), data); } catch (e) { /* already toasted; browse the fetched copy in memory regardless */ }
      }
    }
    return data;
  }

  window.Situations = {
    async ensureLoaded(isBoard) {
      if (cache) return cache;
      if (pending) return pending;
      pending = loadShared(isBoard).then(data => { cache = data; pending = null; return cache; });
      return pending;
    },

    render(containerEl) {
      const SITS = cache.situations;
      const BASE_RULES = cache.responsibilities;
      if (!SITS.length) {
        containerEl.innerHTML = '<div class="emptyState">Situations data isn\'t available right now.</div>';
        return;
      }

      function rules() { return BASE_RULES; }
      function sitById(id) { return SITS.find(s => s.ball_id === id) || SITS[0]; }
      function basesLabel(b) {
        return b === '_' ? 'Bases empty' : 'Runner' + (b.length > 1 ? 's' : '') + ' on ' +
          b.split('').map(x => ({ '1': '1st', '2': '2nd', '3': '3rd' })[x]).join(' & ');
      }

      /* ------------------------------ resolver (see data-model.md) ------------------------------ */
      function matches(pat, val) {
        if (pat === '*' || pat === '') return true;
        return pat.split('|').some(p => p.trim() === String(val));
      }
      function resolve(ball, bases, outs, infIn) {
        const out = {};
        rules().forEach((r, i) => {
          if (r.ball_id !== ball) return;
          if (!matches(r.bases, bases)) return;
          if (!matches(r.outs, outs)) return;
          if (r.context && r.context !== '*') { if (r.context === 'INF_IN' && !infIn) return; }
          const score = (r.bases !== '*' ? 4 : 0) + (r.outs !== '*' ? 2 : 0) + (r.context !== '*' ? 8 : 0) + (i / 100000);
          const cur = out[r.pos];
          if (!cur || score >= cur._s) out[r.pos] = Object.assign({}, r, { _s: score });
        });
        POSLIST.forEach(p => { if (!out[p]) out[p] = { pos: p, role: 'HOLD', target: 'POS_' + p, cue: 'Hold your spot and watch the ball.', throw: '', _s: -1 }; });
        return out;
      }
      function pt(name, sit) {
        if (!name || name === 'BALL') return [+sit.ball_x, +sit.ball_y];
        return LM[name] || STARTS[name] || [+sit.ball_x, +sit.ball_y];
      }

      let S = { ball: SITS[0].ball_id, bases: '_', outs: 0, infIn: false, me: null, tapType: 'ground' };

      function runnersSVG(bases) {
        let s = '';
        const spots = { '1': B1, '2': B2, '3': B3 };
        bases.split('').forEach(b => {
          if (!spots[b]) return; const [x, y] = spots[b];
          s += `<circle cx="${x + 17}" cy="${y - 13}" r="8" fill="var(--sit-rose)" stroke="#12241c" stroke-width="2.5"/>`;
        });
        return s;
      }
      function planRunnersSVG(plan) {
        return plan.runners.map((r, i) => {
          const [x, y] = r.pts[0];
          return `<ellipse data-rsh="${i}" cx="${x}" cy="${y + 9}" rx="8" ry="3" fill="#06110c" opacity=".33"/>` +
                 `<circle data-runner="${i}" cx="${x}" cy="${y}" r="8.5" fill="var(--sit-rose)" stroke="#12241c" stroke-width="2.5"/>`;
        }).join('');
      }
      function renderField(svg, assign, sit, opts) {
        opts = opts || {};
        let s = fieldBase() + (opts.plan ? planRunnersSVG(opts.plan) : runnersSVG(S.bases));
        s += `<circle cx="${sit.ball_x}" cy="${sit.ball_y}" r="6" fill="none" stroke="#fff" stroke-width="2.5" opacity=".95"/>`;
        s += `<circle cx="${sit.ball_x}" cy="${sit.ball_y}" r="13" fill="none" stroke="#fff" stroke-width="1.5" opacity=".5"/>`;
        if (!opts.hideRoutes) {
          POSLIST.forEach(p => {
            const a = assign[p]; const from = STARTS[p]; const to = pt(a.target, sit);
            if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 6) return;
            if (opts.only && opts.only !== p) return;
            const col = ROLES[a.role] ? ROLES[a.role].c : 'var(--sit-mute)';
            const dim = (S.me && S.me !== p && !opts.only) ? '.22' : '.8';
            s += `<line class="sitRoute" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="${col}" stroke-width="2.5" opacity="${dim}"/>`;
          });
        }
        POSLIST.forEach(p => {
          const a = assign[p]; const col = ROLES[a.role] ? ROLES[a.role].c : 'var(--sit-mute)';
          const [x, y] = STARTS[p];
          const isMe = S.me === p; const dim = (S.me && !isMe) ? .3 : 1;
          // data-hit is a transparent, oversized (r=34 vs the ~13.5 visible
          // dot) tap target layered over each player -- on a phone the bare
          // dot alone measured well under the ~44px touch-target minimum,
          // so a tap that missed it by even a few px landed on the field
          // background instead and silently re-picked the situation there
          // (confusing: looked like nothing happened, or worse, changed the
          // play) instead of selecting that player's job. pointer-events:
          // all is required -- a transparent fill alone is NOT "painted"
          // under SVG's default pointer-events:visiblePainted, so it
          // wouldn't otherwise receive clicks at all.
          s += `<g class="sitPlayer" data-pos="${p}" opacity="${dim}">
            <ellipse data-sh="${p}" cx="${x}" cy="${y + (isMe ? 16 : 13.5) - 2}" rx="${isMe ? 14 : 12}" ry="4.5" fill="#06110c" opacity=".35"/>
            <circle class="sitPdot" data-dot="${p}" cx="${x}" cy="${y}" r="${isMe ? 16 : 13.5}" fill="${col}"/>
            <text class="sitPtxt" data-txt="${p}" x="${x}" y="${y}">${POSN[p]}</text>
            <circle data-hit="${p}" cx="${x}" cy="${y}" r="34" fill="transparent" pointer-events="all"/></g>`;
        });
        s += `<ellipse id="sitBallsh" cx="260" cy="415" rx="5" ry="2" fill="#06110c" opacity="0"/>` +
             `<circle id="sitBall" cx="260" cy="415" r="6" fill="#fff" stroke="#8c2f28" stroke-width="1.5" opacity="0"/>`;
        svg.innerHTML = s;
      }

      function receiverAt(assign, landmark) {
        const want = ['COVER', 'PLATE', 'CUT', 'RELAY', 'CHASE'];
        return POSLIST.find(p => assign[p].target === landmark && want.includes(assign[p].role)) ||
               POSLIST.find(p => assign[p].target === landmark);
      }
      // The scorebook number sequence for a play -- same walk buildPlay()
      // does to build its own throw chain, pulled out standalone (no legs/
      // timing) so the quiz can ask "what's a 6-4-3" without animating
      // anything. Returns null when the ball never leaves one player's
      // glove (nothing to score as a numbered sequence).
      function computeChain(ballId, bases, outs) {
        const assign = resolve(ballId, bases, outs, false);
        const thrower = POSLIST.find(p => assign[p].throw);
        if (!thrower) return null;
        const chain = [POSN[thrower]];
        assign[thrower].throw.split('>').forEach(step => {
          const rec = receiverAt(assign, step.trim());
          if (rec && POSN[rec] !== chain[chain.length - 1]) chain.push(POSN[rec]);
        });
        return chain.length > 1 ? chain : null;
      }
      function runnerPlan(sit, bases, outs, catchT) {
        const code = sit.runners || 'force', out = [];
        const has = b => bases.indexOf(b) >= 0;
        const add = (from, steps, delay, mul) => {
          steps = Math.min(steps, MAXSTEP[from]);
          const pts = [BASEPT[from].slice()]; let cur = from;
          for (let i = 0; i < steps; i++) { cur = NEXT[cur]; pts.push(BASEPT[cur].slice()); }
          let d = 0; for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
          const spd = TIME.runner * (mul || (steps > 1 ? TIME.rounding : 1));
          out.push({ pts, start: delay, dur: Math.max(.45, d / spd), from, to: cur });
        };
        if (code === 'force') {
          add('H', 1, TIME.react);
          if (has('1')) { add('1', 1, 0); if (has('2')) { add('2', 1, 0); if (has('3')) add('3', 1, 0); } }
        } else if (code === 'single') {
          add('H', 1, TIME.react);
          if (has('1')) add('1', 2, 0); if (has('2')) add('2', 2, 0); if (has('3')) add('3', 1, 0);
        } else if (code === 'contact') {
          add('H', 1, TIME.react);
          ['1', '2', '3'].forEach(b => { if (has(b)) add(b, 1, 0); });
        } else if (code === 'double') {
          add('H', 2, TIME.react);
          if (has('1')) add('1', 2, 0); if (has('2')) add('2', 2, 0); if (has('3')) add('3', 1, 0);
        } else if (code === 'triple') {
          add('H', 3, TIME.react);
          if (has('1')) add('1', 3, 0); if (has('2')) add('2', 2, 0); if (has('3')) add('3', 1, 0);
        } else if (code === 'tag') {
          if (outs < 2) { if (has('3')) add('3', 1, catchT + .12, TIME.rounding); if (has('2')) add('2', 1, catchT + .12, TIME.rounding); }
        } else if (code === 'wp') {
          ['1', '2', '3'].forEach(b => { if (has(b)) add(b, 1, .38); });
        } else if (code === 'steal2') { if (has('1')) add('1', 1, 0);
        } else if (code === 'steal3') { if (has('2')) add('2', 1, 0);
        } else if (code === 'pickoff') {
          const b = (sit.set_bases || '1').charAt(0);
          if (has(b)) {
            const a = BASEPT[b], n = BASEPT[NEXT[b]];
            const lead = [a[0] + (n[0] - a[0]) * .22, a[1] + (n[1] - a[1]) * .22];
            out.push({ pts: [a.slice(), lead, a.slice()], start: 0, dur: 1.9, from: b, to: b });
          }
        } else if (code === 'rundown') {
          const b = (sit.set_bases || '1').charAt(0);
          if (has(b)) {
            const a = BASEPT[b], n = BASEPT[NEXT[b]];
            const mid = [(a[0] + n[0]) / 2, (a[1] + n[1]) / 2];
            const far = [a[0] + (n[0] - a[0]) * .72, a[1] + (n[1] - a[1]) * .72];
            out.push({ pts: [mid, far, mid, a.slice()], start: 0, dur: 3.2, from: b, to: b });
          }
        }
        ['1', '2', '3'].forEach(b => { if (has(b) && !out.some(r => r.from === b)) out.push({ pts: [BASEPT[b].slice()], start: 0, dur: .1, from: b, to: b, hold: true }); });
        return out;
      }

      /* ------------------------------ building one play ------------------------------ */
      function buildPlay() {
        const sit = sitById(S.ball), assign = resolve(S.ball, S.bases, S.outs, S.infIn);
        const type = sit.ball_type || 'ground';
        const bp = [+sit.ball_x, +sit.ball_y];
        const origin = (sit.ball_from && LM[sit.ball_from]) ? LM[sit.ball_from].slice() : HOME.slice();
        const legs = []; let t = 0;
        const fl = TIME.hang[type] || Math.max(.3, dist(origin, bp) / (TIME.ball[type] || 150));
        legs.push({ from: origin, to: bp, start: 0, dur: fl, arc: (type === 'fly' || type === 'pop') ? 38 : ((type === 'hit' || type === 'gap') ? 14 : 0) });
        t = fl;
        // A gap ball nobody catches doesn't stop dead where it lands --
        // it keeps rolling. Extend it on toward the fence, straight out
        // along the same line from home, when it landed more than
        // ROLL_MIN short of the fence; a ball already hit into the
        // corner or off the wall is skipped since there's nothing left
        // to roll. Fielders and the throw both start from the real stop
        // point (stopPt), not the landing spot, via sitB below.
        const ROLL_MIN = 10;
        let stopPt = bp;
        if (type === 'gap') {
          const landedR = dist(HOME, bp), fenceR = fenceDist(bp);
          if (fenceR - landedR > ROLL_MIN) {
            const ux = (bp[0] - HOME[0]) / landedR, uy = (bp[1] - HOME[1]) / landedR;
            stopPt = [HOME[0] + ux * fenceR, HOME[1] + uy * fenceR];
            const rollDur = Math.max(.3, (fenceR - landedR) / TIME.ball.loose);
            legs.push({ from: bp, to: stopPt, start: t, dur: rollDur, arc: 0 });
            t += rollDur;
          }
        }
        const sitB = stopPt === bp ? sit : Object.assign({}, sit, { ball_x: stopPt[0], ball_y: stopPt[1] });
        const chain = []; const thrower = POSLIST.find(p => assign[p].throw);
        if (thrower) {
          chain.push(POSN[thrower]);
          t += (TIME.gather[type] != null ? TIME.gather[type] : .5);
          let from = stopPt, prevCut = false;
          assign[thrower].throw.split('>').forEach((step, i) => {
            const key = step.trim(), to = pt(key, sitB);
            if (i > 0 && !prevCut) t += TIME.transfer;
            prevCut = (key.indexOf('CUT_') === 0);
            const dur = Math.max(.22, dist(from, to) / TIME.throw);
            legs.push({ from, to, start: t, dur, arc: 11, target: key });
            t += dur; from = to;
            const rec = receiverAt(assign, key);
            if (rec && POSN[rec] !== chain[chain.length - 1]) chain.push(POSN[rec]);
          });
        }
        const moves = POSLIST.map(p => { const from = STARTS[p].slice(), to = pt(assign[p].target, sitB); return { p, from, to, dur: Math.max(.2, dist(from, to) / TIME.fielder) }; });
        const runners = runnerPlan(sit, S.bases, S.outs, fl);
        const calls = [];
        if (sit.runners !== 'rundown') legs.forEach(l => {
          const bk = BASEKEY[l.target]; if (!bk) return;
          const r = runners.find(x => x.to === bk && !x.hold); if (!r) return;
          const ballT = l.start + l.dur, runT = r.start + r.dur;
          calls.push({ base: bk, out: ballT < runT - .03, t: Math.max(ballT, runT) });
        });
        const ends = runners.map(r => r.start + r.dur).concat([t, 1.5]);
        return { sit, assign, legs, moves, runners, calls, chain, duration: Math.max.apply(null, ends) + .8 };
      }

      /* ------------------------------ playback ------------------------------ */
      let PLAN = null, PT = 0, PLAYING = false, RATE = 1, raf = null, lastNow = 0;
      function setPP() { const b = containerEl.querySelector('#sitBtnPP'); if (b) b.textContent = PLAYING ? 'Pause' : 'Play'; }
      function stopPlay() { PLAYING = false; if (raf) cancelAnimationFrame(raf); raf = null; setPP(); }
      function tick(now) {
        if (!PLAYING || !PLAN) return;
        PT += Math.min(.05, (now - lastNow) / 1000) * RATE; lastNow = now;
        if (PT >= PLAN.duration) { PT = PLAN.duration; renderAt(PLAN, PT); stopPlay(); return; }
        renderAt(PLAN, PT); raf = requestAnimationFrame(tick);
      }
      function runPlay() {
        drawPlay(); PT = 0; PLAYING = true; lastNow = performance.now(); setPP();
        if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
      }
      function renderAt(plan, t) {
        const svg = containerEl.querySelector('#sitSvg'); if (!svg) return;
        plan.moves.forEach(m => {
          const k = Math.max(0, Math.min(1, t / m.dur)), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const x = m.from[0] + (m.to[0] - m.from[0]) * e, y = m.from[1] + (m.to[1] - m.from[1]) * e;
          const d = svg.querySelector('[data-dot="' + m.p + '"]'), tx = svg.querySelector('[data-txt="' + m.p + '"]');
          const sh = svg.querySelector('[data-sh="' + m.p + '"]'), hit = svg.querySelector('[data-hit="' + m.p + '"]');
          if (d) { d.setAttribute('cx', x); d.setAttribute('cy', y); }
          if (tx) { tx.setAttribute('x', x); tx.setAttribute('y', y); }
          if (sh) { sh.setAttribute('cx', x); sh.setAttribute('cy', y + (+d.getAttribute('r')) - 2); }
          // Keeps the enlarged tap target (below) centered on the player's
          // CURRENT position while the play is paused/scrubbed mid-animation,
          // not just at the start position.
          if (hit) { hit.setAttribute('cx', x); hit.setAttribute('cy', y); }
        });
        plan.runners.forEach((r, i) => {
          const el = svg.querySelector('[data-runner="' + i + '"]'); if (!el) return;
          const k = Math.max(0, Math.min(1, (t - r.start) / r.dur));
          const p = along(r.pts, k); el.setAttribute('cx', p[0]); el.setAttribute('cy', p[1]);
          const rs = svg.querySelector('[data-rsh="' + i + '"]');
          if (rs) { rs.setAttribute('cx', p[0]); rs.setAttribute('cy', p[1] + 9); }
        });
        const ball = svg.querySelector('#sitBall');
        if (ball) {
          let leg = plan.legs[0];
          for (let i = 0; i < plan.legs.length; i++) if (t >= plan.legs[i].start) leg = plan.legs[i];
          const k = Math.max(0, Math.min(1, (t - leg.start) / leg.dur));
          const bx = leg.from[0] + (leg.to[0] - leg.from[0]) * k;
          const gy = leg.from[1] + (leg.to[1] - leg.from[1]) * k;
          const lift = Math.sin(k * Math.PI) * (leg.arc || 0);
          ball.setAttribute('cx', bx); ball.setAttribute('cy', gy - lift); ball.setAttribute('opacity', '1');
          const bs = svg.querySelector('#sitBallsh');
          if (bs) {
            const h = Math.min(1, lift / 38);
            bs.setAttribute('cx', bx); bs.setAttribute('cy', gy + 3);
            bs.setAttribute('rx', 5 + h * 4); bs.setAttribute('ry', 2 + h * 1.4);
            bs.setAttribute('opacity', String(.34 - h * .16));
          }
        }
        const cl = containerEl.querySelector('#sitClock'); if (cl) cl.textContent = t.toFixed(1) + 's';
        const sc = containerEl.querySelector('#sitScrub'); if (sc && PLAYING) sc.value = Math.round(t / plan.duration * 1000);
        const cb = containerEl.querySelector('#sitCallBox');
        if (cb) {
          const shown = plan.calls.filter(c => t >= c.t + .15);
          let h = shown.map(c => '<span class="sitCall ' + (c.out ? 'sitOut' : 'sitSafe') + '">' +
            (c.out ? 'Out at ' : 'Safe at ') + BASENAME[c.base] + '</span>').join('');
          if (shown.length && plan.chain.length > 1) h += '<span class="sitCall sitNote">' + plan.chain.join('-') + '</span>';
          cb.innerHTML = h;
        }
      }

      /* ------------------------------ play page ------------------------------ */
      function drawPlay() {
        stopPlay(); PT = 0;
        PLAN = buildPlay();
        const sit = PLAN.sit, assign = PLAN.assign;
        renderField(containerEl.querySelector('#sitSvg'), assign, sit, { plan: PLAN });
        const sc = containerEl.querySelector('#sitScrub'); if (sc) sc.value = 0;
        renderAt(PLAN, 0);
        containerEl.querySelector('#sitFieldHint').textContent = sit.label + ' · ' + basesLabel(S.bases) + ' · ' + S.outs + ' out' + (S.outs === 1 ? '' : 's');

        const big = containerEl.querySelector('#sitBigJobBox');
        if (S.me) {
          const a = assign[S.me];
          big.innerHTML = `<div class="sitBigjob"><div class="sitR">${escapeHtml((ROLES[a.role] || { t: a.role }).t)}</div>
            <div class="sitC">${escapeHtml(a.cue || '')}</div></div>`;
        } else big.innerHTML = '';

        containerEl.querySelector('#sitJobs').innerHTML = POSLIST.map(p => {
          const a = assign[p]; const col = ROLES[a.role] ? ROLES[a.role].c : 'var(--sit-mute)';
          const cls = S.me === p ? 'sitJob sitJobMe' : (S.me ? 'sitJob sitJobDim' : 'sitJob');
          return `<div class="${cls}">
            <div class="sitNum"><span class="sitJn" style="background:${col}">${POSN[p]}</span><span class="sitJp">${escapeHtml(p)}</span></div>
            <div class="sitBody"><div class="sitRole" style="color:${col}">${escapeHtml((ROLES[a.role] || { t: a.role }).t)}</div>
            <div class="sitCue">${escapeHtml(a.cue || '')}</div></div></div>`;
        }).join('');

        const tb = containerEl.querySelector('#sitTeachBox');
        if (sit.teaching_point) { tb.style.display = ''; tb.innerHTML = '<b class="situationsCond" style="color:var(--sit-amber)">Coaching point</b><br>' + escapeHtml(sit.teaching_point); }
        else tb.style.display = 'none';
      }

      function buildPicker() {
        const box = containerEl.querySelector('#sitPickBox');
        const groups = [...new Set(SITS.map(s => s.group))];
        box.innerHTML = groups.map(g => `<div class="sitCard"><div class="sitLbl situationsCond" style="font-size:11px;letter-spacing:.14em;">${escapeHtml(g.toUpperCase())}</div>
          <div class="sitChips">${SITS.filter(s => s.group === g).map(s =>
            `<button class="sitChip${s.ball_id === S.ball ? ' on' : ''}" data-sit="${escapeHtml(s.ball_id)}">${escapeHtml(s.label)}</button>`).join('')}</div></div>`).join('');
      }
      function nearestSituation(x, y) {
        const types = (TAPTYPES.find(t => t[0] === S.tapType) || TAPTYPES[0])[2];
        let best = null, bd = 1e9;
        SITS.forEach(s => {
          if (s.tap === 'no' || !types.includes(s.ball_type)) return;
          const d = Math.hypot(x - s.ball_x, y - s.ball_y); if (d < bd) { bd = d; best = s; }
        });
        return best;
      }
      function svgPoint(svg, evt) {
        const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
        const cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
        const cy = (evt.touches ? evt.touches[0].clientY : evt.clientY) - r.top;
        return [vb.x + cx / r.width * vb.width, vb.y + cy / r.height * vb.height];
      }

      function syncOuts() {
        [...containerEl.querySelector('#sitOutsBox').children].forEach(x => x.classList.toggle('on', +x.dataset.out < S.outs));
      }
      function syncDiamond() {
        containerEl.querySelectorAll('.sitDiamond button').forEach(x => x.setAttribute('aria-pressed', S.bases.includes(x.dataset.base) ? 'true' : 'false'));
      }
      function setSituation(id) {
        S.ball = id; const st = sitById(id);
        if (st.set_bases) { S.bases = st.set_bases; syncDiamond(); }
        if (st.set_outs !== '' && st.set_outs != null) { S.outs = +st.set_outs; syncOuts(); }
        buildPicker(); drawPlay();
      }
      function buildTypeChips() {
        containerEl.querySelector('#sitTypeChips').innerHTML = TAPTYPES.map(t =>
          `<button class="sitChip${S.tapType === t[0] ? ' on' : ''}" data-tt="${t[0]}">${escapeHtml(t[1])}</button>`).join('');
      }
      function buildMeChips() {
        containerEl.querySelector('#sitMeChips').innerHTML = POSLIST.map(p =>
          `<button class="sitChip${S.me === p ? ' on' : ''}" data-me="${p}">${escapeHtml(p)}</button>`).join('') +
          `<button class="sitChip${!S.me ? ' on' : ''}" data-me="">Everybody</button>`;
      }

      /* ------------------------------ quiz ------------------------------
         Multiple choice, not tap-to-point -- a tap quiz needs the question
         to already pin down one exact base/out state or the "right" spot
         on the field is ambiguous (the prototype's version picked bases/
         outs fully at random, independent of the ball event, so it could
         ask you to field "strike three, bases loaded, two outs" with the
         bases actually empty -- nonsensical, and the reported "vague
         question"). Every generator below either uses a situation's own
         set_bases/set_outs when it has one, or only randomizes states a
         situation is actually meant to answer for. */
      const QUIZKINDS = [['mixed', 'Mixed'], ['numbers', 'Numbers'], ['notation', 'Notation'], ['situational', 'Situational']];
      const BASESTATES = ['_', '1', '2', '3', '12', '13', '23', '123'];
      function shuffleInPlace(arr) {
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
        return arr;
      }
      function qzNum(key, def) {
        try { const v = localStorage.getItem('lybs_sitquiz_' + key); return v == null ? def : +v; } catch (e) { return def; }
      }
      function qzSave() {
        try {
          localStorage.setItem('lybs_sitquiz_right', QZ.right);
          localStorage.setItem('lybs_sitquiz_total', QZ.total);
          localStorage.setItem('lybs_sitquiz_streak', QZ.streak);
        } catch (e) { /* private browsing or storage blocked -- quiz still works, just doesn't remember the score */ }
      }
      let QZ = { kind: 'mixed', cur: null, right: qzNum('right', 0), total: qzNum('total', 0), streak: qzNum('streak', 0) };

      function makeNumberQ() {
        const p = POSLIST[Math.floor(Math.random() * POSLIST.length)];
        const askByNumber = Math.random() < 0.5;
        if (askByNumber) {
          const choices = shuffleInPlace([p, ...shuffleInPlace(POSLIST.filter(x => x !== p)).slice(0, 3)]);
          return {
            kindLabel: 'Numbers', prompt: `Which position wears #${POSN[p]}?`, sub: null,
            options: choices.map(c => ({ label: POSFULL[c], correct: c === p })),
            explain: `#${POSN[p]} is the ${POSFULL[p]}.`, answered: false, picked: null,
          };
        }
        const otherNums = shuffleInPlace(POSLIST.map(x => POSN[x]).filter(n => n !== POSN[p])).slice(0, 3);
        const choices = shuffleInPlace([POSN[p], ...otherNums]);
        return {
          kindLabel: 'Numbers', prompt: `What number does the ${POSFULL[p]} wear?`, sub: null,
          options: choices.map(c => ({ label: '#' + c, correct: c === POSN[p] })),
          explain: `The ${POSFULL[p]} is #${POSN[p]}.`, answered: false, picked: null,
        };
      }

      // Every situation x base/out state that actually produces a multi-
      // player throw chain (a real "X-Y-Z" play) -- built once, lazily,
      // not on module load, since most sessions never open the quiz.
      let chainPool = null;
      function getChainPool() {
        if (chainPool) return chainPool;
        chainPool = [];
        SITS.forEach(sit => {
          const baseStates = sit.set_bases ? [sit.set_bases] : BASESTATES;
          const outStates = (sit.set_outs !== '' && sit.set_outs != null) ? [+sit.set_outs] : [0, 1, 2];
          baseStates.forEach(b => outStates.forEach(o => {
            const chain = computeChain(sit.ball_id, b, o);
            if (chain) chainPool.push({ sit, bases: b, outs: o, chain });
          }));
        });
        return chainPool;
      }
      function posByNum(n) { return POSLIST.find(p => POSN[p] === n); }
      function notationDistractors(correct) {
        const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const variants = new Set();
        variants.add(correct.slice().reverse().join('-'));
        if (correct.length >= 2) { const c = correct.slice();[c[0], c[1]] = [c[1], c[0]]; variants.add(c.join('-')); }
        for (let tries = 0; tries < 8 && variants.size < 3; tries++) {
          const c = correct.slice(); const idx = Math.floor(Math.random() * c.length);
          const pool = nums.filter(n => !c.includes(n));
          c[idx] = pool[Math.floor(Math.random() * pool.length)];
          const s = c.join('-'); if (s !== correct.join('-')) variants.add(s);
        }
        return [...variants].slice(0, 3);
      }
      function makeNotationQ() {
        const pool = getChainPool();
        if (!pool.length) return null;
        const { sit, bases, outs, chain } = pool[Math.floor(Math.random() * pool.length)];
        const notation = chain.join('-');
        const subLine = `From: ${sit.label} -- ${basesLabel(bases)}, ${outs} out${outs === 1 ? '' : 's'}.`;
        if (Math.random() < 0.5) {
          const words = chain.map(n => POSFULL[posByNum(n)]).join(' to ');
          const choices = shuffleInPlace([notation, ...notationDistractors(chain)]);
          return {
            kindLabel: 'Scoring notation', prompt: `What do you call it when the ball goes ${words}?`, sub: subLine,
            options: choices.map(c => ({ label: c, correct: c === notation })),
            explain: `${notation} -- ${words}.`, answered: false, picked: null,
          };
        }
        const starter = posByNum(chain[0]);
        const choices = shuffleInPlace([starter, ...shuffleInPlace(POSLIST.filter(p => p !== starter)).slice(0, 3)]);
        return {
          kindLabel: 'Scoring notation', prompt: `On a ${notation}, who starts the play?`, sub: subLine,
          options: choices.map(c => ({ label: POSFULL[c], correct: c === starter })),
          explain: `${notation} starts with #${chain[0]}, the ${POSFULL[starter]}.`, answered: false, picked: null,
        };
      }

      function makeSituationalQ() {
        const sit = SITS[Math.floor(Math.random() * SITS.length)];
        const bases = sit.set_bases || BASESTATES[Math.floor(Math.random() * BASESTATES.length)];
        const outs = (sit.set_outs !== '' && sit.set_outs != null) ? +sit.set_outs : Math.floor(Math.random() * 3);
        const assign = resolve(sit.ball_id, bases, outs, false);
        const p = POSLIST[Math.floor(Math.random() * POSLIST.length)];
        const label = (role, cue) => `${(ROLES[role] || { t: role }).t} -- ${cue || 'Hold your spot.'}`;
        const correctLabel = label(assign[p].role, assign[p].cue);
        const seen = new Set([correctLabel]); const distractors = [];
        shuffleInPlace(POSLIST.filter(x => x !== p)).forEach(x => {
          if (distractors.length >= 3) return;
          const l = label(assign[x].role, assign[x].cue);
          if (seen.has(l)) return;
          seen.add(l); distractors.push(l);
        });
        while (distractors.length < 3) distractors.push('Hold your spot and watch the ball.');
        const choices = shuffleInPlace([correctLabel, ...distractors]);
        return {
          kindLabel: 'Situational', prompt: `${sit.label} -- ${basesLabel(bases)}, ${outs} out${outs === 1 ? '' : 's'}.`,
          sub: `You're the ${POSFULL[p]} (#${POSN[p]}). What do you do?`,
          options: choices.map(c => ({ label: c, correct: c === correctLabel })),
          explain: correctLabel, answered: false, picked: null,
        };
      }

      function makeQuestion() {
        let kind = QZ.kind === 'mixed' ? ['numbers', 'notation', 'situational'][Math.floor(Math.random() * 3)] : QZ.kind;
        if (kind === 'numbers') return makeNumberQ();
        if (kind === 'notation') return makeNotationQ() || makeNumberQ();
        return makeSituationalQ();
      }
      function answerQuiz(i) {
        const q = QZ.cur; if (!q || q.answered) return;
        q.answered = true; q.picked = i;
        const ok = q.options[i].correct;
        QZ.total++; if (ok) { QZ.right++; QZ.streak++; } else QZ.streak = 0;
        qzSave(); renderQuiz();
      }
      function renderQuiz() {
        const host = containerEl.querySelector('#sitQuizHost'); if (!host) return;
        if (!QZ.cur) QZ.cur = makeQuestion();
        const q = QZ.cur;
        host.innerHTML = `
          <div class="sitBoard">
            <div><div class="sitLbl">SCORE</div><div class="situationsCond" style="font-size:20px">${QZ.right}/${QZ.total}</div></div>
            <div><div class="sitLbl">STREAK</div><div class="situationsCond" style="font-size:20px;color:var(--sit-amber)">${QZ.streak}</div></div>
            <div class="sitGrow"></div>
            <div class="sitChips" id="sitQuizKind">${QUIZKINDS.map(([k, l]) =>
              `<button class="sitChip${QZ.kind === k ? ' on' : ''}" data-qkind="${k}">${escapeHtml(l)}</button>`).join('')}</div>
          </div>
          <div class="sitCard">
            <div class="sitLbl">${escapeHtml(q.kindLabel)}</div>
            <div class="sitQuizPrompt situationsCond">${escapeHtml(q.prompt)}</div>
            ${q.sub ? `<div class="sitMuted" style="margin-top:4px">${escapeHtml(q.sub)}</div>` : ''}
          </div>
          <div class="sitQuizOpts">${q.options.map((o, i) => {
            let cls = 'sitQuizOpt';
            if (q.answered) cls += o.correct ? ' sitQuizOptCorrect' : (i === q.picked ? ' sitQuizOptWrong' : '');
            return `<button class="${cls}" data-qopt="${i}"${q.answered ? ' disabled' : ''}>${escapeHtml(o.label)}</button>`;
          }).join('')}</div>
          ${q.answered ? `<div class="sitQuizFb ${q.options[q.picked].correct ? 'sitQuizGood' : 'sitQuizBad'}">
            <b class="situationsCond" style="font-size:16px">${q.options[q.picked].correct ? "That's it." : 'Not quite.'}</b>
            <div style="margin-top:4px">${escapeHtml(q.explain)}</div>
          </div>` : ''}
          <div class="sitPlaybar" style="display:${q.answered ? 'flex' : 'none'}">
            <button class="sitPrimary" id="sitQuizNext">Next question</button>
          </div>`;
      }

      containerEl.innerHTML = `
        <div class="situationsRoot">
          <div class="sectionHeader">
            <div class="recordLine">Where do I go?</div>
            <button class="btn btnGhost btnSmall sitInfoBtn" id="sitFundamentalsBtn">Fundamentals</button>
          </div>

          <div class="sitViewToggle">
            <button class="on" data-view="builder">Builder</button>
            <button data-view="quiz">Quiz</button>
          </div>

          <div id="sitBuilderView">
          <div class="sitBoard">
            <div>
              <div class="sitLbl">RUNNERS</div>
              <div class="sitDiamond">
                <button class="sitDiamond1" data-base="1" aria-label="Runner on first" aria-pressed="false"></button>
                <button class="sitDiamond2" data-base="2" aria-label="Runner on second" aria-pressed="false"></button>
                <button class="sitDiamond3" data-base="3" aria-label="Runner on third" aria-pressed="false"></button>
              </div>
            </div>
            <div>
              <div class="sitLbl">OUTS</div>
              <div class="sitOuts" id="sitOutsBox">
                <button data-out="0" aria-label="0 outs"></button>
                <button data-out="1" aria-label="1 out"></button>
                <button data-out="2" aria-label="2 outs"></button>
              </div>
            </div>
            <div class="sitGrow"></div>
            <button class="sitPill" id="sitInfIn" aria-pressed="false">Infield in</button>
          </div>

          <div class="sitFieldwrap">
            <svg class="sitFieldSvg" id="sitSvg" viewBox="-46 44 612 490" role="img" aria-label="Baseball field with player movement"></svg>
            <div class="sitHint" id="sitFieldHint">Tap the field to hit it there</div>
          </div>

          <div class="sitChips" id="sitTypeChips" style="margin:9px 0 2px"></div>

          <div class="sitPlaybar">
            <button class="sitPrimary" id="sitBtnRun">Run the play</button>
            <button id="sitBtnPick">Pick the ball</button>
          </div>

          <div class="sitTransport">
            <button id="sitBtnPP">Play</button>
            <input type="range" id="sitScrub" min="0" max="1000" value="0" aria-label="Scrub through the play">
            <span id="sitClock">0.0s</span>
            <button class="sitPill" id="sitBtnSlow" aria-pressed="false">Slow</button>
          </div>
          <div class="sitCalls" id="sitCallBox"></div>

          <div id="sitPickBox" style="display:none"></div>

          <div class="sitCard" style="padding:11px 12px">
            <div class="sitLbl situationsCond" style="font-size:11px;letter-spacing:.14em;">I AM PLAYING</div>
            <div class="sitChips" id="sitMeChips"></div>
          </div>

          <div id="sitBigJobBox"></div>
          <div class="sitJobs" id="sitJobs"></div>
          <div class="sitCard sitMuted" id="sitTeachBox" style="display:none"></div>
          </div>

          <div id="sitQuizView" style="display:none">
            <div id="sitQuizHost"></div>
          </div>
        </div>`;

      containerEl.querySelectorAll('.sitDiamond button').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.base; const s = new Set(S.bases === '_' ? [] : S.bases.split(''));
        s.has(k) ? s.delete(k) : s.add(k);
        S.bases = [...s].sort().join('') || '_';
        syncDiamond(); drawPlay();
      }));
      containerEl.querySelector('#sitOutsBox').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        S.outs = (S.outs === +b.dataset.out + 1) ? +b.dataset.out : +b.dataset.out + 1;
        if (S.outs > 2) S.outs = 2;
        syncOuts(); drawPlay();
      });
      containerEl.querySelector('#sitInfIn').addEventListener('click', e => {
        S.infIn = !S.infIn; e.target.classList.toggle('on', S.infIn); e.target.setAttribute('aria-pressed', S.infIn); drawPlay();
      });
      containerEl.querySelector('#sitBtnRun').addEventListener('click', runPlay);
      containerEl.querySelector('#sitBtnPP').addEventListener('click', () => {
        if (!PLAN) drawPlay();
        if (PLAYING) { stopPlay(); return; }
        if (PT >= PLAN.duration) PT = 0;
        PLAYING = true; lastNow = performance.now(); setPP();
        if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
      });
      containerEl.querySelector('#sitScrub').addEventListener('input', e => {
        if (!PLAN) drawPlay();
        stopPlay(); PT = (+e.target.value) / 1000 * PLAN.duration; renderAt(PLAN, PT);
      });
      containerEl.querySelector('#sitBtnSlow').addEventListener('click', e => {
        RATE = (RATE === 1) ? .35 : 1;
        e.target.classList.toggle('on', RATE !== 1);
        e.target.setAttribute('aria-pressed', RATE !== 1 ? 'true' : 'false');
      });
      containerEl.querySelector('#sitBtnPick').addEventListener('click', () => {
        const b = containerEl.querySelector('#sitPickBox');
        b.style.display = b.style.display === 'none' ? 'block' : 'none';
      });
      containerEl.querySelector('#sitPickBox').addEventListener('click', e => {
        const c = e.target.closest('[data-sit]'); if (!c) return;
        setSituation(c.dataset.sit); containerEl.querySelector('#sitPickBox').style.display = 'none';
        containerEl.querySelector('#sitSvg').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      containerEl.querySelector('#sitSvg').addEventListener('click', e => {
        const g = e.target.closest('.sitPlayer');
        if (g) { S.me = (S.me === g.dataset.pos) ? null : g.dataset.pos; buildMeChips(); drawPlay(); return; }
        const [x, y] = svgPoint(containerEl.querySelector('#sitSvg'), e);
        const hit = nearestSituation(x, y); if (!hit) return;
        setSituation(hit.ball_id); runPlay();
      });
      containerEl.querySelector('#sitTypeChips').addEventListener('click', e => {
        const c = e.target.closest('[data-tt]'); if (!c) return;
        S.tapType = c.dataset.tt; buildTypeChips();
        const cur = sitById(S.ball);
        const hit = nearestSituation(+cur.ball_x, +cur.ball_y);
        if (hit && hit.ball_id !== S.ball) { setSituation(hit.ball_id); runPlay(); }
      });
      containerEl.querySelector('#sitMeChips').addEventListener('click', e => {
        const c = e.target.closest('[data-me]'); if (!c) return;
        S.me = c.dataset.me || null; buildMeChips(); drawPlay();
      });
      containerEl.querySelector('#sitFundamentalsBtn').addEventListener('click', () => {
        window.openInfoModal('Fundamentals', fundamentalsHtml());
      });

      containerEl.querySelector('.sitViewToggle').addEventListener('click', e => {
        const b = e.target.closest('[data-view]'); if (!b) return;
        const quiz = b.dataset.view === 'quiz';
        containerEl.querySelectorAll('.sitViewToggle button').forEach(x => x.classList.toggle('on', x === b));
        containerEl.querySelector('#sitBuilderView').style.display = quiz ? 'none' : '';
        containerEl.querySelector('#sitQuizView').style.display = quiz ? '' : 'none';
        if (quiz) renderQuiz();
      });
      // Delegated on the host (not re-bound per render) since renderQuiz()
      // replaces this whole subtree's innerHTML on every answer/question --
      // binding inside renderQuiz() itself would stack a new listener each
      // time instead of reusing one, the same reason buildPicker()'s click
      // handling lives out here rather than inside buildPicker().
      containerEl.querySelector('#sitQuizHost').addEventListener('click', e => {
        const opt = e.target.closest('[data-qopt]'); if (opt) { answerQuiz(+opt.dataset.qopt); return; }
        const next = e.target.closest('#sitQuizNext'); if (next) { QZ.cur = makeQuestion(); renderQuiz(); return; }
        const kind = e.target.closest('[data-qkind]');
        if (kind) { QZ.kind = kind.dataset.qkind; QZ.cur = makeQuestion(); renderQuiz(); }
      });

      function fundamentalsHtml() {
        const legend = Object.keys(ROLES).map(r =>
          `<div class="sitLegendRow"><span class="sitLegendDot" style="background:${ROLES[r].c}"></span><b class="situationsCond" style="font-size:15px">${escapeHtml(ROLES[r].t)}</b></div>`).join('');
        return `<div class="situationsRoot sitFundamentals">
          <h3>Five rules that cover almost everything</h3>
          <div class="sitCard"><b style="font-size:15px">1. Nobody stands still.</b><br>On every batted ball you are fielding it, covering a base, cutting a throw, or backing up a throw. If you can't say which one, you're wrong.</div>
          <div class="sitCard"><b style="font-size:15px">2. Throws to second: ball side goes out.</b><br>Ball to left field, shortstop goes out for the relay and the second baseman covers. Ball to right field, they swap.</div>
          <div class="sitCard"><b style="font-size:15px">3. Throws to third: shortstop is the cut.</b><br>Every time, from anywhere. The third baseman stays on the bag.</div>
          <div class="sitCard"><b style="font-size:15px">4. Throws home: left field, third baseman cuts. Center or right, first baseman cuts.</b><br>The catcher is the only one who can see the runner, so the catcher makes the call: "Cut!" or "Let it go!"</div>
          <div class="sitCard"><b style="font-size:15px">5. The pitcher backs up one base, not two.</b><br>Third or home -- pick the one the ball is going to and get deep behind it.</div>
          <h3>Every position has a number</h3>
          <div class="sitCard">Scorebooks and cut calls use the number, not the name -- "6-4-3" means short to second to first. Every number on the field matches the ones on your own jersey list.</div>
          <div class="sitCard"><table>
            <tr><th>#</th><th>Position</th></tr>
            ${POSLIST.map(p => `<tr><td><b style="color:var(--sit-amber)">${POSN[p]}</b></td><td>${escapeHtml(POSFULL[p])} (${p})</td></tr>`).join('')}
          </table></div>
          <h3>Infield fly</h3>
          <div class="sitCard">Runners on first and second, or bases loaded, with fewer than two outs, and an infielder can catch a fair pop with ordinary effort -- the umpire calls the batter out on the spot. Nobody is forced anymore. So catch it, and if you drop it, do not go running to a base looking for a force that isn't there.</div>
          <h3>When the batter can run on strike three</h3>
          <div class="sitCard"><table>
            <tr><th>Situation</th><th>Batter</th></tr>
            <tr><td>First base empty</td><td style="color:var(--sit-lime)">Can run</td></tr>
            <tr><td>Two outs, any runners</td><td style="color:var(--sit-lime)">Can run</td></tr>
            <tr><td>Runner on first, fewer than two outs</td><td style="color:var(--sit-rose)">Just out -- stay home</td></tr>
          </table></div>
          <h3>Cut numbers</h3>
          <div class="sitCard">The catcher yells a number and everybody knows what it means. "Cut" on its own means cut it and hold the ball.</div>
          <div class="sitCard"><table>
            <tr><th>Call</th><th>Means</th></tr>
            <tr><td><b style="color:var(--sit-cyan)">Cut 2</b></td><td>Cut it and throw to second</td></tr>
            <tr><td><b style="color:var(--sit-cyan)">Cut 3</b></td><td>Cut it and throw to third</td></tr>
            <tr><td><b style="color:var(--sit-cyan)">Cut 4</b></td><td>Cut it and throw home</td></tr>
            <tr><td><b style="color:var(--sit-mute)">Let it go</b></td><td>Duck. Ball goes through untouched</td></tr>
          </table></div>
          <h3>Who is the cut man</h3>
          <div class="sitCard"><table>
            <tr><th>Throw going to</th><th>From left</th><th>From center</th><th>From right</th></tr>
            <tr><td>Second</td><td>SS</td><td>SS or 2B</td><td>2B</td></tr>
            <tr><td>Third</td><td>SS</td><td>SS</td><td>SS</td></tr>
            <tr><td>Home</td><td>3B</td><td>1B</td><td>1B</td></tr>
          </table></div>
          <h3>What the colors mean</h3>
          <div class="sitCard">${legend}</div>
        </div>`;
      }

      buildPicker(); buildMeChips(); buildTypeChips(); drawPlay();
    },
  };
})();
