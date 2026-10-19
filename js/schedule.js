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
     status ('postponed' | 'cancelled', default unset/scheduled --
       same "absent means normal" convention as gameType. Coach sets
       this by hand and clears it by hand too once a postponed game's
       date is edited to the makeup date -- no auto-detection, same
       as every other manual field here),
     pitchCounts: [{name, pitches}],
     rsvps: {name: 'in'|'out'}, driving: {name: seatsOpenForTeammates},
     gameBall: {playerId, name} | null}

   driving (see js/util.js's carpoolHtml/wireCarpool) only ever renders
   for an upcoming Away game -- a home game doesn't need a ride.
   gameBall is the mirror case: only ever renders once a game is played.

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
  const pending = {}; // teamId -> in-flight ensureLoaded() promise

  // Public-mirror projection for js/public-view.js's no-sign-in schedule
  // panel -- see js/backend.js's publicSchedulePath() header comment.
  // Deliberately an allowlist, not an exclusion list: a field added to the
  // real game shape above should NOT show up here unless someone
  // deliberately adds it below. Excluded on purpose: notes, pitchCounts,
  // rsvps, driving, gameBall -- every one of those can carry a player's name.
  function toPublicGame(g) {
    return {
      id: g.id, opponent: g.opponent, date: g.date, arriveTime: g.arriveTime,
      gameTime: g.gameTime, homeAway: g.homeAway, location: g.location,
      gameType: g.gameType, status: g.status, ourScore: g.ourScore, oppScore: g.oppScore,
    };
  }

  // Game Ball -- a completed-game-only highlight (game.gameBall =
  // {playerId, name} or null), same "attached to the item" shape as rsvps/
  // driving. Coach picks it from the roster opts.roster carries in (see
  // index.html's renderScheduleTab, which now loads Roster alongside
  // Schedule/Practices for exactly this); everyone sees who got it, same
  // visibility rule as the RSVP headcount -- a highlight only the coach
  // could see wouldn't be much of one.
  function gameBallHtml(game, opts) {
    const roster = opts.roster || [];
    return `
      <div class="sectionLabel" style="margin-top:16px;">Game Ball</div>
      ${game.gameBall ? `
        <div class="detailRow">${escapeHtml(game.gameBall.name)}</div>
        ${opts.canEdit ? '<button class="btn btnGhost btnTiny" id="gbClear" style="margin-top:6px;">Clear</button>' : ''}
        ` : (opts.canEdit ? `
        ${roster.length ? `
          <div class="drillChipRow">
            ${roster.map(p => `<button class="drillChip" data-gameball="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join('')}
          </div>` : '<div class="emptyState">Add players to the roster first.</div>'}
        ` : '<div class="emptyState">No game ball given yet.</div>')}`;
  }
  function wireGameBall(containerEl, teamId, game, opts) {
    containerEl.querySelectorAll('[data-gameball]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const updated = Object.assign({}, game, { gameBall: { playerId: btn.dataset.gameball, name: btn.dataset.name } });
        await window.Schedule.saveGame(teamId, updated);
        if (opts.onItemChange) opts.onItemChange();
      });
    });
    const clearBtn = containerEl.querySelector('#gbClear');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      const updated = Object.assign({}, game, { gameBall: null });
      await window.Schedule.saveGame(teamId, updated);
      if (opts.onItemChange) opts.onItemChange();
    });
  }

  // Opponent's coach contact for an upcoming game -- straight from
  // js/team-details.js's mirror of their own public macleague.org page
  // (name/role, plus phone/email ONLY when that team's own page actually
  // publishes them), not a link out to go read it there. Same fire-and-
  // forget-after-the-main-render pattern as renderPitchingSlot/
  // loadWeatherInto just below/above.
  async function renderTheirContactSlot(opponentName, slotEl) {
    await Promise.all([window.LeagueTeams.ensureLoaded(), window.TeamDetails.ensureLoaded()]);
    const match = window.LeagueTeams.find(opponentName, window.TeamConfig.current().macLeagueDivisionId);
    const details = match ? window.TeamDetails.getTeam(match.teamId) : null;
    if (!slotEl.isConnected) return; // the coach already navigated away
    if (!details || !details.staff.length) { slotEl.innerHTML = ''; return; }
    slotEl.innerHTML = `
      <div class="detailRow" style="display:flex;flex-direction:column;gap:4px;">
        ${details.staff.map(s => `<div>${escapeHtml(s.name || 'Unknown')}${s.role ? ' &middot; ' + escapeHtml(s.role) : ''}${s.phone ? ' &middot; ' + escapeHtml(s.phone) : ''}${s.emailUrl ? ` &middot; <a href="${escapeHtml(s.emailUrl)}" target="_blank" rel="noopener">Email</a>` : ''}</div>`).join('')}
      </div>`;
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
      window.PitchSmart.renderOurEligibility(slotEl.querySelector('#pitchOurSlot'), games, division, game.date, teamId);
      window.PitchSmart.renderOpponentEligibility(slotEl.querySelector('#pitchTheirSlot'), game.opponent, division, game.date);
      return;
    }

    function renderLogged() {
      const logged = game.pitchCounts || [];
      // Every entry gets a stable id -- including ones logged before this
      // existed -- so its remove button can filter by identity instead of
      // array position. Position breaks when two different rows get
      // removed in quick succession: the first click's filter runs
      // synchronously and shrinks game.pitchCounts before its own await
      // even resolves, so the second click's index (captured from the
      // pre-removal render) no longer points at the row its button was
      // actually on. Assigned only in memory here, not written on its
      // own -- it rides along naturally the next time anything saves.
      logged.forEach(pc => { if (!pc.id) pc.id = uid('pc'); });
      const rows = logged.map(pc => `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain"><div class="listRowTitle">${escapeHtml(pc.name)}</div></div>
          <span class="badge badgeTbd">${escapeHtml(String(pc.pitches))} pitches</span>
          ${opts.canEdit ? `<button class="btn btnTiny" data-pcid="${escapeHtml(pc.id)}" title="Remove">&times;</button>` : ''}
        </div>`).join('') || '<div class="emptyState">No pitch counts logged for this game yet.</div>';
      const form = opts.canEdit ? `
        <div class="gcAddForm" style="margin-top:10px;">
          <div class="sectionLabel">Log a pitcher</div>
          <label>Pitcher name<input id="pcName" placeholder="First L"></label>
          <label>Pitches thrown<input id="pcPitches" type="number" min="0"></label>
          <button class="btn btnSmall" id="pcAddBtn">Add</button>
        </div>` : '';
      slotEl.innerHTML = `<div class="listBody">${rows}</div>${form}`;
      slotEl.querySelectorAll('button[data-pcid]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const removedId = btn.dataset.pcid;
          btn.disabled = true;
          game.pitchCounts = (game.pitchCounts || []).filter(pc => pc.id !== removedId);
          await window.Schedule.saveGame(teamId, game);
          renderLogged();
        });
      });
      const addBtn = slotEl.querySelector('#pcAddBtn');
      if (addBtn) addBtn.addEventListener('click', async () => {
        const typed = slotEl.querySelector('#pcName').value.trim();
        const pitches = Number(slotEl.querySelector('#pcPitches').value);
        if (!typed || !Number.isFinite(pitches)) return;
        // Resolve against the roster before storing -- js/pitch-smart.js's
        // eligibility math groups appearances by this exact name string
        // (appearancesByPitcher), with no roster/id tie at all. A free-typed
        // field with no normalization means the SAME real pitcher logged as
        // "Jake T" on Monday and "Jake T." (or just a typo) on Wednesday
        // becomes two unrelated histories -- Wednesday's pitches never
        // count against Monday's rest-day clock, and a pitcher who should
        // still be resting can silently show eligible. toFirstLastInitial
        // is the same canonicalizer js/stats-import.js already uses to match
        // an uploaded GameChanger name against this same roster; reusing it
        // here keeps one pitcher's name consistent across every game log
        // rather than inventing a second normalization scheme. Falls back
        // to the typed text verbatim for a non-roster call-up/guest pitcher,
        // or when the typed name is ambiguous against the roster (matches
        // more than one player) -- same "don't guess" rule matchRosterPlayer
        // itself follows.
        const canon = s => window.StatsImport.toFirstLastInitial(s).toLowerCase();
        const matches = (opts.roster || []).filter(p => canon(p.name) === canon(typed));
        const name = matches.length === 1 ? matches[0].name : typed;
        game.pitchCounts = (game.pitchCounts || []).concat([{ id: uid('pc'), name, pitches }]);
        await window.Schedule.saveGame(teamId, game);
        renderLogged();
      });
    }
    renderLogged();
  }

  window.Schedule = {
    // Caches the in-flight fetch, not just the resolved value -- same
    // reason as js/roster.js's ensureLoaded(): without this, tapping away
    // from this tab and back before the first dbGet resolves starts a
    // second one, and whichever resolves last clobbers cache[teamId] with
    // its own snapshot, silently reverting any edit saved in between.
    async ensureLoaded(teamId) {
      if (cache[teamId]) return cache[teamId];
      if (pending[teamId]) return pending[teamId];
      pending[teamId] = (async () => {
        try {
          const games = await window.dbGet(window.teamPath(teamId, 'schedule'));
          cache[teamId] = Array.isArray(games) ? games : [];
          await window.LeagueTeams.ensureLoaded();
          return cache[teamId];
        } finally {
          delete pending[teamId];
        }
      })();
      return pending[teamId];
    },
    getGames(teamId) {
      return (cache[teamId] || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    },
    async saveGame(teamId, game) {
      const list = cache[teamId] || (cache[teamId] = []);
      game.updatedAt = new Date().toISOString();
      const idx = list.findIndex(g => g.id === game.id);
      if (idx === -1) {
        game.id = game.id || uid('g');
        list.push(game);
      } else {
        list[idx] = game;
      }
      await Promise.all([
        window.dbPut(window.teamPath(teamId, 'schedule'), list),
        window.dbPut(window.publicSchedulePath(teamId, 'games'), list.map(toPublicGame)),
      ]);
      return game;
    },
    async deleteGame(teamId, id) {
      const list = cache[teamId] || [];
      cache[teamId] = list.filter(g => g.id !== id);
      await Promise.all([
        window.dbPut(window.teamPath(teamId, 'schedule'), cache[teamId]),
        window.dbPut(window.publicSchedulePath(teamId, 'games'), cache[teamId].map(toPublicGame)),
      ]);
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
      const today = todayIso();
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
        const statusBadge = g.status === 'postponed' ? '<span class="badge badgeTbd">Postponed</span>'
          : g.status === 'cancelled' ? '<span class="badge badgeTbd">Cancelled</span>' : '';
        const tbdBadge = !statusBadge && g.date < today ? '<span class="badge badgeTbd">?</span>' : '';
        const typeBadge = g.gameType === 'playoff' ? '<span class="badge gameTypeBadge gameTypePlayoff">Playoff</span>'
          : g.gameType === 'championship' ? '<span class="badge gameTypeBadge gameTypeChampionship">Championship</span>' : '';
        return `<div class="listRow" data-id="${escapeHtml(g.id)}" style="${g.status === 'cancelled' ? 'opacity:0.55;' : ''}">
          <div class="listRowMain">
            <div class="listRowTitle"><span class="standingsTeamLink" data-team-nav="${escapeHtml(g.opponent || '')}" tabindex="0" role="button" title="See ${escapeHtml(g.opponent || 'this team')}'s team page">${window.ClubLogos.badgeHtml(g.opponent, 18)}${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')}</span> ${typeBadge}</div>
            <div class="listRowSub">${escapeHtml(g.date || '')}${g.gameTime ? ' · ' + escapeHtml(g.gameTime) : ''}${g.location ? ' · ' + escapeHtml(g.location) : ''}</div>
          </div>
          ${statusBadge}${tbdBadge}
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
        containerEl.innerHTML = `
          <div class="detailCard">
            <h3><span class="standingsTeamLink" data-team-nav="${escapeHtml(game.opponent || '')}" tabindex="0" role="button" title="See ${escapeHtml(game.opponent || 'this team')}'s team page">${window.ClubLogos.badgeHtml(game.opponent, 26)}${game.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(game.opponent || 'TBD')}</span>
              ${game.gameType === 'playoff' ? '<span class="badge gameTypeBadge gameTypePlayoff">Playoff</span>' : ''}
              ${game.gameType === 'championship' ? '<span class="badge gameTypeBadge gameTypeChampionship">Championship</span>' : ''}
            </h3>
            <div class="detailRow">${escapeHtml(game.date || '')}${game.gameTime ? ' · ' + escapeHtml(game.gameTime) : ''}</div>
            ${game.status === 'postponed' ? '<div class="detailRow" style="color:var(--gold);"><b>Postponed</b> &mdash; edit the date once a makeup is set.</div>' : ''}
            ${game.status === 'cancelled' ? '<div class="detailRow" style="color:var(--status-red);"><b>Cancelled</b></div>' : ''}
            ${game.location ? `
            <div class="detailRow">${escapeHtml(game.location)}</div>
            <iframe class="inlineMapFrame" src="https://maps.google.com/maps?q=${encodeURIComponent(game.location)}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map"></iframe>
            <a class="btn btnGhost btnSmall" style="width:100%;margin:8px 0 12px;" href="${mapLink(game.location)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}
            ${!played && game.opponent ? '<div id="theirContactSlot"></div>' : ''}
            ${(game.ourScore != null && game.oppScore != null) ? `<div class="detailRow"><b>Final: ${game.ourScore}-${game.oppScore}</b></div>` : ''}
            ${game.notes ? `<div class="detailRow">${escapeHtml(game.notes)}</div>` : ''}
            <div id="weatherSlot"></div>
            ${!played && game.status !== 'cancelled' ? rsvpHtml(game, opts.viewerName, opts.canEdit) : ''}
            ${!played && game.status !== 'cancelled' && game.homeAway === 'Away' ? carpoolHtml(game, opts.viewerName) : ''}
            ${played ? gameBallHtml(game, opts) : ''}
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
        const contactSlot = containerEl.querySelector('#theirContactSlot');
        if (contactSlot) renderTheirContactSlot(game.opponent, contactSlot);
        if (!played) wireRsvp(containerEl, game, opts.viewerName, updated => window.Schedule.saveGame(teamId, updated), opts.onItemChange);
        if (!played && game.homeAway === 'Away') wireCarpool(containerEl, game, opts.viewerName, updated => window.Schedule.saveGame(teamId, updated), opts.onItemChange);
        if (played) wireGameBall(containerEl, teamId, game, opts);
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
            <label>Status
              <select id="fStatus">
                <option value="" ${!game.status ? 'selected' : ''}>Scheduled</option>
                <option value="postponed" ${game.status === 'postponed' ? 'selected' : ''}>Postponed</option>
                <option value="cancelled" ${game.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
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
        containerEl.querySelector('#saveBtn').addEventListener('click', btnEvt => {
          const updated = Object.assign({}, game, {
            opponent: containerEl.querySelector('#fOpponent').value.trim(),
            homeAway: containerEl.querySelector('#fHomeAway').value,
            gameType: containerEl.querySelector('#fGameType').value,
            status: containerEl.querySelector('#fStatus').value || undefined,
            date: containerEl.querySelector('#fDate').value,
            gameTime: containerEl.querySelector('#fGameTime').value,
            location: containerEl.querySelector('#fLocation').value.trim(),
            notes: containerEl.querySelector('#fNotes').value.trim(),
          });
          const our = containerEl.querySelector('#fOurScore').value;
          const opp = containerEl.querySelector('#fOppScore').value;
          updated.ourScore = our === '' ? null : Number(our);
          updated.oppScore = opp === '' ? null : Number(opp);
          if (opts.onSave) withBusyButton(btnEvt.target, 'Saving...', () => opts.onSave(updated));
        });
        containerEl.querySelector('#cancelBtn').addEventListener('click', () => opts.onCancel && opts.onCancel());
        const deleteBtn = containerEl.querySelector('#deleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => opts.onDelete(game.id));
      }
    },
  };
})();
