/* ============================================================
   Base-running stopwatch -- a new tool, not a port. lybs-reporting
   only has a generic stopwatch (start/stop/lap, no base presets, no
   per-player history by drill) -- this is the real thing: pick a
   drill (home to 1st/2nd/3rd, or all the way around), optionally pick
   a runner (a roster player, or a free-typed name -- same `free_` id
   pattern js/drill-ath.js's own free-player chips use), time them,
   and build up every player's times across drills so a coach can see
   who's eligible-fast at a glance, same spirit as the Around the Horn
   timer but for one runner instead of a team relay.

   Picking a runner is deliberately NOT required to start the clock --
   a coach lining kids up at home plate wants to start timing the
   instant one takes off, not hunt through a roster list first. A run
   saved with no runner picked is stored under playerId: null, name:
   "Unassigned" rather than blocked or discarded; it still counts
   toward that drill's team-best time, just not toward any one
   player's own history.

   Every recorded run is stored flat at
   teams/{teamId}/drills/baseRunningRuns = [{id, playerId, name,
   drillType, timeMs, date}], so a leaderboard per drill (fastest
   time per player) and a player's own history are both just views
   over the same list, not separate state to keep in sync.
   ============================================================ */
(function () {
  const GOLD = '#e8edf5', GREEN = '#10b981';
  const DRILLS = [
    { id: 'home1b', label: 'Home to 1st' },
    { id: 'home2b', label: 'Home to 2nd' },
    { id: 'home3b', label: 'Home to 3rd' },
    { id: 'homehome', label: 'Around the Bases' },
  ];

  function fmt(ms) {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    return m ? m + ':' + sec.padStart(5, '0') : sec + 's';
  }
  function fmtShort(ms) { return (ms / 1000).toFixed(2) + 's'; }

  function confetti(duration) {
    duration = duration || 2600;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#f5a623', '#10b981', '#4C6AEB', '#ef4444', '#fff'];
    const pieces = Array.from({ length: 90 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * 200, w: 7 + Math.random() * 7, h: 4 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * 360,
      vx: (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 4, vr: (Math.random() - 0.5) * 8,
    }));
    const end = performance.now() + duration;
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      pieces.forEach(p => {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (end - now) / duration * 3);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y > H) { p.y = -20; p.x = Math.random() * W; }
      });
      if (now < end) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
  }
  function showBanner(text, sub) {
    document.getElementById('athBanner')?.remove();
    const div = document.createElement('div');
    div.id = 'athBanner';
    div.className = 'athBanner';
    div.innerHTML = `<div class="athBannerTitle">${text}</div><div class="athBannerSub">${escapeHtml(sub)}</div>`;
    document.body.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    setTimeout(() => { div.classList.remove('show'); setTimeout(() => div.remove(), 400); }, 2400);
  }

  const cache = {}; // teamId -> runs[]
  const pending = {}; // teamId -> in-flight ensureRuns() promise

  // Caches the in-flight fetch, not just the resolved value -- same
  // reason as js/roster.js's ensureLoaded(): without this, switching
  // Coaching sub-tabs away and back before the first dbGet resolves
  // starts a second one, and whichever resolves last clobbers
  // cache[teamId] with its own snapshot, silently reverting a run saved
  // in between.
  async function ensureRuns(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const data = await window.dbGet(window.teamPath(teamId, 'drills/baseRunningRuns'));
        cache[teamId] = Array.isArray(data) ? data : [];
        return cache[teamId];
      } finally {
        delete pending[teamId];
      }
    })();
    return pending[teamId];
  }
  async function saveRuns(teamId) {
    await window.dbPut(window.teamPath(teamId, 'drills/baseRunningRuns'), cache[teamId]);
  }
  function bestFor(runs, playerId, drillType) {
    const mine = runs.filter(r => r.playerId === playerId && r.drillType === drillType);
    return mine.length ? Math.min(...mine.map(r => r.timeMs)) : null;
  }
  function drillBest(runs, drillType) {
    const times = runs.filter(r => r.drillType === drillType).map(r => r.timeMs);
    return times.length ? Math.min(...times) : null;
  }

  const ST = { state: 'setup', drillType: DRILLS[0].id, playerId: null, playerName: null, startTs: 0, elapsedMs: 0, raf: null, justSaved: false, newRecord: false };

  window.DrillBaseRunning = {
    async render(containerEl, teamId) {
      const runs = await ensureRuns(teamId);
      const roster = window.Roster.getPlayers(teamId);

      function refresh() {
        containerEl.innerHTML = ST.state === 'setup' ? setupHtml() : timerHtml();
        wire();
      }

      function setupHtml() {
        return `
          <div class="drillHero">
            <div class="drillHeroTitle">Base Running</div>
            <div class="drillHeroSub">Time any runner, home to 1st or all the way around -- picking a name is optional.</div>
          </div>
          <div class="sectionLabel">Drill</div>
          <div class="drillChipRow">
            ${DRILLS.map(d => `<button class="drillChip ${ST.drillType === d.id ? 'drillChipOn' : ''}" data-drill="${d.id}">${d.label}</button>`).join('')}
          </div>
          <div class="sectionLabel" style="margin-top:16px;">Runner (optional)</div>
          <div class="drillChipRow">
            ${ST.playerId && ST.playerId.startsWith('free_') ? `<span class="drillChip drillChipOn" data-removefree>${escapeHtml(ST.playerName)} &times;</span>` : ''}
            ${roster.length ? roster.map(p => `<button class="drillChip ${ST.playerId === p.id ? 'drillChipOn' : ''}" data-player="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join('') : '<span class="helpText">No players on the roster yet.</span>'}
          </div>
          <div class="drillAddRow">
            <input class="drillFreeInput" id="brFreeName" list="brRosterList" placeholder="Add a name...">
            <button class="btn btnGhost btnSmall" id="brAddFree">Add</button>
          </div>
          <datalist id="brRosterList">${roster.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>
          <button class="btn" id="brStart" style="width:100%;margin-top:18px;">Start timing →</button>
          <div class="sectionLabel" style="margin-top:20px;">Team best &mdash; ${escapeHtml(DRILLS.find(d => d.id === ST.drillType).label)}</div>
          ${leaderboardHtml(ST.drillType)}`;
      }

      function leaderboardHtml(drillType) {
        const bests = {};
        runs.filter(r => r.drillType === drillType).forEach(r => {
          if (!bests[r.playerId] || r.timeMs < bests[r.playerId].timeMs) bests[r.playerId] = { name: r.name, timeMs: r.timeMs, date: r.date };
        });
        const rows = Object.values(bests).sort((a, b) => a.timeMs - b.timeMs);
        if (!rows.length) return '<div class="emptyState">No times logged yet for this drill.</div>';
        return `<div class="listBody">${rows.map((r, i) => `
          <div class="listRow athBoardRow" style="cursor:default;">
            <div class="athBoardMedal">#${i + 1}</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(r.name)}</div>
              <div class="listRowSub">${escapeHtml(r.date)}</div>
            </div>
            <div class="athBoardTime">${fmtShort(r.timeMs)}</div>
          </div>`).join('')}</div>`;
      }

      function timerHtml() {
        const s = ST.state;
        const timeStr = ST.elapsedMs ? fmt(ST.elapsedMs) : '0.00s';
        const timeClass = s === 'running' ? 'athTimeRun' : s === 'stopped' ? 'athTimeStop' : s === 'accepted' ? 'athTimeAccept' : '';
        const drillLabel = DRILLS.find(d => d.id === ST.drillType).label;
        const runnerLabel = ST.playerName || 'Unassigned';
        const personalBest = bestFor(runs, ST.playerId, ST.drillType);

        let controls = '';
        if (s === 'idle' || s === 'accepted') {
          controls = `<button class="btn athBigBtn" id="brStartTimer">${s === 'accepted' ? 'GO AGAIN' : 'START'}</button>`;
        } else if (s === 'running') {
          controls = `<button class="btn athBigBtn athStopBtn" id="brStop">STOP</button>`;
        } else if (s === 'stopped') {
          controls = `<div class="athStopRow">
            <button class="btn btnGhost" id="brRedo">↩ Redo</button>
            <button class="btn" id="brAccept">Save</button>
          </div>`;
        }

        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="brChange">&larr; Change</button>
            <div class="recordLine">${escapeHtml(runnerLabel)} &middot; ${escapeHtml(drillLabel)}</div>
          </div>
          <div class="athTimerCard">
            <div class="athTimerDisplay ${timeClass}" id="brTimeEl">${timeStr}</div>
            ${s === 'accepted' ? `<div class="athAcceptNote" style="color:${ST.newRecord ? GOLD : GREEN};">${ST.newRecord ? 'New team best! ' : 'Saved — '}${escapeHtml(runnerLabel)}'s best: ${fmtShort(bestFor(runs, ST.playerId, ST.drillType))}</div>` : ''}
            ${personalBest && s !== 'accepted' ? `<div class="helpText">${escapeHtml(runnerLabel)}'s best: <b style="color:${GOLD};">${fmtShort(personalBest)}</b></div>` : ''}
          </div>
          ${controls}`;
      }

      function wire() {
        containerEl.querySelectorAll('[data-drill]').forEach(btn => {
          btn.addEventListener('click', () => { ST.drillType = btn.dataset.drill; refresh(); });
        });
        containerEl.querySelectorAll('[data-player]').forEach(btn => {
          btn.addEventListener('click', () => { ST.playerId = btn.dataset.player; ST.playerName = btn.dataset.name; refresh(); });
        });
        containerEl.querySelector('#brAddFree')?.addEventListener('click', () => {
          const inp = containerEl.querySelector('#brFreeName');
          const name = inp.value.trim();
          if (!name) return;
          ST.playerId = 'free_' + name.toLowerCase().replace(/\s+/g, '_');
          ST.playerName = name;
          refresh();
        });
        containerEl.querySelector('[data-removefree]')?.addEventListener('click', () => {
          ST.playerId = null; ST.playerName = null;
          refresh();
        });
        containerEl.querySelector('#brStart')?.addEventListener('click', () => {
          ST.state = 'idle'; ST.elapsedMs = 0; ST.newRecord = false;
          refresh();
        });
        containerEl.querySelector('#brChange')?.addEventListener('click', async () => {
          if (ST.state === 'running' && !(await confirmModal('Stop timing and change runner/drill?'))) return;
          cancelAnimationFrame(ST.raf);
          ST.state = 'setup'; ST.elapsedMs = 0;
          refresh();
        });
        containerEl.querySelector('#brStartTimer')?.addEventListener('click', () => {
          ST.startTs = performance.now() - ST.elapsedMs; ST.state = 'running'; ST.newRecord = false;
          refresh();
          (function tick() {
            if (ST.state !== 'running') return;
            ST.elapsedMs = performance.now() - ST.startTs;
            const el = document.getElementById('brTimeEl');
            if (el) el.textContent = fmt(ST.elapsedMs);
            ST.raf = requestAnimationFrame(tick);
          })();
        });
        containerEl.querySelector('#brStop')?.addEventListener('click', () => {
          cancelAnimationFrame(ST.raf);
          ST.elapsedMs = performance.now() - ST.startTs;
          ST.state = 'stopped';
          refresh();
        });
        containerEl.querySelector('#brRedo')?.addEventListener('click', () => { ST.elapsedMs = 0; ST.state = 'idle'; refresh(); });
        containerEl.querySelector('#brAccept')?.addEventListener('click', async btnEvt => {
          // withBusyButton disables the button for the duration of the save
          // -- without it, a double-tap before the first save resolves
          // re-entered this handler and pushed two near-identical run
          // records for the same timed attempt, both persisted.
          await withBusyButton(btnEvt.target, 'Saving...', async () => {
            const prevDrillBest = drillBest(runs, ST.drillType);
            const runnerLabel = ST.playerName || 'Unassigned';
            runs.push({ id: uid('br'), playerId: ST.playerId, name: runnerLabel, drillType: ST.drillType, timeMs: ST.elapsedMs, date: new Date().toISOString().slice(0, 10) });
            await saveRuns(teamId);
            ST.newRecord = prevDrillBest === null || ST.elapsedMs < prevDrillBest;
            ST.state = 'accepted'; ST.elapsedMs = 0;
            if (ST.newRecord) { confetti(); showBanner('New team best!', `${runnerLabel}: ${fmtShort(runs[runs.length - 1].timeMs)}`); }
          });
          refresh();
        });
      }
      refresh();
    },
  };
})();
