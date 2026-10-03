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

   When opts.theirLinkUrl is set (resolved via js/league-teams.js
   against the mirrored MAC League standings), the opponent's logo
   and name link out to that team's own macleague.org page -- full
   season schedule, same "tap the opponent card to see their year"
   pattern as the Bengals app. No resolvable match -> plain text,
   same honest degrade as everywhere else this app links out.

   opts.gameType ('regular' | 'playoff' | 'championship', default
   'regular') only shows a badge for the non-default cases -- a
   clean card for the common case, a clear flag for the ones that
   matter more.
   ============================================================ */
(function () {
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

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

  // opts: { date, homeAway, ourName, ourScore, theirName, theirLogoUrl,
  //   theirScore, result, theirLinkUrl, gameType }
  window.GameCard = {
    resultHtml(opts) {
      const pillClass = opts.result === 'W' ? 'badgeW' : (opts.result === 'L' ? 'badgeL' : 'badgeT');
      const ourLogo = `<img class="gameResultLogo" src="assets/images/lybs-icon.png" alt="${escapeHtml(opts.ourName)}" loading="lazy">`;
      const theirLogo = logoOrFallback(opts.theirName, opts.theirLogoUrl);
      const theirTeamBlock = `${theirLogo}<div class="gameResultName">${escapeHtml(opts.theirName)}</div>`;
      const theirTeamHtml = opts.theirLinkUrl
        ? `<a class="gameResultTeam gameResultTeamLink" href="${opts.theirLinkUrl}" target="_blank" rel="noopener" title="See ${escapeHtml(opts.theirName)}'s full schedule on macleague.org">${theirTeamBlock}</a>`
        : `<div class="gameResultTeam">${theirTeamBlock}</div>`;
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
        </div>`;
    },
  };
})();
