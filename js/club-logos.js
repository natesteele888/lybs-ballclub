/* ============================================================
   MAC League club logos -- fuzzy-matches a team/opponent name
   string (e.g. "GD 12U Cardinals", "Ayer-Shirley Majors Panthers",
   "TAYBS Majors Gold") against the 10 MAC League towns and returns
   that town's badge.

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
    const data = await fetch('data/mac-league-clubs.json').then(r => r.json()).catch(() => ({ clubs: [] }));
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

  window.ClubLogos = { ensureLoaded, find, badgeHtml };
})();
