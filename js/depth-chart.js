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
  // Percent coordinates over fieldSvg()'s viewBox below, viewed from behind
  // home plate (the standard scorecard orientation). Derived directly from
  // that artwork's own geometry (mound center, base markers, home plate,
  // and the outfield fence arc), not estimated -- P/1B/3B sit on their real
  // markers, C sits just behind the plate shape, and the outfield three are
  // pulled slightly in from the fence line so their cards don't overlap it.
  // 2B and SS aren't on the bag itself -- real fielders at both spots play
  // off the base, shaded toward it (2B toward 1st, SS toward 3rd), in the
  // open grass between the infield dirt and the outfield.
  const COORDS = {
    P: { x: 50, y: 61 }, C: { x: 50, y: 87 },
    '1B': { x: 66, y: 61 }, '2B': { x: 63, y: 40 }, '3B': { x: 35, y: 61 }, SS: { x: 37, y: 40 },
    LF: { x: 26, y: 22 }, CF: { x: 50, y: 12 }, RF: { x: 75, y: 22 },
  };

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

  // Traced from the coach's own field diagram (outer fence, infield grass
  // line, infield dirt line, mound, bases, plate) -- raw coordinates from
  // that artwork, just cropped to a tight viewBox around the drawn content.
  // Each boundary is a filled ring in the source file (gives it a clean
  // line look without an actual stroke); only the outer edge of each ring
  // is kept here and drawn as a real stroke instead, since the ring itself
  // is far too thin to matter at this size.
  function fieldSvg() {
    return `
      <svg class="depthFieldSvg" viewBox="136.5 262.4 397.6 333.5" preserveAspectRatio="none">
        <path class="depthFieldLine" d="M523.8,406c0-.3-10.2-33.8-38.1-66.8-25.8-30.5-72.5-66.8-148.6-66.8s-123.8,36.4-150.4,66.9c-28.8,33-39.8,66.6-39.9,66.9l-.3,1.1,158.6,158.6,17.3,16.1c8.6,5.5,19.6,5.2,27.9-.6l17.1-17.1,155.9-156.4.8-.8-.3-1.1Z" />
        <path class="depthFieldLine" d="M450.7,437.4l-.2-.6c0-.2-6.2-20.5-23.1-40.5-15.6-18.5-43.9-40.5-90.1-40.5s-75,22-91.1,40.5c-17.5,20-24.1,40.3-24.2,40.5l-.2.7,96.1,96.1c-.8,2.2-1.3,4.7-1.3,7.2,0,11.3,9.2,20.4,20.4,20.4s20.4-9.2,20.4-20.4-.6-5.7-1.7-8.2l94.5-94.8.5-.5Z" />
        <path class="depthFieldLine" d="M394.3,466.5c0-4.3,1.7-8.2,4.6-11.1.2-.2.5-.5.7-.7l-.9-.9-48.9-48.9-.9-.9c-.2.3-.4.5-.7.8-2.9,3.2-7.1,5.2-11.7,5.2s-8-1.7-10.9-4.3c-.2-.2-.5-.5-.7-.7l-.9.9-48.2,48.2-.9.9c.2.2.5.5.7.7,2.7,2.8,4.3,6.7,4.3,10.9s-1.5,7.7-4.1,10.5c-.2.2-.4.5-.7.7l.9.9,47.6,47.6,1.1,1.1c.3-.2.5-.4.8-.6,3.2-2.5,7.3-4,11.7-4s8.5,1.5,11.7,4.1c.3.2.5.4.8.6l1.1-1.1,47.4-47.4.9-.9c-.2-.2-.5-.5-.7-.7-2.6-2.8-4.3-6.6-4.3-10.8Z" />
        <circle class="depthFieldLine" cx="337.2" cy="466.5" r="13.5" />
        <rect class="depthFieldDot" x="264.6" y="463.7" width="5.5" height="5.5" transform="translate(408.2 -52.4) rotate(45)" />
        <rect class="depthFieldDot" x="403.6" y="463.7" width="5.5" height="5.5" transform="translate(448.9 -150.7) rotate(45)" />
        <rect class="depthFieldDot" x="334.4" y="393.9" width="5.5" height="5.5" transform="translate(379.2 -122.2) rotate(45)" />
        <polygon class="depthFieldHome" points="341.1 533.4 333.2 533.4 333.2 537.6 333.3 537.6 333.2 537.7 337.2 541.6 341.1 537.7 341.1 537.6 341.1 537.6 341.1 533.4" />
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
