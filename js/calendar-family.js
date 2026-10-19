/* ============================================================
   Combined family calendar -- for a parent with kids on more than
   one LYBS team. Built on the same calendar-export.js builder
   every single-team "Add to calendar" button already uses
   (schedule.js/practices.js); the only new thing here is
   concatenating more than one team's games+practices before
   calling it, which the ASL Bengals audit flagged as the one
   change actually needed to make that builder multi-team-ready --
   buildICS()/downloadICS() themselves need no changes at all.

   "My teams" prefers a signed-in Google account's own real grants
   (index.html's MY_TEAMS, resolved by js/access-control.js from
   access/{teamId}/{uid}) when there are any -- the actual account-
   level truth, not tied to this one device. Falls back to
   window.Identity.listTeamIds() (every team this DEVICE has ever
   logged into) only for the no-account shared-code path, where
   there's no real multi-team grant to read at all. The two used to
   always be the device-local list, which could miss a team the
   account has real access to but this device has never opened, or
   include an unrelated team/account that happened to log into this
   same device at some point.

   This is explicitly NOT synced from GameChanger -- GameChanger
   has no feed to sync from (see gamechanger.js's header comment).
   Our own schedule/practices data, entered by each team's coach,
   is the authoritative source.
   ============================================================ */
(function () {
  async function loadTeamEvents(teamId) {
    // TeamConfig.peek(), not .load() -- load() overwrites the single
    // module-wide "active team" config (plus CSS vars and DOM text) as a
    // side effect. Calling it once per team here, concurrently
    // (Promise.all below), would clobber the real active team's own
    // branding with whichever team's fetch happened to resolve last --
    // this only wants to read another team's name for the event title,
    // never to change which team the rest of the app considers active.
    const config = (await window.TeamConfig.peek(teamId)) || { shortName: teamId };
    const games = await window.Schedule.ensureLoaded(teamId);
    const practices = await window.Practices.ensureLoaded(teamId);
    // Same date filter js/calendar-view.js's own itemsByDate() already
    // applies -- neither date field is required on its own edit form, and
    // an undated game/practice can't go on a calendar. Without this, the
    // team-checklist's own "(N events)" count above the download button
    // counted it, but js/calendar-export.js's buildEvent() silently skips
    // anything with no valid date -- a count that didn't match what the
    // downloaded file actually contained.
    const gameEvents = games.filter(g => g.date).map(g => ({
      uid: g.id,
      title: `${config.shortName} ${g.homeAway === 'Away' ? '@' : 'vs'} ${g.opponent || 'TBD'}`,
      date: g.date, time: g.gameTime, location: g.location, description: g.notes,
    }));
    const practiceEvents = practices.filter(p => p.date).map(p => ({
      uid: p.id,
      title: `${config.shortName} ${TYPE_LABEL[p.type] || 'Practice'}`,
      date: p.date, time: p.time, location: p.location, description: p.notes,
    }));
    return { teamId, teamName: config.name, events: [...gameEvents, ...practiceEvents] };
  }

  window.FamilyCalendar = {
    // myTeamIds: index.html's MY_TEAMS for the current signed-in account,
    // already mapped to bare team ids -- null/omitted for a gate-code
    // login, the one real case with no account grants to read.
    async render(containerEl, activeTeamId, myTeamIds) {
      let ids = (myTeamIds && myTeamIds.length) ? myTeamIds.slice() : window.Identity.listTeamIds();
      if (!ids.includes(activeTeamId)) ids.push(activeTeamId);
      containerEl.innerHTML = '<div class="emptyState">Loading your teams…</div>';
      const groups = await Promise.all(ids.map(loadTeamEvents));
      const included = new Set(ids);

      function renderBody() {
        const rows = groups.map(g => `
          <label class="teamCheckRow">
            <input type="checkbox" class="teamCheck" data-team="${escapeHtml(g.teamId)}" ${included.has(g.teamId) ? 'checked' : ''}>
            ${escapeHtml(g.teamName)} <span class="helpText">(${g.events.length} events)</span>
          </label>`).join('');
        containerEl.innerHTML = `
          <div class="helpText">Combines every team this device has logged into into one calendar file.
            <button class="btn btnGhost btnTiny" id="familyCalInfoBtn" style="margin-left:4px;">&#9432;</button>
          </div>
          <div class="teamCheckList">${rows}</div>
          <div class="detailActions">
            <button class="btn" id="downloadCombinedBtn">Download combined calendar (.ics)</button>
          </div>`;
        const infoBtn = containerEl.querySelector('#familyCalInfoBtn');
        if (infoBtn) {
          infoBtn.addEventListener('click', () => {
            window.openInfoModal('About the Combined Calendar', '<div class="helpText">Not synced from GameChanger in real time -- GameChanger has no feed for that. This reflects whatever\'s entered on each team\'s Schedule/Practices tabs.</div>');
          });
        }
        containerEl.querySelectorAll('.teamCheck').forEach(cb => {
          cb.addEventListener('change', () => {
            if (cb.checked) included.add(cb.dataset.team); else included.delete(cb.dataset.team);
          });
        });
        containerEl.querySelector('#downloadCombinedBtn').addEventListener('click', () => {
          const events = groups.filter(g => included.has(g.teamId)).flatMap(g => g.events);
          const ics = window.buildICS(events);
          window.downloadICS('lybs-family-calendar.ics', ics);
        });
      }
      renderBody();
    },
  };
})();
