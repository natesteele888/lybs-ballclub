/* ============================================================
   Team Awards -- end-of-season (or anytime) recognition. Coach adds
   award categories (a short preset list to start from, or any custom
   name) and assigns one roster player to each; everyone sees who won
   what, same visibility rule as Game Ball -- a highlight only the
   coach could see wouldn't be much of one.

   Stored at teams/{teamId}/awards = [{id, category, playerId,
   playerName}], coach-write-only (unlike RSVP/Carpool/Sign-Up, a
   player doesn't get to assign their own award). playerId/playerName
   are absent until the coach picks a winner -- an added-but-unassigned
   category shows "Not yet announced" to everyone rather than being
   hidden, so the list of categories itself can be set up ahead of an
   awards night and filled in live.
   ============================================================ */
(function () {
  const PRESETS = ['MVP', "Coach's Award", 'Most Improved', 'Golden Glove', 'Best Hustle', 'Best Teammate', 'Rookie of the Year'];

  const cache = {}; // teamId -> awards[]

  window.Awards = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const data = await window.dbGet(window.teamPath(teamId, 'awards'));
      cache[teamId] = Array.isArray(data) ? data : [];
      return cache[teamId];
    },
    async save(teamId) {
      await window.dbPut(window.teamPath(teamId, 'awards'), cache[teamId]);
    },

    render(containerEl, teamId, opts) {
      opts = opts || {};
      const roster = opts.roster || [];
      const awards = cache[teamId];
      let expanded = null; // award id whose winner-picker is open
      let addingCustom = false;

      function awardCardHtml(award) {
        const isOpen = expanded === award.id;
        return `
          <div class="detailCard" style="margin-bottom:12px;">
            <div class="sectionHeader" style="align-items:flex-start;">
              <div>
                <h3 style="margin:0 0 4px;">${escapeHtml(award.category)}</h3>
                ${award.playerName
                  ? `<div class="listRowTitle"><span class="popReveal">&#127942;</span> ${escapeHtml(award.playerName)}</div>`
                  : '<div class="emptyState" style="padding:0;">Not yet announced</div>'}
              </div>
              ${opts.canEdit ? `
                <div style="display:flex; gap:8px; flex:0 0 auto;">
                  <button class="btn btnGhost btnTiny" data-editaward="${award.id}">${isOpen ? 'Close' : (award.playerName ? 'Change' : 'Assign')}</button>
                  <button class="btn btnGhost btnTiny" data-deleteaward="${award.id}">&times;</button>
                </div>` : ''}
            </div>
            ${isOpen ? `
              ${roster.length ? `
                <div class="drillChipRow" style="margin-top:12px;">
                  ${roster.map(p => `<button class="drillChip ${award.playerId === p.id ? 'drillChipOn' : ''}" data-pickwinner="${award.id}" data-pid="${escapeHtml(p.id)}" data-pname="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join('')}
                </div>` : '<div class="emptyState">Add players to the roster first.</div>'}
              ${award.playerName ? `<button class="btn btnGhost btnTiny" style="margin-top:10px;" data-clearwinner="${award.id}">Clear</button>` : ''}
            ` : ''}
          </div>`;
      }

      function addRowHtml() {
        if (!opts.canEdit) return '';
        if (!addingCustom) {
          const used = new Set(awards.map(a => a.category));
          const available = PRESETS.filter(p => !used.has(p));
          return `
            <div class="sectionLabel" style="margin-top:18px;">Add Award</div>
            <div class="drillChipRow">
              ${available.map(p => `<button class="drillChip" data-addpreset="${escapeHtml(p)}">+ ${escapeHtml(p)}</button>`).join('')}
              <button class="drillChip" id="awardsAddCustom">+ Custom&hellip;</button>
            </div>`;
        }
        return `
          <div class="sectionLabel" style="margin-top:18px;">Add Award</div>
          <div class="drillAddRow">
            <input class="drillFreeInput" id="awardsCustomInput" placeholder="Award name, e.g. Clutch Hitter" maxlength="40" autofocus>
            <button class="btn btnSmall" id="awardsCustomSave">Add</button>
          </div>`;
      }

      function refresh() {
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">Team Awards</div>
            <div class="drillHeroSub">Season-end recognition for the team.</div>
          </div>
          ${awards.length ? awards.map(awardCardHtml).join('') : '<div class="emptyState">No awards set up yet.</div>'}
          ${addRowHtml()}`;

        containerEl.querySelectorAll('[data-editaward]').forEach(btn => {
          btn.addEventListener('click', () => {
            expanded = expanded === btn.dataset.editaward ? null : btn.dataset.editaward;
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-deleteaward]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this award category?')) return;
            const i = awards.findIndex(a => a.id === btn.dataset.deleteaward);
            if (i !== -1) awards.splice(i, 1);
            if (expanded === btn.dataset.deleteaward) expanded = null;
            await window.Awards.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-pickwinner]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const award = awards.find(a => a.id === btn.dataset.pickwinner);
            if (!award) return;
            award.playerId = btn.dataset.pid;
            award.playerName = btn.dataset.pname;
            await window.Awards.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-clearwinner]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const award = awards.find(a => a.id === btn.dataset.clearwinner);
            if (!award) return;
            delete award.playerId;
            delete award.playerName;
            await window.Awards.save(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-addpreset]').forEach(btn => {
          btn.addEventListener('click', async () => {
            awards.push({ id: 'aw_' + Math.random().toString(36).slice(2, 10), category: btn.dataset.addpreset });
            await window.Awards.save(teamId);
            refresh();
          });
        });
        const customBtn = containerEl.querySelector('#awardsAddCustom');
        if (customBtn) customBtn.addEventListener('click', () => { addingCustom = true; refresh(); });
        const customSave = containerEl.querySelector('#awardsCustomSave');
        if (customSave) {
          customSave.addEventListener('click', async () => {
            const input = containerEl.querySelector('#awardsCustomInput');
            const name = (input.value || '').trim();
            addingCustom = false;
            if (name) {
              awards.push({ id: 'aw_' + Math.random().toString(36).slice(2, 10), category: name });
              await window.Awards.save(teamId);
            }
            refresh();
          });
        }
      }
      refresh();
    },
  };
})();
