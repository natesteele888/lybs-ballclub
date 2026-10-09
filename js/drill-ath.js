/* ============================================================
   Around the Horn timer -- ported from lybs-reporting's
   coaching_tools.js (the league dashboard's per-coach Field Tools),
   adapted from that app's per-user USER_DATA/localStorage bin to
   this app's team-scoped RTDB path (teams/{teamId}/drills/ath),
   and from its EVAL_SESSION player pool to this team's own roster
   (window.Roster). Game mechanics, confetti, and leader-banner are
   kept as close to the original as the different storage/roster
   model allows.

   State machine: setup (pick # of groups) -> assign (tap roster
   players into groups, or free-type a name) -> running (one group
   at a time: start/stop/accept/redo) -> complete (leaderboard-style
   results, post to team leaderboard and/or save the session).
   Coach-only -- see index.html's Coaching tab gating.
   ============================================================ */
(function () {
  const GOLD = '#f5a623', GREEN = '#10b981', RED = '#ef4444';

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

  const cache = {}; // teamId -> leaderboard[]
  const ST = {
    state: 'setup', startTs: 0, elapsedMs: 0, raf: null,
    groups: [], current: 0, sessionBestMs: null, newRecord: false,
  };

  async function ensureLeaderboard(teamId) {
    if (cache[teamId]) return cache[teamId];
    const data = await window.dbGet(window.teamPath(teamId, 'drills/athLeaderboard'));
    cache[teamId] = Array.isArray(data) ? data : [];
    return cache[teamId];
  }
  async function saveLeaderboard(teamId) {
    await window.dbPut(window.teamPath(teamId, 'drills/athLeaderboard'), cache[teamId]);
  }
  function addResult(leaderboard, groupName, timeMs, playerNames) {
    leaderboard.unshift({ id: Date.now() + Math.random(), groupName, timeMs, players: playerNames, date: new Date().toISOString().slice(0, 10) });
    leaderboard.sort((a, b) => a.timeMs - b.timeMs);
    if (leaderboard.length > 100) leaderboard.length = 100;
  }
  function sessionBest() {
    const bests = ST.groups.filter(g => g.bestMs != null).map(g => g.bestMs);
    return bests.length ? Math.min(...bests) : null;
  }

  function initGroups(n) {
    ST.groups = Array.from({ length: n }, (_, i) => ({ name: 'Group ' + (i + 1), attempts: [], bestMs: null, players: [] }));
    ST.current = 0; ST.state = 'assign'; ST.elapsedMs = 0; ST.sessionBestMs = null; ST.newRecord = false;
  }

  window.DrillATH = {
    async render(containerEl, teamId) {
      const leaderboard = await ensureLeaderboard(teamId);
      const roster = window.Roster.getPlayers(teamId);

      function refresh() {
        containerEl.innerHTML = ST.state === 'setup' ? setupHtml()
          : ST.state === 'assign' ? assignHtml()
          : ST.state === 'complete' ? completeHtml()
          : mainHtml();
        wire();
      }

      function setupHtml() {
        return `
          <div class="drillHero">
            <div class="drillHeroIcon">⚾</div>
            <div class="drillHeroTitle">Around the Horn</div>
            <div class="drillHeroSub">Time how fast each group throws around the infield.</div>
          </div>
          <div class="sectionLabel" style="text-align:center;">Number of groups</div>
          <div class="athGroupPicker">
            ${[1, 2, 3, 4, 5, 6].map(n => `<button class="athGroupBtn" data-n="${n}">${n}</button>`).join('')}
          </div>
          <div class="sectionLabel" style="margin-top:22px;">Leaderboard</div>
          ${leaderboardHtml()}`;
      }

      function leaderboardHtml() {
        if (!leaderboard.length) return '<div class="emptyState">No times posted yet.</div>';
        const medals = ['🥇', '🥈', '🥉'];
        return `<div class="listBody">${leaderboard.slice(0, 20).map((e, i) => `
          <div class="listRow athBoardRow" style="cursor:default;">
            <div class="athBoardMedal">${medals[i] || '#' + (i + 1)}</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(e.groupName)}</div>
              <div class="listRowSub">${(e.players || []).map(escapeHtml).join(', ')}${e.date ? ' · ' + escapeHtml(e.date) : ''}</div>
            </div>
            <div class="athBoardTime">${fmtShort(e.timeMs)}</div>
          </div>`).join('')}</div>`;
      }

      function assignHtml() {
        const allAssigned = new Set(ST.groups.flatMap(g => g.players.map(p => p.id)));
        const groupsHtml = ST.groups.map((g, gi) => `
          <div class="drillCard">
            <div class="drillCardHeader">
              <div class="drillCardTitle">${escapeHtml(g.name)}</div>
              <button class="btn btnGhost btnTiny" data-rename="${gi}">Rename</button>
            </div>
            ${g.players.filter(p => p.id.startsWith('free_')).length ? `
            <div class="drillChipRow" style="margin-bottom:8px;">
              ${g.players.filter(p => p.id.startsWith('free_')).map(p => `
                <span class="drillChip drillChipOn" data-removefree="${gi}" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)} &times;</span>`).join('')}
            </div>` : ''}
            <div class="drillChipRow">
              ${roster.map(p => {
                const inThis = g.players.some(x => x.id === p.id);
                const inOther = !inThis && allAssigned.has(p.id);
                return `<button class="drillChip ${inThis ? 'drillChipOn' : ''}" ${inOther ? 'disabled' : ''} data-toggle="${gi}" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`;
              }).join('') || '<span class="helpText">No players on the roster yet — add names below.</span>'}
            </div>
            <div class="drillAddRow">
              <input class="drillFreeInput" id="athFree${gi}" placeholder="Add a name...">
              <button class="btn btnGhost btnSmall" data-addfree="${gi}">Add</button>
            </div>
          </div>`).join('');
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="athBack">&larr; Back</button>
            <div class="recordLine">Assign players</div>
          </div>
          ${groupsHtml}
          <button class="btn" id="athProceed" style="width:100%;margin-top:6px;">Start &rarr;</button>`;
      }

      function mainHtml() {
        const g = ST.groups[ST.current];
        const s = ST.state;
        const timeStr = ST.elapsedMs ? fmt(ST.elapsedMs) : '0.00s';
        const timeClass = s === 'running' ? 'athTimeRun' : s === 'stopped' ? 'athTimeStop' : s === 'accepted' ? 'athTimeAccept' : '';
        const pills = ST.groups.map((gr, i) => {
          const cls = i < ST.current ? 'athPillDone' : i === ST.current ? 'athPillCur' : 'athPillWait';
          return `<span class="athPill ${cls}">${escapeHtml(gr.name)}: ${gr.bestMs ? fmtShort(gr.bestMs) : (i === ST.current ? '●' : '—')}</span>`;
        }).join('');
        const best = sessionBest();
        const bestHolder = best ? ST.groups.find(gr => gr.bestMs === best) : null;
        let controls = '';
        if (s === 'idle' || s === 'accepted') {
          controls = `<button class="btn athBigBtn" id="athStart">${s === 'accepted' ? 'GO AGAIN' : 'START'}</button>
            ${g.attempts.length ? `<button class="btn btnGhost" id="athNext" style="width:100%;margin-top:10px;">${ST.current < ST.groups.length - 1 ? 'Next group →' : 'Finish ✓'}</button>` : ''}`;
        } else if (s === 'running') {
          controls = `<button class="btn athBigBtn athStopBtn" id="athStop">STOP</button>`;
        } else if (s === 'stopped') {
          controls = `<div class="athStopRow">
            <button class="btn btnGhost" id="athRedo">↩ Redo</button>
            <button class="btn" id="athAccept">✓ Accept</button>
          </div>`;
        }
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="athCancel">&larr; Cancel</button>
            <div class="recordLine">${escapeHtml(g.name)} (${ST.current + 1}/${ST.groups.length}) &middot; ${g.attempts.length} attempt${g.attempts.length === 1 ? '' : 's'}</div>
          </div>
          <div class="athPillRow">${pills}</div>
          <div class="athTimerCard">
            <div class="athTimerDisplay ${timeClass}" id="athTimeEl">${timeStr}</div>
            ${s === 'accepted' ? `<div class="athAcceptNote" style="color:${ST.newRecord ? GOLD : GREEN};">${ST.newRecord ? '🏆 New leader! ' : '✓ Saved — '}best: ${fmtShort(g.bestMs)}</div>` : ''}
            ${best ? `<div class="helpText">Best so far: <b style="color:${GOLD};">${fmtShort(best)}</b>${bestHolder ? ' (' + escapeHtml(bestHolder.name) + ')' : ''}</div>` : ''}
          </div>
          ${controls}`;
      }

      function completeHtml() {
        const sorted = [...ST.groups].sort((a, b) => (a.bestMs || Infinity) - (b.bestMs || Infinity));
        const medals = ['🥇', '🥈', '🥉'];
        const rows = sorted.map((g, i) => `
          <div class="listRow athBoardRow" style="cursor:default;">
            <div class="athBoardMedal">${medals[i] || ''}</div>
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(g.name)}</div>
              <div class="listRowSub">${g.attempts.map(fmtShort).join(' · ') || 'No attempts'}${g.players.length ? ' · ' + g.players.map(p => escapeHtml(p.name)).join(', ') : ''}</div>
            </div>
            <div class="athBoardTime">${g.bestMs ? fmtShort(g.bestMs) : '—'}</div>
          </div>`).join('');
        return `
          <div class="drillHero">
            <div class="drillHeroIcon">🏁</div>
            <div class="drillHeroTitle">Session complete</div>
            <div class="drillHeroSub">${ST.groups.length} groups &middot; ${ST.groups.reduce((s, g) => s + g.attempts.length, 0)} total attempts</div>
          </div>
          <div class="listBody">${rows}</div>
          <button class="btn" id="athPost" style="width:100%;margin-top:14px;">🏆 Post to leaderboard</button>
          <button class="btn btnGhost" id="athReset" style="width:100%;margin-top:8px;">New session</button>`;
      }

      function wire() {
        const back = () => { ST.state = 'setup'; ST.elapsedMs = 0; refresh(); };
        containerEl.querySelector('#athBack')?.addEventListener('click', back);
        containerEl.querySelector('#athCancel')?.addEventListener('click', () => {
          if (!ST.groups.some(g => g.attempts.length) || confirm('Cancel this session?')) back();
        });
        containerEl.querySelectorAll('.athGroupBtn').forEach(btn => {
          btn.addEventListener('click', () => { initGroups(Number(btn.dataset.n)); refresh(); });
        });
        containerEl.querySelectorAll('[data-toggle]').forEach(btn => {
          btn.addEventListener('click', () => {
            const gi = Number(btn.dataset.toggle), id = btn.dataset.id, name = btn.dataset.name;
            ST.groups.forEach(g => { g.players = g.players.filter(p => p.id !== id); });
            const g = ST.groups[gi];
            if (!g.players.some(p => p.id === id)) g.players.push({ id, name });
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-rename]').forEach(btn => {
          btn.addEventListener('click', () => {
            const gi = Number(btn.dataset.rename);
            const name = prompt('Rename group:', ST.groups[gi].name);
            if (name && name.trim()) { ST.groups[gi].name = name.trim(); refresh(); }
          });
        });
        containerEl.querySelectorAll('[data-removefree]').forEach(btn => {
          btn.addEventListener('click', () => {
            const gi = Number(btn.dataset.removefree), id = btn.dataset.id;
            ST.groups[gi].players = ST.groups[gi].players.filter(p => p.id !== id);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-addfree]').forEach(btn => {
          btn.addEventListener('click', () => {
            const gi = Number(btn.dataset.addfree);
            const inp = containerEl.querySelector(`#athFree${gi}`);
            const name = inp.value.trim();
            if (!name) return;
            const id = 'free_' + name.toLowerCase().replace(/\s+/g, '_');
            ST.groups.forEach(g => { g.players = g.players.filter(p => p.id !== id); });
            ST.groups[gi].players.push({ id, name });
            refresh();
          });
        });
        containerEl.querySelector('#athProceed')?.addEventListener('click', () => { ST.state = 'idle'; refresh(); });
        containerEl.querySelector('#athStart')?.addEventListener('click', () => {
          ST.startTs = performance.now() - ST.elapsedMs; ST.state = 'running'; ST.newRecord = false;
          refresh();
          (function tick() {
            if (ST.state !== 'running') return;
            ST.elapsedMs = performance.now() - ST.startTs;
            const el = document.getElementById('athTimeEl');
            if (el) el.textContent = fmt(ST.elapsedMs);
            ST.raf = requestAnimationFrame(tick);
          })();
        });
        containerEl.querySelector('#athStop')?.addEventListener('click', () => {
          cancelAnimationFrame(ST.raf);
          ST.elapsedMs = performance.now() - ST.startTs;
          ST.state = 'stopped';
          refresh();
        });
        containerEl.querySelector('#athRedo')?.addEventListener('click', () => { ST.elapsedMs = 0; ST.state = 'idle'; refresh(); });
        containerEl.querySelector('#athAccept')?.addEventListener('click', () => {
          const g = ST.groups[ST.current];
          g.attempts.push(ST.elapsedMs);
          g.bestMs = Math.min(...g.attempts);
          const prevBest = ST.sessionBestMs;
          ST.sessionBestMs = sessionBest();
          ST.newRecord = (prevBest === null || ST.elapsedMs < prevBest) && g.bestMs === ST.elapsedMs;
          ST.elapsedMs = 0; ST.state = 'accepted';
          if (ST.newRecord) { confetti(); showBanner('🏆 New leader!', `${g.name}: ${fmtShort(g.bestMs)}`); }
          refresh();
        });
        containerEl.querySelector('#athNext')?.addEventListener('click', () => {
          ST.current++; ST.elapsedMs = 0; ST.newRecord = false;
          ST.state = ST.current >= ST.groups.length ? 'complete' : 'idle';
          refresh();
        });
        containerEl.querySelector('#athPost')?.addEventListener('click', async btnEvt => {
          const date = new Date().toISOString().slice(0, 10);
          ST.groups.filter(g => g.bestMs).forEach(g => addResult(leaderboard, g.name, g.bestMs, g.players.map(p => p.name)));
          await saveLeaderboard(teamId);
          btnEvt.target.textContent = '✓ Posted!';
          btnEvt.target.disabled = true;
        });
        containerEl.querySelector('#athReset')?.addEventListener('click', () => { ST.state = 'setup'; ST.elapsedMs = 0; refresh(); });
      }

      refresh();
    },
  };
})();
