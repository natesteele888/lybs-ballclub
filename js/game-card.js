/* ============================================================
   Big result card for a completed game -- two team columns (logo +
   name), a score on either side of a colored W/L/T pill in the
   middle. Used by both the live Schedule tab (games that already
   have a final score) and the History tab (every archived game
   already has one). "Our" side always uses this app's own crest
   (assets/images/lybs-icon.png), not a MAC League club badge, since
   we're never "the opponent." The other side uses ClubLogos when
   the opponent name matches a known town, falling back to a plain
   initial badge in our own brand gradient when it doesn't (lots of
   Minors-level opponents are fun team nicknames -- "Rockhounds",
   "Minors Party Animals" -- that don't map to any town).

   The opponent's logo and name are tappable -- a data-team-nav
   attribute, not a real link, so index.html's one delegated click
   handler can route it to js/team-page.js's in-app profile for that
   team (standings, their home fields, our own history against them,
   pitch-count status, and a link out to their macleague.org page
   for what only MAC League has) instead of jumping straight to an
   external tab. Tapping the card anywhere else still opens this
   game's own detail/event view -- the handler calls
   stopPropagation() so one tap never fires both.

   opts.gameType ('regular' | 'playoff' | 'championship', default
   'regular') only shows a badge for the non-default cases -- a
   clean card for the common case, a clear flag for the ones that
   matter more.

   opts.lineScore (optional) -- {ours: {innings:[...], runs, hits,
   errors}, theirs: {innings:[...], runs, hits, errors}}, the shape
   scripts/enrich-archive-linescores.mjs writes onto an archived
   game. Only js/archive.js's History tab supplies this today (the
   live Schedule tab has no GameChanger team-id plumbing wired to a
   game still in progress this season) -- any other caller just
   omits it and gets the card exactly as before. Inning-by-inning
   runs + final runs/hits/errors, nothing more (no full box score,
   no recap -- both sit behind a GameChanger login; confirmed live,
   see that script's own header comment).
   ============================================================ */
(function () {
  function logoOrFallback(name, logoUrl) {
    if (logoUrl) return `<img class="gameResultLogo" src="${logoUrl}" alt="${escapeHtml(name)}" loading="lazy">`;
    const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="gameResultLogoFallback">${escapeHtml(letter)}</div>`;
  }

  function gameTypeBadge(gameType) {
    if (gameType === 'playoff') return '<span class="badge gameTypeBadge gameTypePlayoff">Playoff</span>';
    if (gameType === 'championship') return '<span class="badge gameTypeBadge gameTypeChampionship">Championship</span>';
    return '';
  }

  // One row per side, innings padded out to whichever side batted in more
  // of them (the home team skips its last at-bat when already trailing
  // going in, so the two arrays are legitimately different lengths --
  // confirmed live against a real game).
  function lineScoreTableHtml(lineScore, ourName, theirName) {
    const ours = lineScore.ours || {}, theirs = lineScore.theirs || {};
    const ourInnings = ours.innings || [], theirInnings = theirs.innings || [];
    const inningCount = Math.max(ourInnings.length, theirInnings.length);
    const headCells = Array.from({ length: inningCount }, (_, i) => `<th>${i + 1}</th>`).join('');
    const row = (name, innings, runs, hits, errors) => `
      <tr>
        <td class="lineScoreTeam">${escapeHtml(name || '')}</td>
        ${Array.from({ length: inningCount }, (_, i) => `<td>${innings[i] != null ? innings[i] : ''}</td>`).join('')}
        <td class="lineScoreTotal">${runs ?? '-'}</td>
        <td class="lineScoreTotal">${hits ?? '-'}</td>
        <td class="lineScoreTotal">${errors ?? '-'}</td>
      </tr>`;
    return `
      <table class="lineScoreTable">
        <thead><tr><th></th>${headCells}<th>R</th><th>H</th><th>E</th></tr></thead>
        <tbody>
          ${row(ourName, ourInnings, ours.runs, ours.hits, ours.errors)}
          ${row(theirName, theirInnings, theirs.runs, theirs.hits, theirs.errors)}
        </tbody>
      </table>`;
  }

  // opts: { date, homeAway, ourName, ourScore, theirName, theirLogoUrl,
  //   theirScore, result, gameType, lineScore? }
  window.GameCard = {
    resultHtml(opts) {
      const pillClass = opts.result === 'W' ? 'badgeW' : (opts.result === 'L' ? 'badgeL' : 'badgeT');
      const ourLogo = `<img class="gameResultLogo" src="assets/images/lybs-icon.png" alt="${escapeHtml(opts.ourName)}" loading="lazy">`;
      const theirLogo = logoOrFallback(opts.theirName, opts.theirLogoUrl);
      // Mirrored from "our" side (logo then name, both left-aligned) so the
      // card reads as two book-ended columns -- name right-aligned, logo
      // pinned to the far right edge -- instead of both sides reading the
      // same left-to-right direction, which left their logo stranded next
      // to the score and their name trailing off toward the edge.
      const theirTeamBlock = `<div class="gameResultName">${escapeHtml(opts.theirName)}</div>${theirLogo}`;
      const theirTeamHtml = opts.theirName
        ? `<div class="gameResultTeam gameResultTeamRight gameResultTeamLink" data-team-nav="${escapeHtml(opts.theirName)}" title="See ${escapeHtml(opts.theirName)}'s team page" tabindex="0" role="button">${theirTeamBlock}</div>`
        : `<div class="gameResultTeam gameResultTeamRight">${theirTeamBlock}</div>`;
      return `
        <div class="gameResultCard">
          <div class="gameResultTop">
            <div class="gameResultDate">${escapeHtml(opts.date || '')} ${gameTypeBadge(opts.gameType)}</div>
            <div class="gameResultMeta">${opts.homeAway === 'Away' ? '@ ' + escapeHtml(opts.theirName) : 'vs ' + escapeHtml(opts.theirName)}</div>
          </div>
          <div class="gameResultRow">
            <div class="gameResultTeam">${ourLogo}<div class="gameResultName">${escapeHtml(opts.ourName)}</div></div>
            <div class="gameResultCenter">
              <div class="gameResultScore">${escapeHtml(String(opts.ourScore))}</div>
              <div class="gameResultPill ${pillClass}">${opts.result}</div>
              <div class="gameResultScore">${escapeHtml(String(opts.theirScore))}</div>
            </div>
            ${theirTeamHtml}
          </div>
          ${opts.lineScore ? lineScoreTableHtml(opts.lineScore, opts.ourName, opts.theirName) : ''}
        </div>`;
    },
  };
})();
