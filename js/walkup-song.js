/* ============================================================
   Walk-up song -- the one song a player walks up to, picked by the
   coach on that player's edit screen (js/roster.js renderForm).

   Stored at teams/{teamId}/walkupSongs/{playerId} = {song, start?, at}:
   song is just the song's name as the league library names it
   ("Artist - Title" is enough), start is where to start it, in
   seconds. No audio is stored here and nothing about the player
   but the id. The field tablet (natesteele888/apps walkup/field.html)
   reads this and finds the song in its own song library by name.
   A coach saving it here is the approval; a song request a player
   sends in Walk-Up only lands here once a coach saves it.
   database.rules.json: coaches write, the team and approved field
   tablets read.
   ============================================================ */
(function () {
  const cache = {};
  const pending = {};
  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const data = await window.dbGet(window.teamPath(teamId, 'walkupSongs'));
        cache[teamId] = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        return cache[teamId];
      } finally { delete pending[teamId]; }
    })();
    return pending[teamId];
  }
  function fmt(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function parseStart(s) {
    s = String(s || '').trim();
    if (!s) return 0;
    const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
    const n = m ? (+m[1]) * 60 + (+m[2]) : Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 600 ? Math.round(n) : null;
  }

  window.WalkupSong = {
    ensureLoaded,
    async render(containerEl, teamId, playerId) {
      let all;
      try { all = await ensureLoaded(teamId); } catch (e) { containerEl.innerHTML = ''; return; }
      const cur = all[playerId] || null;
      containerEl.innerHTML = `
        <div class="sectionLabel" style="margin-top:18px;">Walk-up song</div>
        <div class="helpText" style="margin-bottom:8px;">The field tablet plays this when they come up. Use the song's name from the league library.</div>
        <div class="detailCard">
          <label>Song<input id="wsSong" maxlength="120" value="${escapeHtml(cur ? cur.song : '')}" placeholder="e.g. Artist - Song title"></label>
          <label>Start at <span style="font-size:11px;color:var(--text2);font-weight:400;">(minutes:seconds, optional)</span><input id="wsStart" inputmode="numeric" value="${cur && cur.start ? fmt(cur.start) : ''}" placeholder="0:00"></label>
          <div class="detailActions">
            <button class="btn btnSmall" id="wsSave">Save song</button>
            ${cur ? '<button class="btn btnGhost btnSmall" id="wsClear">Clear</button>' : ''}
          </div>
        </div>`;
      containerEl.querySelector('#wsSave').addEventListener('click', e => {
        const song = containerEl.querySelector('#wsSong').value.trim().slice(0, 120);
        const start = parseStart(containerEl.querySelector('#wsStart').value);
        if (start === null) { window.showToast('Start at should look like 0:35.'); return; }
        const path = window.teamPath(teamId, 'walkupSongs') + '/' + playerId;
        withBusyButton(e.target, 'Saving...', async () => {
          if (!song) { await window.dbPut(path, null); delete all[playerId]; }
          else {
            const v = { song, at: Date.now() };
            if (start) v.start = start;
            await window.dbPut(path, v); all[playerId] = v;
          }
          window.showToast('Walk-up song saved.');
          window.WalkupSong.render(containerEl, teamId, playerId);
        });
      });
      const clr = containerEl.querySelector('#wsClear');
      if (clr) clr.addEventListener('click', e => withBusyButton(e.target, 'Clearing...', async () => {
        await window.dbPut(window.teamPath(teamId, 'walkupSongs') + '/' + playerId, null);
        delete all[playerId];
        window.WalkupSong.render(containerEl, teamId, playerId);
      }));
    },
  };
})();
