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
    // The same games and practices in the shape the watch's Schedule app reads (see "On a watch" below): no notes, no players.
    const watch = [
      ...games.filter(g => g.date && g.status !== 'cancelled' && g.status !== 'postponed').map(g => ({
        d: g.date, t: hhmm(g.gameTime), k: 'g', tm: config.shortName || '', o: g.opponent || '', h: g.homeAway === 'Away' ? 0 : 1, l: g.location || '',
      })),
      ...practices.filter(p => p.date).map(p => ({
        d: p.date, t: hhmm(p.time), k: 'p', tm: config.shortName || '', l: p.location || '', x: TYPE_LABEL[p.type] || 'Practice',
      })),
    ];
    return { teamId, teamName: config.name, events: [...gameEvents, ...practiceEvents], watch };
  }

  /* ---------- On a watch ----------
     The Steele Family watch app (natesteele888/apps, watch/family) has a Schedule app: the next two weeks of games and
     practices, with GameChanger's live score during a game. This phone sends them through the watch link
     (apps/watchlink.js, loaded from the same site): one private document per phone and watch, field "sc", shaped
       {"v":1,"at":ms,"gc":"<GameChanger team id or ''>","ev":[{"d","t","k":"g"|"p","tm","o","h","l","x"}]}
     Only dates, times, places, opponents and team names go over -- nothing about players. The ticked teams in the list
     above are the ones sent, and the ticks are remembered on this device. The GameChanger link is optional and stays
     on this device (a parent can't read the team's own gcTeamId). */
  const LS_TEAMS = 'ballclub.familyCal.teams', LS_GC = 'ballclub.watch.gc', LS_SENT = 'ballclub.watch.sent';
  const WATCH_DAYS = 14;
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };

  // "18:00", "6:00 PM", "6pm" -> "18:00"; '' when there's no time it can read
  function hhmm(t) {
    const s = String(t || '').trim();
    let m = s.match(/^(\d{1,2}):(\d{2})\s*(?:([AaPp])\.?[Mm]\.?)?$/);
    let h, mm;
    if (m) { h = +m[1]; mm = +m[2]; if (m[3]) { if (h < 1 || h > 12) return ''; h = h % 12 + (/p/i.test(m[3]) ? 12 : 0); } }
    else if ((m = s.match(/^(\d{1,2})\s*([AaPp])\.?[Mm]?\.?$/))) { h = +m[1]; mm = 0; if (h < 1 || h > 12) return ''; h = h % 12 + (/p/i.test(m[2]) ? 12 : 0); }
    else return '';
    if (h > 23 || mm > 59) return '';
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function savedTeams() { try { const a = JSON.parse(lsGet(LS_TEAMS) || 'null'); return Array.isArray(a) ? a : null; } catch (e) { return null; } }

  // The "sc" object for the ticked teams: today through two weeks out, in date and time order
  function buildSchedule(groups, included, now) {
    const from = isoDay(now), to = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + WATCH_DAYS));
    const ev = groups.filter(g => included.has(g.teamId)).flatMap(g => g.watch)
      .filter(e => e.d >= from && e.d <= to)
      .sort((a, b) => (a.d + (a.t || '12:00')).localeCompare(b.d + (b.t || '12:00')))
      .slice(0, 80);
    return { v: 1, at: now.getTime(), gc: lsGet(LS_GC), ev };
  }

  // Sends the schedule when the watch is linked and it changed since the last send. Resolves to the number sent, or null.
  async function sendToWatch(groups, included) {
    const WL = window.WatchLink;
    if (!WL || !WL.linked()) return null;
    const sc = buildSchedule(groups, included, new Date());
    const sig = WL.key() + '|' + sc.gc + '|' + JSON.stringify(sc.ev);
    if (lsGet(LS_SENT) === sig) return sc.ev.length;
    await WL.write('sc', sc);
    lsSet(LS_SENT, sig);
    return sc.ev.length;
  }

  function includedFor(ids) {
    const saved = savedTeams();
    return new Set(saved ? ids.filter(id => saved.includes(id)) : ids);
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
      const included = includedFor(ids);
      let watchMsg = '';
      const resend = async () => {
        try {
          const n = await sendToWatch(groups, included);
          if (n != null) watchMsg = n ? `The watch has ${n} game${n === 1 ? '' : 's'} and practice${n === 1 ? '' : 's'} for the next two weeks.` : 'Nothing on the ticked teams in the next two weeks, so the watch shows an empty schedule.';
        } catch (e) { watchMsg = "Couldn't reach the watch link just now. It tries again next time you open the app."; }
        const el = containerEl.querySelector('#watchSchedMsg'); if (el) el.textContent = watchMsg;
      };

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
          </div>
          <div class="watchSched" style="margin-top:18px;">
            <h3 style="margin:0 0 6px;">&#8986; On a watch</h3>
            ${window.WatchLink ? `
            <div class="helpText">The ticked teams' next two weeks of games and practices go to the Schedule app on a Wear OS watch (Steele Family). Open Schedule on the watch: it shows a code to type here.</div>
            <div id="watchSchedPanel" style="margin-top:8px;"></div>
            <label class="helpText" style="display:block;margin-top:10px;">GameChanger team link, for live scores on the watch (optional)
              <input class="drillFreeInput" id="watchGcInput" placeholder="web.gc.com/teams/..." value="${escapeHtml(lsGet(LS_GC))}" autocomplete="off" spellcheck="false" style="display:block;width:100%;margin-top:4px;">
            </label>
            <div class="helpText" id="watchSchedMsg" role="status" style="margin-top:6px;">${escapeHtml(watchMsg)}</div>`
            : '<div class="helpText">The watch link needs a connection. Open the calendar again when you have signal.</div>'}
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
            lsSet(LS_TEAMS, JSON.stringify([...included]));
            resend();
          });
        });
        const panel = containerEl.querySelector('#watchSchedPanel');
        if (panel) {
          window.WatchLink.panel(panel, {
            intro: 'Type the code from the watch:',
            linkedText: "It gets the ticked teams' games and practices each time you open the app.",
            btn: 'btn btnGhost', btnPri: 'btn',
            onLinked: () => { lsSet(LS_SENT, ''); resend(); },
          });
          const gcIn = containerEl.querySelector('#watchGcInput');
          gcIn.addEventListener('change', () => {
            const v = gcIn.value.trim();
            const id = v ? window.GameChanger.extractGcTeamId(v) : '';
            if (id === null) { const el = containerEl.querySelector('#watchSchedMsg'); if (el) el.textContent = "Paste the team's web.gc.com/teams/... link from GameChanger."; return; }
            lsSet(LS_GC, id); gcIn.value = id;
            resend();
          });
        }
        containerEl.querySelector('#downloadCombinedBtn').addEventListener('click', () => {
          const events = groups.filter(g => included.has(g.teamId)).flatMap(g => g.events);
          const ics = window.buildICS(events);
          window.downloadICS('lybs-family-calendar.ics', ics);
        });
      }
      renderBody();
      resend();
    },

    // Called once after sign-in (index.html's applyIdentity): keeps the watch's schedule current without opening the
    // Calendar tab. Does nothing (and loads nothing) when this phone isn't linked to a watch.
    async syncWatch(activeTeamId, myTeamIds) {
      if (!window.WatchLink || !window.WatchLink.linked()) return null;
      const ids = (myTeamIds && myTeamIds.length) ? myTeamIds.slice() : window.Identity.listTeamIds();
      if (activeTeamId && !ids.includes(activeTeamId)) ids.push(activeTeamId);
      const groups = await Promise.all(ids.map(loadTeamEvents));
      return sendToWatch(groups, includedFor(ids));
    },
    _hhmm: hhmm,
    _buildSchedule: buildSchedule,
  };
})();
