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

  // Jersey colors used to be in here too, on the same "redundant repeated
  // word" theory as the age/division words -- wrong. In this league's real
  // naming convention a color is the ONLY thing that tells apart same-town
  // teams ("Bolton Gold"/"Bolton Green"/"Bolton Blue"/"Bolton Yellow" are
  // four different real teams across three divisions), so stripping it
  // collapsed them all to the same token set and tied -> null for the vast
  // majority of real opponents, verified against the real 2026 roster.
  const STOPWORDS = new Set([
    'u', '8u', '9u', '10u', '11u', '12u', '13u', '14u', '15u', '16u', '18u',
    'majors', 'minors', 'rookies', 'juniors', 'seniors', 'major', 'minor',
    'a', 'b', 'c', '1', '2', '3', 'the', 'of',
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

  // Best token-overlap match, requiring EVERY one of the search's own
  // tokens to be covered, not just one shared word. Ties or incomplete
  // coverage -> null, so a game card renders as plain text instead of
  // guessing wrong.
  //
  // A real bug this "at least 1 shared token" used to let through:
  // searching "8u Littleton Navy" (a real team with no standings row of
  // its own, confirmed live on macleague.org -- a team can have real
  // games and no standings row, both fetched the same way but genuinely
  // different data) against this division's pool scored 1 ("littleton")
  // against "8u Littleton Gold" -- a COMPLETELY DIFFERENT real team --
  // and that single shared town word was enough to confidently return
  // Gold's own teamId/standings/schedule mislabeled as Navy's. The old
  // header comment's "zero wrong matches" claim was true against the
  // roster it was checked against at the time; it stopped being true the
  // moment a second same-town team with no standings row existed to
  // collide with. Requiring full coverage means "littleton" alone is no
  // longer enough when the needle also has "navy" and the candidate's own
  // tokens don't -- a real but incomplete overlap now correctly resolves
  // to null (honest "not found") instead of a wrong team's real data.
  //
  // divisionId, when given, narrows the search to just that division
  // before scoring. Every real caller is resolving a name against OUR OWN
  // team's own division (its own name, or an opponent from its own
  // schedule -- this league doesn't play cross-division games), and this
  // league's naming convention reuses the exact same town+color team name
  // across age brackets (a "Bolton Green" fields its own 8U, 10U and 12U
  // team every season) -- searching the whole cross-division pool made
  // those identically-tokenized rows tie against EACH OTHER and resolve to
  // null, not just against a genuinely different team. Verified against
  // the real 2026 roster: narrowing to the caller's own division took the
  // resolve rate from 24% to 82%.
  function find(name, divisionId) {
    if (!cache || !cache.length || !name) return null;
    const pool = divisionId ? cache.filter(r => r.divisionId === divisionId) : cache;
    const needle = new Set(tokenize(name));
    if (!needle.size) return null;
    let best = null, bestScore = 0, tie = false;
    for (const row of pool) {
      // Distinct needle tokens this row covers, not a raw count over every
      // occurrence in row.tokens -- tokenize() does no de-duplication, so
      // a row that happens to repeat one shared word could otherwise reach
      // needle.size purely by repetition, without ever matching the
      // needle's OTHER distinct tokens at all. Real gap this closes:
      // searching "Bolton Green" (needle = {bolton, green}, size 2)
      // against a row tokenized to ["bolton","bolton"] used to score 2 by
      // counting that one word twice, passing the coverage check below
      // with "green" never matched. Iterating needle (already a Set)
      // against a Set of this row's tokens makes that impossible --
      // score can only ever reach as high as needle.size, never past it.
      const rowTokens = new Set(row.tokens);
      let score = 0;
      for (const t of needle) if (rowTokens.has(t)) score++;
      if (score > bestScore) { best = row; bestScore = score; tie = false; }
      else if (score === bestScore && score > 0) tie = true;
    }
    // bestScore can only reach needle.size by covering every one of the
    // needle's own distinct tokens at least once.
    if (!best || bestScore < needle.size || tie) return null;
    return best;
  }

  function teamUrl(name, divisionId) {
    const row = find(name, divisionId);
    return row ? `https://www.macleague.org/team/${row.teamId}` : null;
  }

  // Every team's display name in one division, sorted -- js/pitch-smart.js's
  // eligibility filter uses this to list who else is in our own division,
  // since the daily-max/rest-day table (and so eligibility itself) is
  // division-specific; a cross-division team wouldn't even use the same
  // rules. Call after ensureLoaded().
  function teamsInDivision(divisionId) {
    if (!cache || !divisionId) return [];
    return cache.filter(r => r.divisionId === divisionId).map(r => r.team).sort();
  }

  window.LeagueTeams = { ensureLoaded, find, teamUrl, teamsInDivision };
})();
