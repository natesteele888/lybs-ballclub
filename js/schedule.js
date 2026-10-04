/* ============================================================
   Schedule -- games CRUD, modeled on the data shape and read-only-
   by-default UX the ASL Bengals audit found in that app's
   schedule.js, but without any of that file's football-specific
   narrative generation or hardcoded town-name opponent matching
   (not needed here -- this app only ever tracks one team's own
   schedule at a time, so "is this us" never comes up).

   Game shape: {id, opponent, date, arriveTime, gameTime, homeAway,
     location, ourScore, oppScore, notes, updatedAt,
     gameType ('regular' | 'playoff' | 'championship', default
       'regular' when unset -- old games saved before this field
       existed are just treated as regular season),
     pitchCounts: [{name, pitches}]}

   An upcoming game's detail view also links to the opponent's own
   macleague.org team page when js/league-teams.js can resolve one --
   that page is where MAC League already publishes a coach contact
   for exactly this ("game is rained out, need to reach them"), so
   this links out to it rather than scraping and storing any coach's
   phone number or email in this app ourselves.

   pitchCounts feeds js/pitch-smart.js's eligibility calculator --
   logged by the coach on each completed game's detail view; upcoming
   games show a pitcher-availability preview there instead (computed
   from this team's own logged counts, plus an opponent mirror when
   one exists).

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

  // Upcoming game (no score yet): pitcher-availability preview for both
  // sides. Completed game: shows/logs our own pitch counts for that game --
  // see js/pitch-smart.js for the eligibility math these feed into.
  async function renderPitchingSlot(teamId, game, slotEl, opts) {
    if (!slotEl) return;
    const division = (window.TeamConfig.current().macLeagueDivisionName) || null;
    await window.PitchSmart.ensureLoaded();
    const played = game.ourScore != null && game.oppScore != null;

    if (!played) {
      const games = window.Schedule.getGames(teamId);
      slotEl.innerHTML = `
        <div class="sectionLabel">${escapeHtml(window.TeamConfig.current().shortName || 'Our team')}</div>
        <div id="pitchOurSlot"></div>
        <div class="sectionLabel" style="margin-top:12px;">${escapeHtml(game.opponent || 'Opponent')}</div>
        <div id="pitchTheirSlot"></div>`;
      window.PitchSmart.renderOurEligibility(slotEl.querySelector('#pitchOurSlot'), games, division, game.date);
      window.PitchSmart.renderOpponentEligibility(slotEl.querySelector('#pitchTheirSlot'), game.opponent, division, game.date);
      return;
    }

    function renderLogged() {
      const logged = game.pitchCounts || [];
      const rows = logged.map((pc, i) => `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain"><div class="listRowTitle">${escapeHtml(pc.name)}</div></div>
          <span class="badge badgeTbd">${escapeHtml(String(pc.pitches))} pitches</span>
          ${opts.canEdit ? `<button class="btn btnTiny" data-i="${i}" title="Remove">&times;</button>` : ''}
        </div>`).join('') || '<div class="emptyState">No pitch counts logged for this game yet.</div>';
      const form = opts.canEdit ? `
        <div class="gcAddForm" style="margin-top:10px;">
          <div class="sectionLabel">Log a pitcher</div>
          <label>Pitcher name<input id="pcName" placeholder="First L"></label>
          <label>Pitches thrown<input id="pcPitches" type="number" min="0"></label>
          <button class="btn btnSmall" id="pcAddBtn">Add</button>
        </div>` : '';
      slotEl.innerHTML = `<div class="listBody">${rows}</div>${form}`;
      slotEl.querySelectorAll('button[data-i]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const i = Number(btn.dataset.i);
          game.pitchCounts = (game.pitchCounts || []).filter((_, idx) => idx !== i);
          await window.Schedule.saveGame(teamId, game);
          renderLogged();
        });
      });
      const addBtn = slotEl.querySelector('#pcAddBtn');
      if (addBtn) addBtn.addEventListener('click', async () => {
        const name = slotEl.querySelector('#pcName').value.trim();
        const pitches = Number(slotEl.querySelector('#pcPitches').value);
        if (!name || !Number.isFinite(pitches)) return;
        game.pitchCounts = (game.pitchCounts || []).concat([{ name, pitches }]);
        await window.Schedule.saveGame(teamId, game);
        renderLogged();
      });
    }
    renderLogged();
  }

  window.Schedule = {
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      const games = await window.dbGet(window.teamPath(teamId, 'schedule'));
      cache[teamId] = Array.isArray(games) ? games : [];
      await window.LeagueTeams.ensureLoaded();
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
      const ourName = (window.TeamConfig.current().shortName) || (window.TeamConfig.current().name) || 'Us';
      const rows = games.map(g => {
        const played = g.ourScore != null && g.oppScore != null;
        if (played) {
          const result = g.ourScore > g.oppScore ? 'W' : (g.ourScore < g.oppScore ? 'L' : 'T');
          const club = window.ClubLogos.find(g.opponent);
          const card = window.GameCard.resultHtml({
            date: g.date, homeAway: g.homeAway,
            ourName, ourScore: g.ourScore,
            theirName: g.opponent || 'TBD', theirScore: g.oppScore,
            theirLogoUrl: club ? club.logoUrl : null,
            result, gameType: g.gameType,
          });
          return `<div class="gameResultCardWrap" data-id="${escapeHtml(g.id)}" style="cursor:pointer;">${card}</div>`;
        }
        const tbdBadge = g.date < today ? '<span class="badge badgeTbd">?</span>' : '';
        const typeBadge = g.gameType === 'playoff' ? '<span class="badge gameTypeBadge gameTypePlayoff">Playoff</span>'
          : g.gameType === 'championship' ? '<span class="badge gameTypeBadge gameTypeChampionship">Championship</span>' : '';
        return `<div class="listRow" data-id="${escapeHtml(g.id)}">
          <div class="listRowMain">
            <div class="listRowTitle">${window.ClubLogos.badgeHtml(g.opponent, 18)}${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')} ${typeBadge}</div>
            <div class="listRowSub">${escapeHtml(g.date || '')}${g.gameTime ? ' · ' + escapeHtml(g.gameTime) : ''}${g.location ? ' · ' + escapeHtml(g.location) : ''}</div>
          </div>
          ${tbdBadge}
        </div>`;
      }).join('') || '<div class="emptyState">No games yet. Add the first one below.</div>';
      containerEl.innerHTML = `
        <div class="sectionHeader">
          <div><div class="recordLine">Season record: <b>${recStr}</b></div></div>
          ${opts.canEdit ? '<button class="btn btnSmall" id="addGameBtn">+ Add game</button>' : ''}
        </div>
        <div class="listBody">${rows}</div>`;
      containerEl.querySelectorAll('.listRow, .gameResultCardWrap').forEach(row => {
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
        const played = game.ourScore != null && game.oppScore != null;
        const theirLinkUrl = window.LeagueTeams.teamUrl(game.opponent);
        containerEl.innerHTML = `
          <div class="detailCard">
            <h3>${window.ClubLogos.badgeHtml(game.opponent, 26)}${game.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(game.opponent || 'TBD')}
              ${game.gameType === 'playoff' ? '<span class="badge gameTypeBadge gameTypePlayoff">Playoff</span>' : ''}
              ${game.gameType === 'championship' ? '<span class="badge gameTypeBadge gameTypeChampionship">Championship</span>' : ''}
            </h3>
            <div class="detailRow">${escapeHtml(game.date || '')}${game.gameTime ? ' · ' + escapeHtml(game.gameTime) : ''}</div>
            ${game.location ? `<div class="detailRow">📍 <a href="${mapLink(game.location)}" target="_blank" rel="noopener">${escapeHtml(game.location)}</a></div>` : ''}
            ${!played && theirLinkUrl ? `<div class="detailRow">☎️ <a href="${theirLinkUrl}" target="_blank" rel="noopener">${escapeHtml(game.opponent)}'s MAC League page</a> <span class="helpText" style="margin:0;display:inline;">&mdash; coach contact for weather/cancellation, straight from the league, not stored here</span></div>` : ''}
            ${(game.ourScore != null && game.oppScore != null) ? `<div class="detailRow"><b>Final: ${game.ourScore}-${game.oppScore}</b></div>` : ''}
            ${game.notes ? `<div class="detailRow">${escapeHtml(game.notes)}</div>` : ''}
            <div id="weatherSlot"></div>
            <div class="sectionLabel" style="margin-top:16px;">Pitching</div>
            <div id="pitchingSlot"></div>
            <div class="detailActions">
              ${opts.canEdit ? '<button class="btn" id="editBtn">Edit</button>' : ''}
              <button class="btn btnGhost" id="icsBtn">Add to calendar</button>
              <button class="btn btnGhost" id="backBtn">Back</button>
            </div>
          </div>`;
        const weatherSlot = containerEl.querySelector('#weatherSlot');
        if (weatherSlot && game.location && game.date) window.loadWeatherInto(weatherSlot, game.location, game.date, game.gameTime);
        renderPitchingSlot(teamId, game, containerEl.querySelector('#pitchingSlot'), opts);
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
            <label>Game type
              <select id="fGameType">
                <option value="regular" ${!game.gameType || game.gameType === 'regular' ? 'selected' : ''}>Regular season</option>
                <option value="playoff" ${game.gameType === 'playoff' ? 'selected' : ''}>Playoff</option>
                <option value="championship" ${game.gameType === 'championship' ? 'selected' : ''}>Championship</option>
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
            gameType: containerEl.querySelector('#fGameType').value,
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
