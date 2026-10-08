/* ============================================================
   9-Pocket pitch chart -- ported from lybs-reporting's
   coaching_tools.js, scoped to the real 9-pocket net drill (tap
   which of 9 pockets a pitch hit, or "Ball"), pitch type, and
   optional speed. Deliberately leaves out that file's freeform
   canvas-plot mode and its "target"/"accuracy" simulator games --
   this port is about tracking a real drill, not duplicating every
   mode of a much larger existing tool.

   Sessions save to teams/{teamId}/drills/pitchSessions (team-scoped,
   instead of the source app's per-user localStorage bin), optionally
   tagged with a pitcher from this team's own roster.
   ============================================================ */
(function () {
  const RED = '#ef4444', GOLD = '#f5a623', GREEN = '#10b981';
  const PT_TYPES = [
    { id: '4FB', label: '4-Seam FB', color: '#ef4444' },
    { id: '2FB', label: '2-Seam FB', color: '#f97316' },
    { id: 'CH', label: 'Changeup', color: '#10b981' },
    { id: 'CU', label: 'Curveball', color: '#a78bfa' },
  ];
  const POCKET_LABELS = [
    [['High', 'In'], ['High', 'Mid'], ['High', 'Out']],
    [['Mid', 'In'], ['Middle', ''], ['Mid', 'Out']],
    [['Low', 'In'], ['Low', 'Mid'], ['Low', 'Out']],
  ];
  const ZONES = ['0-0', '0-1', '0-2', '1-0', '1-1', '1-2', '2-0', '2-1', '2-2'];

  function strikeRate(pitches) {
    if (!pitches.length) return 0;
    return Math.round(pitches.filter(p => p.zone !== 'ball').length / pitches.length * 100);
  }

  let TEAM_ID = null;
  let sessions = null; // cached array, loaded once per team

  const PC = { state: 'setup', pitches: [], pitcher: null, targetCount: 0, pendingPitch: null };

  async function ensureSessions(teamId) {
    if (sessions && TEAM_ID === teamId) return sessions;
    TEAM_ID = teamId;
    const data = await window.dbGet(window.teamPath(teamId, 'drills/pitchSessions'));
    sessions = Array.isArray(data) ? data : [];
    return sessions;
  }
  async function saveSessions() {
    await window.dbPut(window.teamPath(TEAM_ID, 'drills/pitchSessions'), sessions);
  }

  window.DrillPitching = {
    async render(containerEl, teamId) {
      await ensureSessions(teamId);
      const roster = window.Roster.getPlayers(teamId);

      function refresh() {
        containerEl.innerHTML = PC.state === 'setup' ? setupHtml()
          : PC.state === 'history' ? historyHtml()
          : PC.state === 'done' ? doneHtml()
          : plotHtml();
        wire();
      }

      function setupHtml() {
        return `
          <div class="drillHero">
            <div class="drillHeroIcon">🎯</div>
            <div class="drillHeroTitle">Pitch Chart</div>
            <div class="drillHeroSub">Track pitch location, type &amp; velocity on the 9-pocket net.</div>
          </div>
          <div class="sectionLabel">Pitcher (optional)</div>
          <input class="drillFreeInput" id="pcPitcherInp" list="pcPitcherList" placeholder="Search roster...">
          <datalist id="pcPitcherList">${roster.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>
          <div class="sectionLabel" style="margin-top:14px;">Pitch count</div>
          <div class="drillChipRow" id="pcCountRow">
            ${[10, 15, 20, 25].map(n => `<button class="drillChip" data-count="${n}">${n}</button>`).join('')}
            <button class="drillChip" data-count="999">No limit</button>
          </div>
          <button class="btn" id="pcStart" style="width:100%;margin-top:16px;">Start charting &rarr;</button>
          ${sessions.length ? `<button class="btn btnGhost" id="pcHistoryBtn" style="width:100%;margin-top:10px;">View history (${sessions.length})</button>` : ''}`;
      }

      function plotHtml() {
        const done = PC.pitches.length, target = PC.targetCount;
        const pct = target < 999 ? Math.min(done / target * 100, 100) : 0;
        const sr = strikeRate(PC.pitches);
        const zoneCounts = {};
        PC.pitches.forEach(p => { if (p.zone !== 'ball') zoneCounts[p.zone] = (zoneCounts[p.zone] || 0) + 1; });
        const ballCount = PC.pitches.filter(p => p.zone === 'ball').length;
        const maxZone = Math.max(1, ...Object.values(zoneCounts));

        const pockets = ZONES.map((z, i) => {
          const row = Math.floor(i / 3), col = i % 3;
          const n = zoneCounts[z] || 0;
          const intensity = n / maxZone;
          const hot = intensity > 0.6 ? 'pcPocketHot' : intensity > 0.25 ? 'pcPocketMed' : '';
          const [l1, l2] = POCKET_LABELS[row][col];
          return `<button class="pcPocket ${hot}" style="background:rgba(239,68,68,${0.04 + intensity * 0.5});" data-zone="${z}">
            <span class="pcPocketLabel">${l1 ? `<span>${l1}</span>` : ''}${l2 ? `<span>${l2}</span>` : ''}</span>
            ${n > 0 ? `<span class="pcPocketCount">${n}</span>` : ''}
          </button>`;
        }).join('');

        const pending = PC.pendingPitch ? `
          <div class="drillCard pcPendingCard">
            <div class="sectionLabel">${PC.pendingPitch.zone === 'ball' ? '⚪ Ball' : '✅ Strike'} &mdash; pick a type</div>
            <div class="drillChipRow">
              ${PT_TYPES.map(t => `<button class="pcTypeBtn" data-type="${t.id}" style="--pt-color:${t.color};">${t.id}</button>`).join('')}
            </div>
            <div class="pcSpeedRow">
              <input class="drillFreeInput" id="pcSpeedInp" type="number" min="20" max="100" placeholder="mph (optional)" inputmode="numeric">
              <button class="btn btnSmall" id="pcCommit">Log pitch</button>
              <button class="btn btnGhost btnSmall" id="pcCancelPending">Cancel</button>
            </div>
          </div>` : '';

        return `
          <div class="sectionHeader">
            <div class="recordLine">${PC.pitcher ? escapeHtml(PC.pitcher) : 'No pitcher selected'}</div>
            <div class="recordLine"><b>${done}${target < 999 ? '/' + target : ''}</b></div>
          </div>
          ${target < 999 ? `<div class="pcProgressBar"><div class="pcProgressFill" style="width:${pct}%;"></div></div>` : ''}
          <div class="pcNetFrame">
            <div class="pcPocketGrid">${pockets}</div>
          </div>
          <div class="pcBelowNet">
            <button class="btn btnGhost" id="pcBall">⚪ Ball ${ballCount ? '(' + ballCount + ')' : ''}</button>
            <div class="pcStrikeRate" style="color:${sr >= 65 ? GREEN : sr >= 50 ? GOLD : RED};">${sr}% <span>K%</span></div>
          </div>
          ${pending}
          <div class="sectionHeader" style="margin-top:14px;">
            <button class="btn btnGhost btnSmall" id="pcUndo" ${!PC.pitches.length ? 'disabled' : ''}>↩ Undo</button>
            <button class="btn btnGhost btnSmall" id="pcEnd">End session</button>
          </div>`;
      }

      function doneHtml() {
        const total = PC.pitches.length;
        const strikes = PC.pitches.filter(p => p.zone !== 'ball').length;
        const sr = total ? Math.round(strikes / total * 100) : 0;
        const withSpeed = PC.pitches.filter(p => p.speed);
        const avgSpeed = withSpeed.length ? Math.round(withSpeed.reduce((s, p) => s + p.speed, 0) / withSpeed.length) : null;
        const topSpeed = withSpeed.length ? Math.max(...withSpeed.map(p => p.speed)) : null;
        let maxStreak = 0, cur = 0;
        PC.pitches.forEach(p => { if (p.zone !== 'ball') { cur++; maxStreak = Math.max(maxStreak, cur); } else cur = 0; });
        const typeCounts = {};
        PT_TYPES.forEach(t => typeCounts[t.id] = 0);
        PC.pitches.forEach(p => { if (typeCounts[p.type] !== undefined) typeCounts[p.type]++; });

        const stat = (label, value, color) => `<div class="pcStatTile"><div class="pcStatValue" style="color:${color || 'var(--text)'};">${value}</div><div class="pcStatLabel">${label}</div></div>`;

        return `
          <div class="drillHero">
            <div class="drillHeroIcon">🎯</div>
            <div class="drillHeroTitle">Session complete</div>
            ${PC.pitcher ? `<div class="drillHeroSub">${escapeHtml(PC.pitcher)}</div>` : ''}
          </div>
          <div class="pcStatRow">
            ${stat('Pitches', total)}
            ${stat('Strike%', sr + '%', sr >= 65 ? GREEN : sr >= 55 ? GOLD : RED)}
            ${stat('Strikes', strikes, GREEN)}
            ${stat('Balls', total - strikes)}
            ${avgSpeed ? stat('Avg MPH', avgSpeed, GOLD) : ''}
            ${topSpeed ? stat('Top MPH', topSpeed, '#60a5fa') : ''}
            ${maxStreak >= 2 ? stat('K Streak', maxStreak, GREEN) : ''}
          </div>
          <div class="drillChipRow">
            ${PT_TYPES.filter(t => typeCounts[t.id] > 0).map(t => `<span class="pcTypeTag" style="--pt-color:${t.color};">${t.id} &middot; ${typeCounts[t.id]}</span>`).join('')}
          </div>
          <button class="btn" id="pcSave" style="width:100%;margin-top:16px;">💾 Save session</button>
          <div class="sectionHeader" style="margin-top:10px;">
            <button class="btn btnGhost" id="pcNew">New session</button>
            ${sessions.length ? `<button class="btn btnGhost" id="pcHistoryBtn2">History</button>` : ''}
          </div>`;
      }

      function historyHtml() {
        const rows = sessions.slice(0, 20).map((s, i) => `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${s.pitcher ? escapeHtml(s.pitcher) : 'No pitcher'}</div>
              <div class="listRowSub">${escapeHtml(s.date)} &middot; ${s.total} pitches${s.avgSpeed ? ' &middot; ' + s.avgSpeed + ' mph avg' : ''}</div>
            </div>
            <div class="athBoardTime" style="color:${s.strikeRate >= 65 ? GREEN : s.strikeRate >= 55 ? GOLD : RED};">${s.strikeRate}%</div>
            <button class="btn btnTiny" data-del="${i}" title="Delete">&times;</button>
          </div>`).join('');
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="pcBackFromHistory">&larr; Back</button>
            <div class="recordLine">Pitch session history</div>
          </div>
          <div class="listBody">${rows || '<div class="emptyState">No saved sessions yet.</div>'}</div>`;
      }

      function wire() {
        containerEl.querySelectorAll('[data-count]').forEach(btn => {
          btn.addEventListener('click', () => {
            PC.targetCount = Number(btn.dataset.count);
            containerEl.querySelectorAll('[data-count]').forEach(b => b.classList.toggle('drillChipOn', b === btn));
          });
        });
        containerEl.querySelector('#pcStart')?.addEventListener('click', () => {
          PC.pitcher = containerEl.querySelector('#pcPitcherInp').value.trim() || null;
          if (!PC.targetCount) PC.targetCount = 999;
          PC.pitches = []; PC.pendingPitch = null; PC.state = 'plotting';
          refresh();
        });
        containerEl.querySelector('#pcHistoryBtn')?.addEventListener('click', () => { PC.state = 'history'; refresh(); });
        containerEl.querySelector('#pcHistoryBtn2')?.addEventListener('click', () => { PC.state = 'history'; refresh(); });
        containerEl.querySelector('#pcBackFromHistory')?.addEventListener('click', () => { PC.state = 'setup'; refresh(); });
        containerEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            sessions.splice(Number(btn.dataset.del), 1);
            await saveSessions();
            refresh();
          });
        });
        containerEl.querySelectorAll('.pcPocket').forEach(btn => {
          btn.addEventListener('click', () => {
            if (PC.pendingPitch) return;
            PC.pendingPitch = { zone: btn.dataset.zone };
            refresh();
          });
        });
        containerEl.querySelector('#pcBall')?.addEventListener('click', () => {
          if (PC.pendingPitch) return;
          PC.pendingPitch = { zone: 'ball' };
          refresh();
        });
        containerEl.querySelectorAll('.pcTypeBtn').forEach(btn => {
          btn.addEventListener('click', () => {
            containerEl.querySelectorAll('.pcTypeBtn').forEach(b => b.classList.toggle('pcTypeBtnOn', b === btn));
            if (PC.pendingPitch) PC.pendingPitch.type = btn.dataset.type;
          });
        });
        containerEl.querySelector('#pcCommit')?.addEventListener('click', () => {
          if (!PC.pendingPitch) return;
          const speedInp = containerEl.querySelector('#pcSpeedInp');
          const speed = speedInp && speedInp.value ? parseInt(speedInp.value, 10) : null;
          PC.pitches.push({ zone: PC.pendingPitch.zone, type: PC.pendingPitch.type || '4FB', speed });
          PC.pendingPitch = null;
          if (PC.targetCount < 999 && PC.pitches.length >= PC.targetCount) PC.state = 'done';
          refresh();
        });
        containerEl.querySelector('#pcCancelPending')?.addEventListener('click', () => { PC.pendingPitch = null; refresh(); });
        containerEl.querySelector('#pcUndo')?.addEventListener('click', () => { PC.pitches.pop(); refresh(); });
        containerEl.querySelector('#pcEnd')?.addEventListener('click', () => { PC.state = 'done'; refresh(); });
        containerEl.querySelector('#pcNew')?.addEventListener('click', () => {
          PC.state = 'setup'; PC.pitches = []; PC.pendingPitch = null; PC.pitcher = null; PC.targetCount = 0;
          refresh();
        });
        containerEl.querySelector('#pcSave')?.addEventListener('click', async btnEvt => {
          const total = PC.pitches.length;
          const strikes = PC.pitches.filter(p => p.zone !== 'ball').length;
          const withSpeed = PC.pitches.filter(p => p.speed);
          let maxStreak = 0, cur = 0;
          PC.pitches.forEach(p => { if (p.zone !== 'ball') { cur++; maxStreak = Math.max(maxStreak, cur); } else cur = 0; });
          sessions.unshift({
            id: Date.now(), date: new Date().toISOString().slice(0, 10), pitcher: PC.pitcher, pitches: PC.pitches,
            total, strikes, balls: total - strikes, strikeRate: total ? Math.round(strikes / total * 100) : 0,
            avgSpeed: withSpeed.length ? Math.round(withSpeed.reduce((s, p) => s + p.speed, 0) / withSpeed.length) : null,
            topSpeed: withSpeed.length ? Math.max(...withSpeed.map(p => p.speed)) : null, maxStreak,
          });
          await saveSessions();
          btnEvt.target.textContent = '✓ Saved!';
          btnEvt.target.disabled = true;
        });
      }

      refresh();
    },
  };
})();
