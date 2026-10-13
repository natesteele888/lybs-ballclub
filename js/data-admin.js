/* ============================================================
   Data Admin -- board-only screen showing how fresh the
   macleague.org standings/scores mirror is.

   No manual trigger here. Two versions of one existed and were both
   pulled: a GitHub Actions link-out (free, but only usable by whoever
   has write access to this repo on GitHub -- not every board member)
   and a real in-app button backed by a Cloud Function (usable by any
   board member, but needs the Firebase project on the paid Blaze plan
   to deploy, which isn't wanted right now). So for now this is purely
   informational -- the scheduled job (.github/workflows/standings.yml)
   already runs every 30 minutes, 8am-9pm ET, every day of the season,
   with no action needed from anyone.

   The Cloud Function (functions/index.js's triggerStandingsSync) is
   still sitting in the repo, fully written and documented, ready to
   wire back in if going to Blaze ever becomes worth it -- see that
   file's header for the one-time setup.
   ============================================================ */
(function () {
  // Same "don't tell the whole story inline, put it behind an (i) button"
  // treatment js/league-schedule.js already uses for the Fall Schedule
  // tab's own note -- the full explanation (why this can't be a live
  // fetch) is detail worth having, just not worth everyone reading it
  // every time they open this screen.
  const FULL_NOTE = "Standings and today's scores come from a scheduled job that mirrors macleague.org into this app, not a live fetch every time someone opens it. macleague.org doesn't allow a browser to pull from it directly, so a real server-side job (.github/workflows/standings.yml) has to do it instead.";

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
        <div class="helpText">Synced automatically every 30 minutes, 8am&ndash;9pm ET, every day of the season.</div>
        ${rows ? `<div class="listBody" style="margin-top:12px;">${rows}</div>` : ''}
        <button class="btn btnGhost btnTiny" id="dataAdminInfoBtn" style="margin-top:12px;">&#9432; About this data</button>`;

      const infoBtn = containerEl.querySelector('#dataAdminInfoBtn');
      if (infoBtn) {
        infoBtn.addEventListener('click', () => {
          window.openInfoModal('About League Data Sync', `<div class="helpText">${FULL_NOTE}</div>`);
        });
      }
    },
  };
})();
