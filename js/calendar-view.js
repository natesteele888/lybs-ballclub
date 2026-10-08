/* ============================================================
   Calendar view -- month grid and week list for the Schedule tab,
   merging games (js/schedule.js) and practices (js/practices.js)
   into one picture instead of two separate lists. The list view
   stays the default (index.html owns the List/Month/Week toggle,
   see renderScheduleViewToggle there); this module only draws the
   grid/week itself and reports taps back through opts -- it never
   touches window.Schedule/window.Practices' data directly beyond
   reading it, so saving/deleting still goes through the same
   detail/edit forms those two modules already have.

   Month mode: tapping a day selects it and shows that day's items
   in a panel below the grid, rather than cramming full event text
   into a ~40px cell -- the grid itself only shows a colored dot per
   item (capped at 3) as a density signal.

   Week mode: every day gets its own card with items shown inline --
   7 days is few enough that there's no need for the tap-to-reveal
   indirection month mode uses.
   ============================================================ */
(function () {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toIso(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

  function itemsByDate(games, practices) {
    const map = {};
    games.forEach(g => {
      if (!g.date) return;
      (map[g.date] = map[g.date] || []).push({ kind: 'game', item: g, time: g.gameTime });
    });
    practices.forEach(p => {
      if (!p.date) return;
      (map[p.date] = map[p.date] || []).push({ kind: 'practice', item: p, time: p.time });
    });
    Object.keys(map).forEach(date => map[date].sort((a, b) => (a.time || '').localeCompare(b.time || '')));
    return map;
  }

  function gameRowHtml(entry) {
    const g = entry.item;
    const played = g.ourScore != null && g.oppScore != null;
    const badge = played
      ? `<span class="badge ${g.ourScore > g.oppScore ? 'badgeW' : g.ourScore < g.oppScore ? 'badgeL' : 'badgeT'}">${g.ourScore}-${g.oppScore}</span>`
      : '<span class="badge badgeTbd">Game</span>';
    return `
      <div class="listRow" data-kind="game" data-id="${escapeHtml(g.id)}">
        <div class="listRowMain">
          <div class="listRowTitle">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')}</div>
          <div class="listRowSub">${escapeHtml(g.gameTime || '')}${g.location ? ' &middot; ' + escapeHtml(g.location) : ''}</div>
        </div>
        ${badge}
      </div>`;
  }
  function practiceRowHtml(entry) {
    const p = entry.item;
    return `
      <div class="listRow" data-kind="practice" data-id="${escapeHtml(p.id)}">
        <div class="listRowMain">
          <div class="listRowTitle">${escapeHtml(TYPE_LABEL[p.type] || 'Practice')}</div>
          <div class="listRowSub">${escapeHtml(p.time || '')}${p.location ? ' &middot; ' + escapeHtml(p.location) : ''}</div>
        </div>
        <span class="badge badgeTbd">Practice</span>
      </div>`;
  }
  function rowHtml(entry) { return entry.kind === 'game' ? gameRowHtml(entry) : practiceRowHtml(entry); }

  function wireRows(root, opts) {
    root.querySelectorAll('[data-kind]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (row.dataset.kind === 'game') opts.onOpenGame(id);
        else opts.onOpenPractice(id);
      });
    });
  }

  function addButtonsHtml(opts) {
    if (!opts.canEdit) return '';
    return `
      <div class="calAddRow">
        <button class="btn btnGhost btnTiny" data-add="game">+ Game</button>
        <button class="btn btnGhost btnTiny" data-add="practice">+ Practice</button>
      </div>`;
  }
  // Wires every [data-add] button under root at once, reading the date to
  // prefill from the closest ancestor carrying data-date -- works whether
  // root IS that element (month's single day panel) or contains several of
  // them (week's 7 day cards), without needing a per-call closure over the
  // date.
  function wireAddButtons(root, opts) {
    root.querySelectorAll('[data-add]').forEach(btn => {
      const dateIso = btn.closest('[data-date]').dataset.date;
      btn.addEventListener('click', () => {
        if (btn.dataset.add === 'game') opts.onAddGame(dateIso);
        else opts.onAddPractice(dateIso);
      });
    });
  }

  window.CalendarView = {
    render(containerEl, teamId, opts) {
      opts = opts || {};
      const games = window.Schedule.getGames(teamId);
      const practices = window.Practices.getItems(teamId);
      const byDate = itemsByDate(games, practices);
      let anchor = opts.anchorDate ? new Date(opts.anchorDate + 'T00:00:00') : new Date();
      let selectedDate = null;

      function renderMonth() {
        const y = anchor.getFullYear(), m = anchor.getMonth();
        const startPad = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const today = todayIso();
        const cells = [];
        for (let i = 0; i < startPad; i++) cells.push('<div class="calCell calCellEmpty"></div>');
        for (let d = 1; d <= daysInMonth; d++) {
          const iso = toIso(y, m, d);
          const entries = byDate[iso] || [];
          cells.push(`
            <button class="calCell ${iso === today ? 'calCellToday' : ''} ${iso === selectedDate ? 'calCellSelected' : ''}" data-date="${iso}">
              <span class="calCellNum">${d}</span>
              ${entries.length ? `<span class="calDots">${entries.slice(0, 3).map(e => `<span class="calDot ${e.kind === 'game' ? 'calDotGame' : 'calDotPractice'}"></span>`).join('')}</span>` : ''}
            </button>`);
        }
        const dayEntries = selectedDate ? (byDate[selectedDate] || []) : [];
        containerEl.innerHTML = `
          <div class="calHeader">
            <button class="btn btnGhost btnSmall calNavBtn" id="calPrev" aria-label="Previous month">&larr;</button>
            <div class="calHeaderLabel">${escapeHtml(anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</div>
            <button class="btn btnGhost btnSmall calNavBtn" id="calNext" aria-label="Next month">&rarr;</button>
          </div>
          <div class="calWeekdays">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<div>${w}</div>`).join('')}</div>
          <div class="calGrid">${cells.join('')}</div>
          <div class="calDayPanel" ${selectedDate ? `data-date="${selectedDate}"` : ''}>
            ${selectedDate ? `
              <div class="sectionLabel">${escapeHtml(new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
              ${dayEntries.length ? `<div class="listBody">${dayEntries.map(rowHtml).join('')}</div>` : '<div class="emptyState">Nothing scheduled.</div>'}
              ${addButtonsHtml(opts)}
            ` : '<div class="helpText">Tap a day to see what\'s on it.</div>'}
          </div>`;
        containerEl.querySelector('#calPrev').addEventListener('click', () => { anchor = new Date(y, m - 1, 1); renderMonth(); });
        containerEl.querySelector('#calNext').addEventListener('click', () => { anchor = new Date(y, m + 1, 1); renderMonth(); });
        containerEl.querySelectorAll('.calCell[data-date]').forEach(cell => {
          cell.addEventListener('click', () => { selectedDate = cell.dataset.date === selectedDate ? null : cell.dataset.date; renderMonth(); });
        });
        wireRows(containerEl, opts);
        wireAddButtons(containerEl, opts);
      }

      function renderWeek() {
        const start = new Date(anchor);
        start.setDate(start.getDate() - start.getDay()); // back up to Sunday
        const today = todayIso();
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const iso = toIso(d.getFullYear(), d.getMonth(), d.getDate());
          const entries = byDate[iso] || [];
          days.push(`
            <div class="calWeekDay ${iso === today ? 'calWeekDayToday' : ''}" data-date="${iso}">
              <div class="calWeekDayHead">${escapeHtml(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</div>
              ${entries.length ? `<div class="listBody">${entries.map(rowHtml).join('')}</div>` : '<div class="emptyState">Nothing scheduled.</div>'}
              ${addButtonsHtml(opts)}
            </div>`);
        }
        const end = new Date(start); end.setDate(start.getDate() + 6);
        const rangeLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &ndash; ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        containerEl.innerHTML = `
          <div class="calHeader">
            <button class="btn btnGhost btnSmall calNavBtn" id="calPrev" aria-label="Previous week">&larr;</button>
            <div class="calHeaderLabel">${rangeLabel}</div>
            <button class="btn btnGhost btnSmall calNavBtn" id="calNext" aria-label="Next week">&rarr;</button>
          </div>
          <div class="calWeekList">${days.join('')}</div>`;
        containerEl.querySelector('#calPrev').addEventListener('click', () => {
          anchor = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7); renderWeek();
        });
        containerEl.querySelector('#calNext').addEventListener('click', () => {
          anchor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7); renderWeek();
        });
        wireRows(containerEl, opts);
        wireAddButtons(containerEl, opts);
      }

      if (opts.mode === 'week') renderWeek();
      else renderMonth();
    },
  };
})();
