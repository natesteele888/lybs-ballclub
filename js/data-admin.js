/* ============================================================
   Data Admin -- board-only screen for the one thing an admin
   actually needs to DO about the macleague.org standings/scores
   mirror: trigger it sooner than its own 30-minute schedule.

   This can't be a real in-app button. macleague.org sends no CORS
   headers, so the browser can't fetch it directly (js/standings.js's
   own header has the full story), and triggering the GitHub Action
   that CAN fetch it needs a token scoped to kick off a workflow run --
   not something a static, client-side PWA can hold without exposing
   it to anyone who opens devtools. The honest, zero-new-infrastructure
   answer is a link to the same "Run workflow" button GitHub's own
   Actions UI already has (workflow_dispatch is already enabled on
   .github/workflows/standings.yml) -- one extra tap, but no new
   secrets, no new backend, nothing that can leak.

   A real one-tap-from-the-app trigger is possible later, but needs a
   small server-side proxy (e.g. a Firebase Cloud Function holding a
   GitHub token) -- a deliberate, separate decision, not something to
   back into here.
   ============================================================ */
(function () {
  const REPO_ACTIONS_URL = 'https://github.com/natesteele888/lybs-ballclub/actions/workflows/standings.yml';

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
        <div class="helpText">Standings and today's scores come from a scheduled job that mirrors macleague.org into this app, not a live fetch every time someone opens it &mdash; macleague.org doesn't allow a browser to pull from it directly, so a real server-side job has to do it instead. That job already runs automatically every 30 minutes, 8am&ndash;9pm ET, every day of the season.</div>
        ${rows ? `<div class="listBody" style="margin-top:12px;">${rows}</div>` : ''}
        <a class="btn btnSmall" style="width:100%;margin-top:14px;" href="${REPO_ACTIONS_URL}" target="_blank" rel="noopener">Open GitHub Actions to run it now &rarr;</a>
        <div class="helpText" style="margin-top:8px;">Opens GitHub in a new tab. Click "Run workflow" there for an update sooner than the next scheduled run &mdash; e.g. right after a game wraps up.</div>`;
    },
  };
})();
