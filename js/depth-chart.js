/* ============================================================
   Depth chart -- a new tool, not a port (lybs-reporting only has
   a per-player "which positions can they play" tag, not a ranked
   depth chart). One ordered list of roster players per position;
   order is depth (1st string, 2nd string, ...). A player can
   appear on more than one position's list -- normal for a
   versatile youth-league roster.

   Stored at teams/{teamId}/depthChart = { [position]: [{id,name}] }.
   Coach-only, same as the rest of the Coaching tab.
   ============================================================ */
(function () {
  const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  let TEAM_ID = null;
  let chart = null; // cached {position: [{id,name}]}

  async function ensureChart(teamId) {
    if (chart && TEAM_ID === teamId) return chart;
    TEAM_ID = teamId;
    const data = await window.dbGet(window.teamPath(teamId, 'depthChart'));
    chart = {};
    POSITIONS.forEach(p => { chart[p] = (data && Array.isArray(data[p])) ? data[p] : []; });
    return chart;
  }
  async function saveChart() {
    await window.dbPut(window.teamPath(TEAM_ID, 'depthChart'), chart);
  }

  window.DepthChart = {
    async render(containerEl, teamId) {
      await ensureChart(teamId);
      const roster = window.Roster.getPlayers(teamId);
      let position = POSITIONS[0];

      function refresh() {
        const list = chart[position];
        const onIds = new Set(list.map(p => p.id));
        const available = roster.filter(p => !onIds.has(p.id));

        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroIcon">📋</div>
            <div class="drillHeroTitle">Depth Chart</div>
            <div class="drillHeroSub">Rank who plays each position, 1st string on top.</div>
          </div>
          <div class="coachingToggle" id="posToggle">
            ${POSITIONS.map(p => `<button class="btn btnSmall ${p === position ? '' : 'btnGhost'}" data-pos="${p}">${p}</button>`).join('')}
          </div>
          <div class="sectionLabel">${escapeHtml(position)}</div>
          <div class="listBody">
            ${list.length ? list.map((p, i) => `
              <div class="listRow depthRow" style="cursor:default;">
                <div class="depthRank">${i + 1}</div>
                <div class="listRowMain"><div class="listRowTitle">${escapeHtml(p.name)}</div></div>
                <div class="depthRowActions">
                  <button class="btn btnTiny" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
                  <button class="btn btnTiny" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
                  <button class="btn btnTiny" data-remove="${i}">&times;</button>
                </div>
              </div>`).join('') : '<div class="emptyState">No one assigned to this position yet.</div>'}
          </div>
          ${available.length ? `
            <div class="sectionLabel" style="margin-top:16px;">Add to ${escapeHtml(position)}</div>
            <div class="drillChipRow">
              ${available.map(p => `<button class="drillChip" data-add="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">+ ${escapeHtml(p.name)}</button>`).join('')}
            </div>` : ''}`;

        containerEl.querySelectorAll('[data-pos]').forEach(btn => {
          btn.addEventListener('click', () => { position = btn.dataset.pos; refresh(); });
        });
        containerEl.querySelectorAll('[data-up]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.up);
            [list[i - 1], list[i]] = [list[i], list[i - 1]];
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-down]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.down);
            [list[i + 1], list[i]] = [list[i], list[i + 1]];
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-remove]').forEach(btn => {
          btn.addEventListener('click', async () => {
            list.splice(Number(btn.dataset.remove), 1);
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-add]').forEach(btn => {
          btn.addEventListener('click', async () => {
            list.push({ id: btn.dataset.add, name: btn.dataset.name });
            await saveChart(); refresh();
          });
        });
      }
      refresh();
    },
  };
})();
