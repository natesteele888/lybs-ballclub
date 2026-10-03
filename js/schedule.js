/* ============================================================
   Schedule -- games CRUD, modeled on the data shape and read-only-
   by-default UX the ASL Bengals audit found in that app's
   schedule.js, but without any of that file's football-specific
   narrative generation or hardcoded town-name opponent matching
   (not needed here -- this app only ever tracks one team's own
   schedule at a time, so "is this us" never comes up).

   Game shape: {id, opponent, date, arriveTime, gameTime, homeAway,
     location, ourScore, oppScore, notes, updatedAt}

   Exposes:
     window.Schedule.ensureLoaded(teamId)   -- async, populates cache
     window.Schedule.getGames(teamId)       -- sync, cached array
     window.Schedule.saveGame(teamId, game) -- async upsert (by id)
     window.Schedule.deleteGame(teamId, id) -- async
     window.Schedule.record(teamId)         -- {wins, losses, ties}
     window.Schedule.renderList(teamId, containerEl, opts)
     window.Schedule.renderDetail(teamId, game, containerEl, opts)
   ============================================================ */
(function () {
  const cache = {}; // teamId -> games[]

  function uid() { return 'g' + Date.now() + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function mapLink(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
  }

  window.Schedule = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const games = await window.dbGet(window.teamPath(teamId, 'schedule'));
      cache[teamId] = Array.isArray(games) ? games : [];
      return cache[teamId];
    },
    getGames(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    },
    async saveGame(teamId, game) {
      const list = cache[teamId] || (cache[teamId] = []);
      game.updatedAt = new Date().toISOString();
      const idx = list.findIndex(g => g.id === game.id);
      if (idx === -1) {
        game.id = game.id || uid();
        list.push(game);
      } else {
        list[idx] = game;
      }
      await window.dbPut(window.teamPath(teamId, 'schedule'), list);
      return game;
    },
    async deleteGame(teamId, id) {
      const list = cache[teamId] || [];
      cache[teamId] = list.filter(g => g.id !== id);
      await window.dbPut(window.teamPath(teamId, 'schedule'), cache[teamId]);
    },
    record(teamId) {
      let wins = 0, losses = 0, ties = 0;
      (cache[teamId] || []).forEach(g => {
        if (g.ourScore == null || g.oppScore == null) return;
        if (g.ourScore > g.oppScore) wins++;
        else if (g.ourScore < g.oppScore) losses++;
        else ties++;
      });
      return { wins, losses, ties };
    },

    renderList(teamId, containerEl, opts) {
      opts = opts || {};
      const games = window.Schedule.getGames(teamId);
      const rec = window.Schedule.record(teamId);
      const recStr = rec.ties ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`;
      const today = new Date().toISOString().slice(0, 10);
      const rows = games.map(g => {
        const played = g.ourScore != null && g.oppScore != null;
        const badge = played
          ? `<span class="badge ${g.ourScore > g.oppScore ? 'badgeW' : (g.ourScore < g.oppScore ? 'badgeL' : 'badgeT')}">${g.ourScore > g.oppScore ? 'W' : (g.ourScore < g.oppScore ? 'L' : 'T')} ${g.ourScore}-${g.oppScore}</span>`
          : (g.date < today ? '<span class="badge badgeTbd">?</span>' : '');
        return `<div class="listRow" data-id="${escapeHtml(g.id)}">
          <div class="listRowMain">
            <div class="listRowTitle">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')}</div>
            <div class="listRowSub">${escapeHtml(g.date || '')}${g.gameTime ? ' · ' + escapeHtml(g.gameTime) : ''}${g.location ? ' · ' + escapeHtml(g.location) : ''}</div>
          </div>
          ${badge}
        </div>`;
      }).join('') || '<div class="emptyState">No games yet. Add the first one below.</div>';
      containerEl.innerHTML = `
        <div class="sectionHeader">
          <div><div class="recordLine">Season record: <b>${recStr}</b></div></div>
          ${opts.canEdit ? '<button class="btn btnSmall" id="addGameBtn">+ Add game</button>' : ''}
        </div>
        <div class="listBody">${rows}</div>`;
      containerEl.querySelectorAll('.listRow').forEach(row => {
        row.addEventListener('click', () => opts.onOpen && opts.onOpen(row.dataset.id));
      });
      if (opts.canEdit) {
        const addBtn = containerEl.querySelector('#addGameBtn');
        if (addBtn) addBtn.addEventListener('click', () => opts.onAdd && opts.onAdd());
      }
    },

    renderDetail(teamId, game, containerEl, opts) {
      opts = opts || {};
      const editing = !!opts.editing;
      if (!editing) {
        containerEl.innerHTML = `
          <div class="detailCard">
            <h3>${game.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(game.opponent || 'TBD')}</h3>
            <div class="detailRow">${escapeHtml(game.date || '')}${game.gameTime ? ' · ' + escapeHtml(game.gameTime) : ''}</div>
            ${game.location ? `<div class="detailRow">📍 <a href="${mapLink(game.location)}" target="_blank" rel="noopener">${escapeHtml(game.location)}</a></div>` : ''}
            ${(game.ourScore != null && game.oppScore != null) ? `<div class="detailRow"><b>Final: ${game.ourScore}-${game.oppScore}</b></div>` : ''}
            ${game.notes ? `<div class="detailRow">${escapeHtml(game.notes)}</div>` : ''}
            <div id="weatherSlot"></div>
            <div class="detailActions">
              ${opts.canEdit ? '<button class="btn" id="editBtn">Edit</button>' : ''}
              <button class="btn btnGhost" id="icsBtn">Add to calendar</button>
              <button class="btn btnGhost" id="backBtn">Back</button>
            </div>
          </div>`;
        const weatherSlot = containerEl.querySelector('#weatherSlot');
        if (weatherSlot && game.location && game.date) window.loadWeatherInto(weatherSlot, game.location, game.date, game.gameTime);
        const editBtn = containerEl.querySelector('#editBtn');
        if (editBtn) editBtn.addEventListener('click', () => opts.onEdit && opts.onEdit());
        containerEl.querySelector('#icsBtn').addEventListener('click', () => {
          const ics = window.buildICS([{
            uid: game.id, title: `${window.TeamConfig.current().shortName} ${game.homeAway === 'Away' ? '@' : 'vs'} ${game.opponent || 'TBD'}`,
            date: game.date, time: game.gameTime, location: game.location, description: game.notes,
          }]);
          window.downloadICS(`${game.opponent || 'game'}.ics`, ics);
        });
        containerEl.querySelector('#backBtn').addEventListener('click', () => opts.onBack && opts.onBack());
      } else {
        containerEl.innerHTML = `
          <div class="detailCard">
            <label>Opponent<input id="fOpponent" value="${escapeHtml(game.opponent || '')}"></label>
            <label>Home or Away
              <select id="fHomeAway">
                <option value="Home" ${game.homeAway !== 'Away' ? 'selected' : ''}>Home</option>
                <option value="Away" ${game.homeAway === 'Away' ? 'selected' : ''}>Away</option>
              </select>
            </label>
            <label>Date<input type="date" id="fDate" value="${escapeHtml(game.date || '')}"></label>
            <label>Game time<input type="time" id="fGameTime" value="${escapeHtml(game.gameTime || '')}"></label>
            <label>Location / address<input id="fLocation" value="${escapeHtml(game.location || '')}"></label>
            <label>Our score<input type="number" id="fOurScore" value="${game.ourScore != null ? game.ourScore : ''}"></label>
            <label>Opponent score<input type="number" id="fOppScore" value="${game.oppScore != null ? game.oppScore : ''}"></label>
            <label>Notes<textarea id="fNotes">${escapeHtml(game.notes || '')}</textarea></label>
            <div class="detailActions">
              <button class="btn" id="saveBtn">Save</button>
              <button class="btn btnGhost" id="cancelBtn">Cancel</button>
              ${game.id && opts.onDelete ? '<button class="btn btnDanger" id="deleteBtn">Delete</button>' : ''}
            </div>
          </div>`;
        containerEl.querySelector('#saveBtn').addEventListener('click', () => {
          const updated = Object.assign({}, game, {
            opponent: containerEl.querySelector('#fOpponent').value.trim(),
            homeAway: containerEl.querySelector('#fHomeAway').value,
            date: containerEl.querySelector('#fDate').value,
            gameTime: containerEl.querySelector('#fGameTime').value,
            location: containerEl.querySelector('#fLocation').value.trim(),
            notes: containerEl.querySelector('#fNotes').value.trim(),
          });
          const our = containerEl.querySelector('#fOurScore').value;
          const opp = containerEl.querySelector('#fOppScore').value;
          updated.ourScore = our === '' ? null : Number(our);
          updated.oppScore = opp === '' ? null : Number(opp);
          opts.onSave && opts.onSave(updated);
        });
        containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
        const deleteBtn = containerEl.querySelector('#deleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(game.id));
      }
    },
  };
})();
