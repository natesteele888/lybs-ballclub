/* ============================================================
   MAC League standings -- reads shared/macLeagueStandings, a mirror
   written by a scheduled job (scripts/scrape-standings.mjs, run by
   .github/workflows/standings.yml), NOT fetched directly from the
   browser. Two reasons it has to work that way:

   1. macleague.org doesn't send CORS headers for a cross-origin
      fetch() from a GitHub Pages site to succeed -- it's a plain
      server-rendered site, not an API meant to be called from
      other pages.
   2. Even if it did, hitting it on every single visitor's page
      load would hammer their server far past the "Crawl-delay: 5"
      their own robots.txt asks for. One scheduled job, polling
      every 20-30 minutes, respects that; this page just reads
      whatever that job last wrote.

   That job only ever requests macleague.org/division/{id} --
   never /schedule, which robots.txt explicitly disallows.

   Display is deliberately honest about freshness ("as of HH:MM"),
   not framed as literally live -- it's a periodic mirror of a
   public page, not a real API.
   ============================================================ */
(function () {
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function timeAgo(iso) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  }

  window.Standings = {
    async render(containerEl, divisionId) {
      containerEl.innerHTML = '<div class="emptyState">Loading…</div>';
      const data = await window.dbGet(window.sharedPath('macLeagueStandings'));
      const division = data && data.divisions && data.divisions[divisionId];
      if (!division) {
        containerEl.innerHTML = `
          <div class="emptyState">
            No standings mirrored yet for this division.<br>
            <span class="helpText">Run <code>node scripts/scrape-standings.mjs</code> (or let the scheduled GitHub Action do it once the season starts) to populate this.</span>
          </div>`;
        return;
      }
      const rows = (division.rows || []).map(r => `
        <tr class="${r.isUs ? 'standingsUsRow' : ''}">
          <td>${escapeHtml(r.team)}</td>
          <td>${escapeHtml(r.pct)}</td>
        </tr>`).join('');
      const games = (division.todayGames || []).map(g => `<div class="detailRow">${escapeHtml(g)}</div>`).join('') || '<div class="emptyState">No games today.</div>';
      containerEl.innerHTML = `
        <div class="helpText">Mirrored from <a href="https://www.macleague.org/division/${escapeHtml(divisionId)}" target="_blank" rel="noopener">macleague.org</a> — standings as of ${timeAgo(division.fetchedAt)}.</div>
        <table class="standingsTable">
          <thead><tr><th>Team</th><th>PCT</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="sectionLabel" style="margin-top:14px;">Today's games</div>
        ${games}`;
    },
  };
})();
