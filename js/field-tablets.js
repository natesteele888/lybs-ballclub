/* ============================================================
   Field tablets -- board-only list of the walk-up tablets at the
   field (natesteele888/apps walkup/field.html, "Field mode").

   A field tablet never gets a team code. It signs in anonymously,
   shows a 6-letter code on its screen and asks to be let in by
   writing fieldKioskRequests/{uid} = {code, label, at}. A board
   member matches the code here and taps Let in, which writes
   fieldKiosks/{uid} = {ok: true, code, label, at} and clears the
   request in one atomic update. From then on database.rules.json
   lets that tablet READ only what game day needs, for every team:
   teams/{id}/roster, lineups, schedule, gcTeamId,
   gameChangerSchedule and walkupSongs. It can't write any team data,
   and it can't read coach notes, contacts, access or anything else.
   Remove deletes the grant; the tablet stops loading new data at once
   (it keeps what it already saved for today's games).
   ============================================================ */
(function () {
  function when(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function rows(obj) {
    return Object.keys(obj && typeof obj === 'object' ? obj : {})
      .filter(uid => /^[A-Za-z0-9_-]{6,128}$/.test(uid) && obj[uid] && typeof obj[uid] === 'object')
      .map(uid => Object.assign({ uid }, obj[uid]))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  window.FieldTablets = {
    async render(containerEl) {
      containerEl.innerHTML = '<div class="sectionLabel" style="margin-top:22px;">Field tablets</div><div class="emptyState">Loading&hellip;</div>';
      let asks = {}, ok = {};
      try {
        [asks, ok] = await Promise.all([window.dbGet('fieldKioskRequests'), window.dbGet('fieldKiosks')]);
      } catch (e) {
        containerEl.innerHTML = '<div class="sectionLabel" style="margin-top:22px;">Field tablets</div><div class="emptyState">Couldn\'t load the field tablets.</div>';
        return;
      }
      const pending = rows(asks), letIn = rows(ok).filter(r => r.ok === true);
      const row = (r, btn) => `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain">
            <div class="listRowTitle">${escapeHtml(r.label || 'Field tablet')} &middot; <span style="font-family:monospace;letter-spacing:2px;">${escapeHtml(r.code || '------')}</span></div>
            <div class="listRowSub">${escapeHtml(when(r.at))}</div>
          </div>
          ${btn}
        </div>`;
      containerEl.innerHTML = `
        <div class="sectionLabel" style="margin-top:22px;">Field tablets</div>
        <div class="helpText">A walk-up tablet at the field shows a 6-letter code. Let it in here when the code matches, and it can load every team's roster, lineups, schedule and walk-up songs for game day. It can't change anything.</div>
        ${pending.length ? `<div class="listBody" style="margin-top:10px;">${pending.map(r => row(r, `<button class="btn btnSmall" data-ft-ok="${escapeHtml(r.uid)}">Let in</button>`)).join('')}</div>` : '<div class="helpText" style="margin-top:8px;">No tablets waiting.</div>'}
        ${letIn.length ? `<div class="sectionLabel" style="margin-top:14px;">Let in</div><div class="listBody">${letIn.map(r => row(r, `<button class="btn btnGhost btnSmall" data-ft-off="${escapeHtml(r.uid)}">Remove</button>`)).join('')}</div>` : ''}`;
      containerEl.querySelectorAll('[data-ft-ok]').forEach(b => b.addEventListener('click', e => {
        const r = pending.find(x => x.uid === b.dataset.ftOk); if (!r) return;
        const grant = { ok: true, code: r.code, at: Date.now() };
        if (r.label) grant.label = String(r.label).slice(0, 40);
        withBusyButton(e.target, 'Letting in...', async () => {
          await window.dbUpdate({ [`fieldKiosks/${r.uid}`]: grant, [`fieldKioskRequests/${r.uid}`]: null });
          window.showToast('Tablet let in.');
          window.FieldTablets.render(containerEl);
        });
      }));
      containerEl.querySelectorAll('[data-ft-off]').forEach(b => b.addEventListener('click', e => {
        const uid = b.dataset.ftOff;
        withBusyButton(e.target, 'Removing...', async () => {
          await window.dbPut(`fieldKiosks/${uid}`, null);
          window.showToast('Tablet removed.');
          window.FieldTablets.render(containerEl);
        });
      }));
    },
  };
})();
