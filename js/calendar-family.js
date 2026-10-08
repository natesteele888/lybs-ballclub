/* ============================================================
   Combined family calendar -- for a parent with kids on more than
   one LYBS team. Built on the same calendar-export.js builder
   every single-team "Add to calendar" button already uses
   (schedule.js/practices.js); the only new thing here is
   concatenating more than one team's games+practices before
   calling it, which the ASL Bengals audit flagged as the one
   change actually needed to make that builder multi-team-ready --
   buildICS()/downloadICS() themselves need no changes at all.

   "My teams" is just every team this device has ever logged into
   -- found by scanning localStorage for identity.js's
   lybsIdentity_{teamId} keys, so there's no separate picker to set
   up first. A parent who's logged into both Select and (once it
   exists) Majors B on the same phone sees both here automatically.

   This is explicitly NOT synced from GameChanger -- GameChanger
   has no feed to sync from (see gamechanger.js's header comment).
   Our own schedule/practices data, entered by each team's coach,
   is the authoritative source.
   ============================================================ */
(function () {
  function myTeamIds() {
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('lybsIdentity_')) ids.push(k.slice('lybsIdentity_'.length));
    }
    return [...new Set(ids)];
  }

  async function loadTeamEvents(teamId) {
    const config = (await window.TeamConfig.load(teamId)) || { shortName: teamId };
    const games = await window.Schedule.ensureLoaded(teamId);
    const practices = await window.Practices.ensureLoaded(teamId);
    const gameEvents = games.map(g => ({
      uid: g.id,
      title: `${config.shortName} ${g.homeAway === 'Away' ? '@' : 'vs'} ${g.opponent || 'TBD'}`,
      date: g.date, time: g.gameTime, location: g.location, description: g.notes,
    }));
    const practiceEvents = practices.map(p => ({
      uid: p.id,
      title: `${config.shortName} ${TYPE_LABEL[p.type] || 'Practice'}`,
      date: p.date, time: p.time, location: p.location, description: p.notes,
    }));
    return { teamId, teamName: config.name, events: [...gameEvents, ...practiceEvents] };
  }

  window.FamilyCalendar = {
    async render(containerEl, activeTeamId) {
      let ids = myTeamIds();
      if (!ids.includes(activeTeamId)) ids.push(activeTeamId);
      containerEl.innerHTML = '<div class="emptyState">Loading your teams…</div>';
      const groups = await Promise.all(ids.map(loadTeamEvents));
      const included = new Set(ids);

      function renderBody() {
        const rows = groups.map(g => `
          <label class="teamCheckRow">
            <input type="checkbox" class="teamCheck" data-team="${g.teamId}" ${included.has(g.teamId) ? 'checked' : ''}>
            ${g.teamName} <span class="helpText">(${g.events.length} events)</span>
          </label>`).join('');
        containerEl.innerHTML = `
          <div class="helpText">Combines every team this device has logged into into one calendar file. Not synced from GameChanger in real time -- GameChanger has no feed for that; this reflects whatever's entered on each team's Schedule/Practices tabs.</div>
          <div class="teamCheckList">${rows}</div>
          <div class="detailActions">
            <button class="btn" id="downloadCombinedBtn">Download combined calendar (.ics)</button>
          </div>`;
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
