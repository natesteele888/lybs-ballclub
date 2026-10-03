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

  // opts: { date, homeAway, ourName, ourScore, theirName, theirLogoUrl, theirScore, result }
  window.GameCard = {
    resultHtml(opts) {
      const pillClass = opts.result === 'W' ? 'badgeW' : (opts.result === 'L' ? 'badgeL' : 'badgeT');
      const ourLogo = `<img class="gameResultLogo" src="assets/images/lybs-icon.png" alt="${escapeHtml(opts.ourName)}" loading="lazy">`;
      const theirLogo = logoOrFallback(opts.theirName, opts.theirLogoUrl);
      return `
        <div class="gameResultCard">
          <div class="gameResultTop">
            <div class="gameResultDate">${escapeHtml(opts.date || '')}</div>
            <div class="gameResultMeta">${opts.homeAway === 'Away' ? '@ ' + escapeHtml(opts.theirName) : 'vs ' + escapeHtml(opts.theirName)}</div>
          </div>
          <div class="gameResultRow">
            <div class="gameResultTeam">${ourLogo}<div class="gameResultName">${escapeHtml(opts.ourName)}</div></div>
            <div class="gameResultCenter">
              <div class="gameResultScore">${escapeHtml(String(opts.ourScore))}</div>
              <div class="gameResultPill ${pillClass}">${opts.result}</div>
              <div class="gameResultScore">${escapeHtml(String(opts.theirScore))}</div>
            </div>
            <div class="gameResultTeam">${theirLogo}<div class="gameResultName">${escapeHtml(opts.theirName)}</div></div>
          </div>
        </div>`;
    },
  };
})();
