/* ============================================================
   Depth chart -- a field diagram, not a position-by-position list
   picker. Every position shows at once, each with its top 2-3
   players right where that spot sits on the field; tapping one
   opens a ranked editor for just that position underneath.

   Stored at teams/{teamId}/depthChart = { [position]: [{id,name}] },
   same shape as before -- order is depth (index 0 = starter, 1 =
   backup, ...). A player can still appear on more than one
   position's list (normal for a versatile youth-league roster), but
   index 0 -- the starter -- is exclusive across positions: a kid
   can only be starting one spot on the field at a time. Promoting
   someone to starter at a new position automatically pulls them out
   of their old starting spot (a brief banner says where from), since
   an unprompted removal silently leaving no trace would be worse
   than telling the coach what just happened.

   Coach-only, same as the rest of the Coaching tab.
   ============================================================ */
(function () {
  const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  // Percent coordinates on a 100x100 field panel, viewed from behind home
  // plate (the standard scorecard orientation) -- matches the SVG diamond
  // drawn in fieldSvg() below, which uses the same 0-100 viewBox.
  const COORDS = {
    P: { x: 50, y: 65 }, C: { x: 50, y: 90 },
    '1B': { x: 78, y: 60 }, '2B': { x: 50, y: 38 }, '3B': { x: 22, y: 60 }, SS: { x: 34, y: 50 },
    LF: { x: 14, y: 24 }, CF: { x: 50, y: 8 }, RF: { x: 86, y: 24 },
  };

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

  // A kid can only start one spot at a time -- if whoever now sits at
  // index 0 for `position` was index 0 somewhere else, pull them out of
  // that other starting spot entirely (they're still free to be a 2nd/3rd
  // string option anywhere else on the roster). Returns the position they
  // got pulled from, or null.
  function enforceStarterExclusivity(position) {
    const starter = chart[position][0];
    if (!starter) return null;
    let movedFrom = null;
    POSITIONS.forEach(pos => {
      if (pos === position) return;
      const list = chart[pos];
      if (list.length && list[0].id === starter.id) {
        list.shift();
        movedFrom = pos;
      }
    });
    return movedFrom;
  }

  function fieldSvg() {
    return `
      <svg class="depthFieldSvg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M 6 18 Q 50 -4 94 18" />
        <line x1="50" y1="92" x2="6" y2="18" />
        <line x1="50" y1="92" x2="94" y2="18" />
        <path d="M 50 92 L 78 60 L 50 38 L 22 60 Z" />
      </svg>`;
  }

  window.DepthChart = {
    async render(containerEl, teamId) {
      await ensureChart(teamId);
      const roster = window.Roster.getPlayers(teamId);
      let selected = null; // position currently expanded for editing
      let banner = null; // {name, from, to} -- shown once, right after a starter gets bumped

      function posCardHtml(p) {
        const list = chart[p];
        const starter = list[0];
        const bench = list.slice(1, 3);
        const c = COORDS[p];
        return `
          <button class="depthPosCard ${selected === p ? 'depthPosCardActive' : ''}" style="left:${c.x}%;top:${c.y}%;" data-selectpos="${p}">
            <div class="depthPosLabel">${p}</div>
            ${starter ? `<div class="depthPosStarter">${escapeHtml(starter.name)}</div>` : '<div class="depthPosEmpty">Open</div>'}
            ${bench.length ? `<div class="depthPosBench">${bench.map(b => escapeHtml(b.name)).join(' &middot; ')}</div>` : ''}
          </button>`;
      }

      function editorHtml(p) {
        const list = chart[p];
        const onIds = new Set(list.map(x => x.id));
        const available = roster.filter(x => !onIds.has(x.id));
        return `
          <div class="detailCard" style="margin-top:14px;">
            <div class="sectionHeader" style="margin-bottom:10px;">
              <h3 style="margin:0;">${escapeHtml(p)}</h3>
              <button class="btn btnGhost btnSmall" id="depthCloseBtn">Close</button>
            </div>
            <div class="listBody">
              ${list.length ? list.map((pl, i) => `
                <div class="listRow depthRow" style="cursor:default;">
                  <div class="depthRank">${i === 0 ? '★' : i + 1}</div>
                  <div class="listRowMain"><div class="listRowTitle">${escapeHtml(pl.name)}</div>${i === 0 ? '<div class="listRowSub">Starter</div>' : ''}</div>
                  <div class="depthRowActions">
                    <button class="btn btnTiny" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
                    <button class="btn btnTiny" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''}>&darr;</button>
                    <button class="btn btnTiny" data-remove="${i}">&times;</button>
                  </div>
                </div>`).join('') : '<div class="emptyState">No one assigned to this position yet.</div>'}
            </div>
            ${available.length ? `
              <div class="sectionLabel" style="margin-top:14px;">Add to ${escapeHtml(p)}</div>
              <div class="drillChipRow">
                ${available.map(pl => `<button class="drillChip" data-add="${escapeHtml(pl.id)}" data-name="${escapeHtml(pl.name)}">+ ${escapeHtml(pl.name)}</button>`).join('')}
              </div>` : ''}
          </div>`;
      }

      function refresh() {
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroIcon">🏟️</div>
            <div class="drillHeroTitle">Depth Chart</div>
            <div class="drillHeroSub">Tap a position to rank who plays there. &#9733; starts one spot at a time -- taking a new one gives up the old.</div>
          </div>
          ${banner ? `<div class="helpText" style="color:#F0C84B;margin-bottom:10px;">${escapeHtml(banner.name)} is now starting ${escapeHtml(banner.to)} -- moved out of starting ${escapeHtml(banner.from)}.</div>` : ''}
          <div class="depthField">
            ${fieldSvg()}
            ${POSITIONS.map(posCardHtml).join('')}
          </div>
          ${selected ? editorHtml(selected) : ''}`;
        banner = null;

        containerEl.querySelectorAll('[data-selectpos]').forEach(btn => {
          btn.addEventListener('click', () => {
            selected = selected === btn.dataset.selectpos ? null : btn.dataset.selectpos;
            refresh();
          });
        });
        const closeBtn = containerEl.querySelector('#depthCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', () => { selected = null; refresh(); });

        containerEl.querySelectorAll('[data-up]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const list = chart[selected];
            const i = Number(btn.dataset.up);
            [list[i - 1], list[i]] = [list[i], list[i - 1]];
            if (i - 1 === 0) {
              const movedFrom = enforceStarterExclusivity(selected);
              if (movedFrom) banner = { name: list[0].name, from: movedFrom, to: selected };
            }
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-down]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const list = chart[selected];
            const i = Number(btn.dataset.down);
            [list[i + 1], list[i]] = [list[i], list[i + 1]];
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-remove]').forEach(btn => {
          btn.addEventListener('click', async () => {
            chart[selected].splice(Number(btn.dataset.remove), 1);
            await saveChart(); refresh();
          });
        });
        containerEl.querySelectorAll('[data-add]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const list = chart[selected];
            const wasEmpty = list.length === 0;
            list.push({ id: btn.dataset.add, name: btn.dataset.name });
            if (wasEmpty) {
              const movedFrom = enforceStarterExclusivity(selected);
              if (movedFrom) banner = { name: btn.dataset.name, from: movedFrom, to: selected };
            }
            await saveChart(); refresh();
          });
        });
      }
      refresh();
    },
  };
})();
