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
  // macleague.org's own team names repeat the division's age bracket on
  // every single row ("12u Groton Dunstable", "12u Bolton Green", ...) --
  // redundant once that bracket is named once at the top of the page, and
  // it's the main reason team names were crowding out the other columns.
  function stripAgePrefix(name) {
    return (name || '').replace(/^\d{1,2}u\s+/i, '');
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
      // Routed through TonightGames.ensureLoaded() rather than a bare dbGet
      // so this tab also gets the real first-visit seed that lives there
      // (data/standings-seed.json) if nothing's mirrored yet -- same shared
      // path, one seeding path instead of two copies of that logic.
      const data = await window.TonightGames.ensureLoaded();
      const division = data && data.divisions && data.divisions[divisionId];
      if (!division) {
        containerEl.innerHTML = `
          <div class="emptyState">
            No standings mirrored yet for this division.<br>
            <span class="helpText">Run <code>node scripts/scrape-standings.mjs</code> (or let the scheduled GitHub Action do it once the season starts) to populate this.</span>
          </div>`;
        return;
      }
      await window.ClubLogos.ensureLoaded();
      const hasExtendedCols = (division.rows || []).some(r => r.gp != null);
      const ageMatch = ((division.rows || [])[0] || {}).team && (division.rows[0].team.match(/^(\d{1,2}u)\b/i));
      const ageLabel = ageMatch ? ageMatch[1].toUpperCase() : '';
      // Every row but our own links to that team's in-app Team Page (same
      // data-team-nav the opponent name/logo on a game card uses, routed by
      // index.html's one delegated click handler) -- there's nothing useful
      // to show for "our own team's page" here, so that row stays plain.
      const rows = (division.rows || []).map(r => `
        <tr class="${r.isUs ? 'standingsUsRow' : ''}">
          <td>${r.isUs
            ? `<div class="standingsTeamCell">${window.ClubLogos.badgeHtml(r.team, 26)}${escapeHtml(stripAgePrefix(r.team))}</div>`
            : `<div class="standingsTeamCell standingsTeamLink" data-team-nav="${escapeHtml(stripAgePrefix(r.team))}">${window.ClubLogos.badgeHtml(r.team, 26)}${escapeHtml(stripAgePrefix(r.team))}</div>`}</td>
          ${hasExtendedCols ? `
            <td class="numCell">${escapeHtml(r.gp ?? '')}</td>
            <td class="numCell">${escapeHtml(r.w ?? '')}</td>
            <td class="numCell">${escapeHtml(r.l ?? '')}</td>
            <td class="numCell">${escapeHtml(r.t ?? '')}</td>` : ''}
          <td class="numCell">${escapeHtml(r.pct)}</td>
          ${hasExtendedCols ? `
            <td class="numCell">${escapeHtml(r.rf ?? '')}</td>
            <td class="numCell">${escapeHtml(r.ra ?? '')}</td>
            <td class="numCell ${/^\+/.test(r.diff || '') ? 'diffPos' : (/^-/.test(r.diff || '') ? 'diffNeg' : '')}">${escapeHtml(r.diff ?? '')}</td>` : ''}
        </tr>`).join('');
      const extraHeaders = hasExtendedCols
        ? '<th class="numCell">GP</th><th class="numCell">W</th><th class="numCell">L</th><th class="numCell">T</th>'
        : '';
      const extraHeadersEnd = hasExtendedCols
        ? '<th class="numCell">RF</th><th class="numCell">RA</th><th class="numCell">DIFF</th>'
        : '';
      const games = (division.todayGames || []).map(g => window.TonightGames.gameRowHtml(g)).join('') || '<div class="emptyState">No games today.</div>';
      containerEl.innerHTML = `
        <div class="sectionLabel" style="margin-bottom:6px;">${escapeHtml(ageLabel ? ageLabel + ' ' : '')}${escapeHtml(division.name || '')} Standings</div>
        <div class="helpText">Mirrored from <a href="https://www.macleague.org/division/${escapeHtml(divisionId)}" target="_blank" rel="noopener">macleague.org</a> — standings as of ${timeAgo(division.fetchedAt)}.</div>
        <div class="standingsTableWrap">
          <table class="standingsTable">
            <thead><tr><th>Team</th>${extraHeaders}<th class="numCell">PCT</th>${extraHeadersEnd}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="sectionLabel" style="margin-top:14px;">Today's games</div>
        ${games}`;
    },
  };
})();
