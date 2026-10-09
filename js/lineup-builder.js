/* ============================================================
   Lineup builder -- a new tool (no equivalent exists in
   lybs-reporting). A saveable batting order, each slot carrying a
   player and their defensive position for that game -- separate
   from the depth chart (which is "who's the best at each spot",
   not "who's playing where today").

   Stored at teams/{teamId}/lineups = [{id, name, date, slots:
   [{playerId, name, position}]}]. Coach-only, same as the rest of
   the Coaching tab. Deliberately not tied to a specific Schedule
   game id -- a coach names/dates lineups freely (e.g. "vs
   Ayer-Shirley 6/15" or just "Default") and can duplicate a past
   one as a starting point rather than this owning game data that
   js/schedule.js already owns.

   createFromOrder() is the one other entry point besides render() --
   js/stats-import.js's "Save as new lineup" button hands it an
   already-sorted array of roster players (its suggested batting
   order, computed from an imported GameChanger stats file) and gets
   back a normal editable lineup, named/dated so it's obvious where
   it came from.
   ============================================================ */
(function () {
  const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'Bench'];

  const cache = {}; // teamId -> lineups[]

  async function ensureLineups(teamId) {
    if (cache[teamId]) return cache[teamId];
    const data = await window.dbGet(window.teamPath(teamId, 'lineups'));
    cache[teamId] = Array.isArray(data) ? data : [];
    return cache[teamId];
  }
  // Takes the current array explicitly, rather than reading it back out of
  // cache, because the list gets reassigned (not just mutated) on delete --
  // see the #luDelete handler below. Updates the cache to match.
  async function saveLineups(teamId, lineups) {
    cache[teamId] = lineups;
    await window.dbPut(window.teamPath(teamId, 'lineups'), lineups);
  }

  window.LineupBuilder = {
    // order: [{playerId, name, ...stats}] -- only roster-matched rows,
    // since a slot can only ever reference a real roster player.
    async createFromOrder(teamId, order) {
      const lineups = await ensureLineups(teamId);
      const today = new Date().toISOString().slice(0, 10);
      const l = {
        id: uid('lu'),
        name: `Suggested order -- ${today}`,
        date: today,
        slots: order.map(r => ({ playerId: r.playerId, name: r.name, position: POSITIONS[0] })),
      };
      lineups.unshift(l);
      await saveLineups(teamId, lineups);
      return l;
    },

    async render(containerEl, teamId) {
      let lineups = await ensureLineups(teamId);
      const roster = window.Roster.getPlayers(teamId);
      let view = { mode: 'list' };

      function listHtml() {
        const rows = lineups.map(l => `
          <div class="listRow" data-id="${escapeHtml(l.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(l.name || 'Untitled lineup')}</div>
              <div class="listRowSub">${escapeHtml(l.date || '')} &middot; ${l.slots.length} batter${l.slots.length === 1 ? '' : 's'}</div>
            </div>
          </div>`).join('');
        return `
          <div class="drillHero">
            <div class="drillHeroTitle">Lineups</div>
            <div class="drillHeroSub">Batting order &amp; defensive positions, saved per game.</div>
          </div>
          <button class="btn" id="luNew" style="width:100%;margin-bottom:14px;">+ New lineup</button>
          <div class="listBody">${rows || '<div class="emptyState">No lineups saved yet.</div>'}</div>`;
      }

      function slotRow(slot, i, total) {
        const matched = slot.playerId && roster.some(p => p.id === slot.playerId);
        const removedOpt = slot.playerId && !matched
          ? `<option value="${escapeHtml(slot.playerId)}" selected>${escapeHtml(slot.name || 'Unknown')} (removed)</option>` : '';
        const playerOpts = removedOpt + roster.map(p => `<option value="${escapeHtml(p.id)}" ${slot.playerId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
        const posOpts = POSITIONS.map(p => `<option value="${p}" ${slot.position === p ? 'selected' : ''}>${p}</option>`).join('');
        return `
          <div class="lineupSlot">
            <div class="lineupSlotNum">${i + 1}</div>
            <select class="lineupSlotSelect" data-player="${i}">
              <option value="">Choose player...</option>
              ${playerOpts}
            </select>
            <select class="lineupSlotSelect lineupPosSelect" data-pos="${i}">${posOpts}</select>
            <div class="depthRowActions">
              <button class="btn btnTiny" data-slotup="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btnTiny" data-slotdown="${i}" ${i === total - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn btnTiny" data-slotremove="${i}">&times;</button>
            </div>
          </div>`;
      }

      // Plain-text batting order for texting/pasting elsewhere -- only
      // slots with a player actually picked, same "don't show a blank
      // name" rule the roster/position dropdowns already follow.
      function shareText(l) {
        const lines = l.slots.filter(s => s.name).map((s, i) => `${i + 1}. ${s.name}${s.position ? ' - ' + s.position : ''}`);
        const header = [l.name || 'Lineup', l.date || ''].filter(Boolean).join(' -- ');
        return [header, ...lines].join('\n');
      }

      function editHtml(l) {
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="luBack">&larr; Lineups</button>
            <div class="recordLine">Editing lineup</div>
          </div>
          <label class="drillFieldLabel">Name
            <input class="drillFreeInput" id="luName" value="${escapeHtml(l.name || '')}" placeholder="e.g. vs Ayer-Shirley 6/15">
          </label>
          <label class="drillFieldLabel" style="margin-top:10px;">Date
            <input class="drillFreeInput" id="luDate" type="date" value="${escapeHtml(l.date || '')}">
          </label>
          <div class="sectionLabel" style="margin-top:16px;">Batting order</div>
          <div id="luSlots">${l.slots.map((s, i) => slotRow(s, i, l.slots.length)).join('') || '<div class="emptyState">No batters yet.</div>'}</div>
          <button class="btn btnGhost" id="luAddSlot" style="width:100%;margin-top:10px;">+ Add batter</button>
          <div class="sectionHeader" style="margin-top:16px;">
            <button class="btn" id="luSave">Save lineup</button>
            <button class="btn btnGhost" id="luShare">Share</button>
            <button class="btn btnDanger" id="luDelete">Delete</button>
          </div>
          <div class="helpText" id="luShareMsg" style="min-height:16px;"></div>`;
      }

      function refresh() {
        if (view.mode === 'list') {
          containerEl.innerHTML = listHtml();
          containerEl.querySelector('#luNew').addEventListener('click', () => {
            const l = { id: uid('lu'), name: '', date: new Date().toISOString().slice(0, 10), slots: [] };
            lineups.unshift(l);
            view = { mode: 'edit', id: l.id };
            refresh();
          });
          containerEl.querySelectorAll('.listRow').forEach(row => {
            row.addEventListener('click', () => { view = { mode: 'edit', id: row.dataset.id }; refresh(); });
          });
        } else {
          const l = lineups.find(x => x.id === view.id);
          if (!l) { view = { mode: 'list' }; refresh(); return; }
          containerEl.innerHTML = editHtml(l);
          containerEl.querySelector('#luBack').addEventListener('click', async () => {
            l.name = containerEl.querySelector('#luName').value.trim();
            l.date = containerEl.querySelector('#luDate').value;
            await saveLineups(teamId, lineups);
            view = { mode: 'list' }; refresh();
          });
          containerEl.querySelector('#luName').addEventListener('change', e => { l.name = e.target.value.trim(); });
          containerEl.querySelector('#luDate').addEventListener('change', e => { l.date = e.target.value; });
          containerEl.querySelectorAll('[data-player]').forEach(sel => {
            sel.addEventListener('change', () => {
              const i = Number(sel.dataset.player);
              const p = roster.find(r => r.id === sel.value);
              l.slots[i].playerId = sel.value || null;
              l.slots[i].name = p ? p.name : '';
            });
          });
          containerEl.querySelectorAll('[data-pos]').forEach(sel => {
            sel.addEventListener('change', () => { l.slots[Number(sel.dataset.pos)].position = sel.value; });
          });
          containerEl.querySelector('#luAddSlot').addEventListener('click', () => {
            l.slots.push({ playerId: null, name: '', position: POSITIONS[0] });
            refresh();
          });
          containerEl.querySelectorAll('[data-slotup]').forEach(btn => {
            btn.addEventListener('click', () => {
              const i = Number(btn.dataset.slotup);
              [l.slots[i - 1], l.slots[i]] = [l.slots[i], l.slots[i - 1]];
              refresh();
            });
          });
          containerEl.querySelectorAll('[data-slotdown]').forEach(btn => {
            btn.addEventListener('click', () => {
              const i = Number(btn.dataset.slotdown);
              [l.slots[i + 1], l.slots[i]] = [l.slots[i], l.slots[i + 1]];
              refresh();
            });
          });
          containerEl.querySelectorAll('[data-slotremove]').forEach(btn => {
            btn.addEventListener('click', () => { l.slots.splice(Number(btn.dataset.slotremove), 1); refresh(); });
          });
          containerEl.querySelector('#luSave').addEventListener('click', async btnEvt => {
            l.name = containerEl.querySelector('#luName').value.trim();
            l.date = containerEl.querySelector('#luDate').value;
            await saveLineups(teamId, lineups);
            btnEvt.target.textContent = 'Saved!';
            setTimeout(() => refresh(), 500);
          });
          containerEl.querySelector('#luShare').addEventListener('click', async () => {
            const text = shareText(l);
            const msg = containerEl.querySelector('#luShareMsg');
            const say = (t, good) => { msg.textContent = t; msg.style.color = good ? '#5fd989' : '#ff8a8a'; };
            if (navigator.share) {
              try { await navigator.share({ title: l.name || 'Lineup', text }); return; }
              catch (e) { if (e.name === 'AbortError') return; /* fall through to copy */ }
            }
            try {
              if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); say('Lineup copied.', true); return; }
            } catch (e) { /* fall through */ }
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:-9999px;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            ta.remove();
            say(ok ? 'Lineup copied.' : 'Could not copy automatically -- select and copy manually.', ok);
          });
          containerEl.querySelector('#luDelete').addEventListener('click', async () => {
            if (!confirm('Delete this lineup?')) return;
            lineups = lineups.filter(x => x.id !== l.id);
            await saveLineups(teamId, lineups);
            view = { mode: 'list' }; refresh();
          });
        }
      }
      refresh();
    },
  };
})();
