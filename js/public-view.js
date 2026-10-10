/* ============================================================
   Public View -- standings, schedule, and league info for anyone,
   no sign-in at all, reached from #publicViewLink on the login
   screen. Deliberately NOT roster/player names -- see
   js/backend.js's publicSchedulePath() header comment for how the
   schedule panel stays that way (a scrubbed mirror, not the real
   teams/{teamId}/schedule node).

   A standalone mini-shell (#publicView in index.html), not a
   restricted pass through #appShell's real nav -- see that markup's
   own comment for why. window.dbGet needs no special handling here:
   cloud-auth.js's existing getFirebaseIdToken() already falls back
   to a plain anonymous Firebase sign-in whenever nothing else is
   active, the same way it already would for any other tab -- this
   file just calls dbGet like everything else does.

   Team picker is built from TEAM_REGISTRY.teams, not hardcoded to
   one team, so a second team needs no changes here.
   ============================================================ */
(function () {
  const PANELS = [
    { id: 'standings', label: 'Standings' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'league', label: 'League Info' },
  ];

  let activeTeamId = null;
  let activePanel = 'standings';

  function teamIds() {
    return Object.keys((window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams) || {});
  }
  function teamConfigFor(teamId) {
    return (window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams[teamId]) || {};
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  async function renderScheduleSlot(slotEl, teamId) {
    slotEl.innerHTML = '<div class="emptyState">Loading&hellip;</div>';
    const [games, practices] = await Promise.all([
      window.dbGet(window.publicSchedulePath(teamId, 'games')),
      window.dbGet(window.publicSchedulePath(teamId, 'practices')),
    ]);
    const items = [
      ...(Array.isArray(games) ? games : []).map(g => ({ date: g.date, kind: 'game', item: g })),
      ...(Array.isArray(practices) ? practices : []).map(p => ({ date: p.date, kind: 'practice', item: p })),
    ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const rows = items.map(x => {
      if (x.kind === 'game') {
        const g = x.item;
        const played = g.ourScore != null && g.oppScore != null;
        const statusBadge = g.status === 'postponed' ? '<span class="badge badgeTbd">Postponed</span>'
          : g.status === 'cancelled' ? '<span class="badge badgeTbd">Cancelled</span>' : '';
        return `
          <div class="listRow" style="cursor:default;${g.status === 'cancelled' ? 'opacity:0.55;' : ''}">
            <div class="listRowMain">
              <div class="listRowTitle">${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')}</div>
              <div class="listRowSub">${escapeHtml(fmtDate(g.date))}${g.gameTime ? ' · ' + escapeHtml(g.gameTime) : ''}${g.location ? ' · ' + escapeHtml(g.location) : ''}</div>
            </div>
            ${played ? `<span class="badge ${g.ourScore > g.oppScore ? 'badgeW' : g.ourScore < g.oppScore ? 'badgeL' : 'badgeT'}">${g.ourScore}-${g.oppScore}</span>` : statusBadge}
          </div>`;
      }
      const p = x.item;
      return `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain">
            <div class="listRowTitle">${escapeHtml(TYPE_LABEL[p.type] || 'Practice')}</div>
            <div class="listRowSub">${escapeHtml(fmtDate(p.date))}${p.time ? ' · ' + escapeHtml(p.time) : ''}${p.location ? ' · ' + escapeHtml(p.location) : ''}</div>
          </div>
        </div>`;
    }).join('') || '<div class="emptyState">No games or practices scheduled yet.</div>';

    slotEl.innerHTML = `<div class="listBody">${rows}</div>`;
  }

  async function renderPanel() {
    const slot = document.getElementById('publicViewContent');
    if (!slot || !activeTeamId) return;
    if (activePanel === 'league') {
      await window.LeagueInfo.ensureLoaded();
      window.LeagueInfo.render(slot);
    } else if (activePanel === 'standings') {
      await window.Standings.render(slot, teamConfigFor(activeTeamId).macLeagueDivisionId);
    } else if (activePanel === 'schedule') {
      await renderScheduleSlot(slot, activeTeamId);
    }
  }

  function renderNav() {
    const navEl = document.getElementById('publicNavBar');
    if (!navEl) return;
    navEl.innerHTML = PANELS.map(p => `<button class="tabBtn ${p.id === activePanel ? 'active' : ''}" data-panel="${p.id}">${p.label}</button>`).join('');
    navEl.querySelectorAll('[data-panel]').forEach(btn => {
      btn.addEventListener('click', () => { activePanel = btn.dataset.panel; renderNav(); renderPanel(); });
    });
  }

  function renderTeamPicker() {
    const selectEl = document.getElementById('publicTeamSelect');
    if (!selectEl) return;
    const ids = teamIds();
    selectEl.innerHTML = ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(teamConfigFor(id).name || id)}</option>`).join('');
    selectEl.style.display = ids.length > 1 ? '' : 'none';
    if (!activeTeamId || !ids.includes(activeTeamId)) activeTeamId = ids[0] || null;
    selectEl.value = activeTeamId || '';
  }

  async function openPublicView() {
    const loginScreen = document.getElementById('loginScreen');
    const publicView = document.getElementById('publicView');
    if (!loginScreen || !publicView) return;
    loginScreen.classList.add('hide');
    publicView.classList.remove('hide');
    renderTeamPicker();
    renderNav();

    const eventsSlot = document.getElementById('publicLeagueEventsSlot') || (() => {
      const el = document.createElement('div');
      el.id = 'publicLeagueEventsSlot';
      document.getElementById('publicNavBar').before(el);
      return el;
    })();
    window.LeagueEvents.ensureLoaded().then(() => {
      if (window.LeagueEvents.getUpcoming().length) {
        eventsSlot.innerHTML = '<div class="sectionLabel">League Events</div>';
        const slot = document.createElement('div');
        eventsSlot.appendChild(slot);
        window.LeagueEvents.render(slot, { canEdit: false });
      }
    });

    renderPanel();
  }

  function closePublicView() {
    document.getElementById('publicView').classList.add('hide');
    document.getElementById('loginScreen').classList.remove('hide');
  }

  const link = document.getElementById('publicViewLink');
  if (link) link.addEventListener('click', e => { e.preventDefault(); openPublicView(); });

  const backBtn = document.getElementById('publicViewBack');
  if (backBtn) backBtn.addEventListener('click', closePublicView);

  const teamSelect = document.getElementById('publicTeamSelect');
  if (teamSelect) teamSelect.addEventListener('change', () => { activeTeamId = teamSelect.value; renderPanel(); });
})();
