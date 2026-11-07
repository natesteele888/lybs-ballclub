/* ============================================================
   MAC League club logos -- fuzzy-matches a team/opponent name
   string (e.g. "GD 12U Cardinals", "Ayer-Shirley Majors Panthers",
   "TAYBS Majors Gold") against the MAC League towns and returns
   that town's badge. Westford fields Minors/Majors teams but has
   no /club/ page of its own on macleague.org (no entry in its
   CLUBS nav dropdown) -- its badge here comes from its team pages
   instead, same crossbar.s3.amazonaws.com host as the rest.

   Hotlinked only -- see data/mac-league-clubs.json's header note.
   These <img> tags point straight at crossbar.s3.amazonaws.com; we
   never download or store a local copy. No RTDB mirroring either
   (unlike rules.js/archive.js's seed-once pattern) -- this is
   static reference data nobody needs to edit, so a local fetch on
   first use is enough.
   ============================================================ */
(function () {
  let cache = null; // clubs[]

  async function ensureLoaded() {
    if (cache) return cache;
    const data = await fetch('data/mac-league-clubs.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => ({ clubs: [] }));
    cache = data.clubs || [];
    return cache;
  }

  function find(name) {
    if (!cache || !name) return null;
    const n = ` ${name.toLowerCase()} `;
    for (const club of cache) {
      for (const kw of club.keywords) {
        if (n.includes(kw.toLowerCase())) return club;
      }
    }
    return null;
  }

  function badgeHtml(name, size) {
    const club = find(name);
    if (!club) return '';
    size = size || 20;
    return `<img src="${club.logoUrl}" alt="${club.town}" title="${club.town}" class="clubBadge" style="width:${size}px;height:${size}px;" loading="lazy">`;
  }

  // A badge hotlinked from crossbar.s3 can't load with no signal at the
  // field (or if the league moves the file). The browser then draws a
  // white box with the town name as alt text -- often far wider than the
  // badge, shoving the team name aside. Swap any remote team logo that
  // fails for the lettered tile already used for a team with no badge.
  // Capture phase, because an <img> error event doesn't bubble.
  const FALLBACK_CLASS = { clubBadge: 'fieldBadgeFallback', gameResultLogo: 'gameResultLogoFallback', tonightTeamLogo: 'gameResultLogoFallback' };
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.src || img.src.startsWith(location.origin)) return;
    const cls = Object.keys(FALLBACK_CLASS).find(c => img.classList.contains(c));
    if (!cls) return;
    const cs = getComputedStyle(img);
    const tile = document.createElement('span');
    tile.className = FALLBACK_CLASS[cls];
    // First letter, skipping an age/division prefix ("12A Pepperell" -> P).
    const letter = (img.dataset.name || img.alt || img.title || '').replace(/^[^A-Za-z]*\d+\w?\s+/, '').match(/[A-Za-z]/);
    tile.textContent = letter ? letter[0].toUpperCase() : '?';
    if (img.title) tile.title = img.title;
    tile.setAttribute('aria-hidden', 'true');
    // Keep the badge's own size and spacing; inline-flex so a badge that
    // sat inline before a team name doesn't push that name onto a new line.
    const size = parseFloat(img.style.width) || (cls === 'tonightTeamLogo' ? 40 : 0);
    if (size) Object.assign(tile.style, { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.5) + 'px' });
    Object.assign(tile.style, { display: 'inline-flex', verticalAlign: 'middle', margin: cs.margin, borderRadius: cs.borderRadius });
    img.replaceWith(tile);
  }, true);

  window.ClubLogos = { ensureLoaded, find, badgeHtml };
})();
