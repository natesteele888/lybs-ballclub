/* ============================================================
   MAC League team lookup -- resolves an opponent name string (e.g.
   "12u Groton Dunstable 1", "Bolton Majors A", "GD 12U Cardinals")
   to a {teamId, team, divisionId} row from shared/macLeagueStandings,
   so game cards can link out to that team's own macleague.org page
   (which shows their full schedule for the season -- the same
   "click the opponent, see their year" pattern from the Bengals
   app, just pointed at the league's own team pages instead of a
   GameChanger team page: GameChanger has no public directory to
   resolve an arbitrary opponent's page from a name, only the team
   that's actually configured to run inside this app -- see
   team-registry.js. macleague.org's team pages are public, no
   login required, and already proven out at build time against a
   real team).

   Team-name conventions drift year to year and across age groups
   ("12u Groton Dunstable 1" this Fall vs. "Groton Dunstable Majors
   A" in Spring's archive data) so this can't be a fixed keyword
   table like club-logos.js -- it tokenizes both sides and scores
   overlap, same spirit as a fuzzy search, not an exact key. No
   match above the threshold -> no link, same honest-degrade pattern
   as ClubLogos.find() returning null.
   ============================================================ */
(function () {
  let cache = null; // {teamId, team, divisionId}[], flattened across every mirrored division

  const STOPWORDS = new Set([
    'u', '8u', '9u', '10u', '11u', '12u', '13u', '14u', '15u', '16u', '18u',
    'majors', 'minors', 'rookies', 'juniors', 'seniors', 'major', 'minor',
    'a', 'b', 'c', '1', '2', '3', 'the', 'of', 'blue', 'black', 'red', 'green',
    'gold', 'white', 'navy', 'yellow', 'maroon',
  ]);

  function tokenize(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(t => t.length >= 2 && !STOPWORDS.has(t));
  }

  async function ensureLoaded() {
    if (cache) return cache;
    const data = await window.dbGet(window.sharedPath('macLeagueStandings'));
    const rows = [];
    const divisions = (data && data.divisions) || {};
    Object.keys(divisions).forEach(divisionId => {
      (divisions[divisionId].rows || []).forEach(r => {
        rows.push({ teamId: r.teamId, team: r.team, divisionId, tokens: tokenize(r.team) });
      });
    });
    cache = rows;
    return cache;
  }

  // Best token-overlap match, minimum 1 shared meaningful token. Ties or no
  // overlap -> null, so a game card just renders as plain text instead of
  // guessing wrong.
  function find(name) {
    if (!cache || !cache.length || !name) return null;
    const needle = new Set(tokenize(name));
    if (!needle.size) return null;
    let best = null, bestScore = 0, tie = false;
    for (const row of cache) {
      let score = 0;
      for (const t of row.tokens) if (needle.has(t)) score++;
      if (score > bestScore) { best = row; bestScore = score; tie = false; }
      else if (score === bestScore && score > 0) tie = true;
    }
    if (!best || bestScore < 1 || tie) return null;
    return best;
  }

  function teamUrl(name) {
    const row = find(name);
    return row ? `https://www.macleague.org/team/${row.teamId}` : null;
  }

  window.LeagueTeams = { ensureLoaded, find, teamUrl };
})();
