/* ============================================================
   Play Diagrams -- situational positioning a coach draws up once
   and the team can reference later ("bunt coverage, runner on
   first", "relay from the gap"), not a per-game plan like Lineups
   or a season-long assignment like Depth Chart. Tap the field to
   drop a labeled marker anywhere -- no fixed 9 positions, since a
   cutoff man or a covering infielder's situational spot often isn't
   one of those anyway.

   Draws over the exact same field art Depth Chart uses
   (window.DepthChart.fieldSvg(), exported for this reason) so a
   marker's x/y percentage means the same spot on the same diamond
   in both tools, rather than re-tracing or approximating it again.

   Stored at teams/{teamId}/playDiagrams = [{id, title, note,
   markers: [{id, x, y, label}]}]. Coach-only, same write rule as
   Lineups/Depth Chart/Practice Plan -- this is coaching strategy
   content, same category, same gate.
   ============================================================ */
(function () {
  let TEAM_ID = null;
  let diagrams = null; // cached array

  async function ensureDiagrams(teamId) {
    if (diagrams && TEAM_ID === teamId) return diagrams;
    TEAM_ID = teamId;
    const data = await window.dbGet(window.teamPath(teamId, 'playDiagrams'));
    diagrams = Array.isArray(data) ? data : [];
    return diagrams;
  }
  async function saveDiagrams() {
    await window.dbPut(window.teamPath(TEAM_ID, 'playDiagrams'), diagrams);
  }

  window.PlayDiagram = {
    async render(containerEl, teamId) {
      await ensureDiagrams(teamId);
      let view = { mode: 'list' };

      function listHtml() {
        const rows = diagrams.map(d => `
          <div class="listRow" data-id="${escapeHtml(d.id)}">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(d.title || 'Untitled')}</div>
              <div class="listRowSub">${d.markers.length} marker${d.markers.length === 1 ? '' : 's'}${d.note ? ' &middot; ' + escapeHtml(d.note) : ''}</div>
            </div>
          </div>`).join('');
        return `
          <div class="drillHero">
            <div class="drillHeroIcon">\u{1F4D0}</div>
            <div class="drillHeroTitle">Play Diagrams</div>
            <div class="drillHeroSub">Situational positioning to reference later -- tap the field to drop a labeled spot.</div>
          </div>
          <button class="btn" id="pdNew" style="width:100%;margin-bottom:14px;">+ New diagram</button>
          <div class="listBody">${rows || '<div class="emptyState">No play diagrams saved yet.</div>'}</div>`;
      }

      function markerHtml(m) {
        return `
          <button class="pdMarker" style="left:${m.x}%;top:${m.y}%;" data-marker="${escapeHtml(m.id)}">
            <span class="pdMarkerDot"></span>
            <span class="pdMarkerLabel">${escapeHtml(m.label)}</span>
          </button>`;
      }

      function editHtml(d) {
        return `
          <div class="sectionHeader">
            <button class="btn btnGhost btnSmall" id="pdBack">&larr; Diagrams</button>
            <div class="recordLine">${d.markers.length} marker${d.markers.length === 1 ? '' : 's'}</div>
          </div>
          <label class="drillFieldLabel">Title
            <input class="drillFreeInput" id="pdTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Bunt coverage -- runner on 1st">
          </label>
          <label class="drillFieldLabel" style="margin-top:10px;">Note (optional)
            <input class="drillFreeInput" id="pdNote" value="${escapeHtml(d.note || '')}" placeholder="Anything worth remembering about this one">
          </label>
          <div class="sectionLabel" style="margin-top:16px;">Field</div>
          <div class="helpText" style="margin-bottom:8px;">Tap an open spot to add a marker. Tap a marker to remove it.</div>
          <div class="depthField" id="pdField">
            ${window.DepthChart.fieldSvg()}
            ${d.markers.map(markerHtml).join('')}
          </div>
          <div class="sectionHeader" style="margin-top:16px;">
            <button class="btn" id="pdSave">Save diagram</button>
            <button class="btn btnDanger" id="pdDelete">Delete</button>
          </div>`;
      }

      function refresh() {
        if (view.mode === 'list') {
          containerEl.innerHTML = listHtml();
          containerEl.querySelector('#pdNew').addEventListener('click', () => {
            const d = { id: uid('pd'), title: '', note: '', markers: [] };
            diagrams.unshift(d);
            view = { mode: 'edit', id: d.id };
            refresh();
          });
          containerEl.querySelectorAll('.listRow').forEach(row => {
            row.addEventListener('click', () => { view = { mode: 'edit', id: row.dataset.id }; refresh(); });
          });
        } else {
          const d = diagrams.find(x => x.id === view.id);
          if (!d) { view = { mode: 'list' }; refresh(); return; }
          containerEl.innerHTML = editHtml(d);
          containerEl.querySelector('#pdBack').addEventListener('click', async () => {
            d.title = containerEl.querySelector('#pdTitle').value.trim();
            d.note = containerEl.querySelector('#pdNote').value.trim();
            await saveDiagrams();
            view = { mode: 'list' }; refresh();
          });
          containerEl.querySelector('#pdTitle').addEventListener('change', e => { d.title = e.target.value.trim(); });
          containerEl.querySelector('#pdNote').addEventListener('change', e => { d.note = e.target.value.trim(); });

          const field = containerEl.querySelector('#pdField');
          field.addEventListener('click', async e => {
            const rect = field.getBoundingClientRect();
            const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
            const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
            if (x < 0 || x > 100 || y < 0 || y > 100) return;
            const label = prompt('Label for this spot (e.g. "Cutoff man"):');
            if (!label || !label.trim()) return;
            d.markers.push({ id: uid('mk'), x, y, label: label.trim() });
            await saveDiagrams();
            refresh();
          });
          containerEl.querySelectorAll('[data-marker]').forEach(btn => {
            btn.addEventListener('click', async e => {
              e.stopPropagation();
              const i = d.markers.findIndex(m => m.id === btn.dataset.marker);
              if (i === -1) return;
              if (!confirm(`Remove "${d.markers[i].label}"?`)) return;
              d.markers.splice(i, 1);
              await saveDiagrams();
              refresh();
            });
          });

          containerEl.querySelector('#pdSave').addEventListener('click', async btnEvt => {
            d.title = containerEl.querySelector('#pdTitle').value.trim();
            d.note = containerEl.querySelector('#pdNote').value.trim();
            await withBusyButton(btnEvt.target, 'Saving...', saveDiagrams);
            btnEvt.target.textContent = '✓ Saved!';
            setTimeout(() => refresh(), 500);
          });
          containerEl.querySelector('#pdDelete').addEventListener('click', async () => {
            if (!confirm('Delete this play diagram?')) return;
            diagrams = diagrams.filter(x => x.id !== d.id);
            await saveDiagrams();
            view = { mode: 'list' }; refresh();
          });
        }
      }
      refresh();
    },
  };
})();
