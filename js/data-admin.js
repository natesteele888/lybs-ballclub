/* ============================================================
   Data Admin -- board-only screen for the one thing an admin
   actually needs to DO about the macleague.org standings/scores
   mirror: trigger it sooner than its own 30-minute schedule.

   The button here calls functions/index.js's triggerStandingsSync,
   a Cloud Function that holds the one thing a browser-side button
   can't safely hold itself: a token with write access to this
   repo's GitHub Actions. The function only ever uses that token
   after verifying the caller's Firebase ID token and checking
   boardMembers/{uid} == true -- the same check database.rules.json
   already enforces everywhere else a board-only write happens, so
   every real board member can use this button, not just whoever
   happens to also have a GitHub account with write access to the
   repo (an earlier version of this screen linked straight to
   GitHub's own "Run workflow" page, which only that second group
   could actually use).
   ============================================================ */
(function () {
  const SYNC_FUNCTION_URL = 'https://us-central1-lybs-ballclub.cloudfunctions.net/triggerStandingsSync';
  const TRIGGER_LABEL = 'Sync standings & scores now';

  // Same relative-time formatting js/standings.js already shows next to
  // each division's table -- duplicated rather than exported, same small-
  // self-contained-module convention this app uses elsewhere (e.g. each
  // module's own enableDragScroll copy).
  function timeAgo(iso) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  }

  window.DataAdmin = {
    async render(containerEl) {
      containerEl.innerHTML = '<div class="emptyState">Loading&hellip;</div>';
      // Same shared cache js/standings.js reads -- includes the first-visit
      // seed fallback (data/standings-seed.json) that TonightGames.ensureLoaded()
      // already handles, so this never shows "never synced" just because
      // nothing's been mirrored into this particular browser's cache yet.
      const data = await window.TonightGames.ensureLoaded();
      const divisions = Object.values((data && data.divisions) || {});
      const rows = divisions.map(d => `
        <div class="listRow" style="cursor:default;">
          <div class="listRowMain">
            <div class="listRowTitle">${escapeHtml(d.name || 'Division')}</div>
            <div class="listRowSub">Synced ${timeAgo(d.fetchedAt)}</div>
          </div>
        </div>`).join('');
      containerEl.innerHTML = `
        <div class="sectionLabel">League Data Sync</div>
        <div class="helpText">Standings and today's scores come from a job that mirrors macleague.org into this app, not a live fetch every time someone opens it &mdash; macleague.org doesn't allow a browser to pull from it directly, so a real server-side job has to do it instead. That job already runs automatically every 30 minutes, 8am&ndash;9pm ET, every day of the season &mdash; use the button below for an update sooner, e.g. right after a game wraps up.</div>
        ${rows ? `<div class="listBody" style="margin-top:12px;">${rows}</div>` : ''}
        <button class="btn btnSmall" id="dataAdminSyncBtn" style="width:100%;margin-top:14px;">${TRIGGER_LABEL}</button>
        <div class="helpText" id="dataAdminSyncStatus" style="margin-top:8px;min-height:16px;"></div>`;

      const btn = containerEl.querySelector('#dataAdminSyncBtn');
      const statusEl = containerEl.querySelector('#dataAdminSyncStatus');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        statusEl.classList.remove('errorText');
        statusEl.textContent = '';
        try {
          const token = await window.getFirebaseIdToken();
          const res = await fetch(SYNC_FUNCTION_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
          statusEl.textContent = 'Started — give it a minute, then check Standings.';
        } catch (e) {
          statusEl.classList.add('errorText');
          statusEl.textContent = `Couldn't start the sync: ${e.message}`;
        } finally {
          btn.disabled = false;
          btn.textContent = TRIGGER_LABEL;
        }
      });
    },
  };
})();
