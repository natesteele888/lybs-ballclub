#!/usr/bin/env node
/* ============================================================
   Mirrors MAC League (macleague.org) division standings into
   data/standings-cache.json, and -- if FIREBASE_DB_URL and
   FIREBASE_DB_SECRET are set -- also pushes the result into
   shared/macLeagueStandings in the real database, which
   js/standings.js reads from.

   Why a scheduled script instead of the browser calling
   macleague.org directly: that site doesn't send CORS headers for
   cross-origin fetches, and even if it did, every visitor's
   browser hitting it on page load would ignore the "Crawl-delay: 5"
   their own robots.txt asks every bot to respect. This script is
   meant to run on a timer (see .github/workflows/standings.yml),
   not once per page view.

   Only ever requests macleague.org/division/{id} and that page's
   nested /standings sub-path -- NEVER /schedule, which
   macleague.org's robots.txt explicitly disallows. If full
   league-wide schedule data is wanted later, that needs a direct
   conversation with MAC League/Crossbar, not a scraper routing
   around their stated preference.

   Two fetches per division, one crawl-delay apart: the bare
   /division/{id} page for "Today's Games", and /division/{id}/standings
   for the full table (GP/W/L/T/PCT/RF/RA/DIFF) -- the bare page's own
   table is a simplified Team+PCT-only view, confirmed against a live
   in-season page with real numbers.

   Usage:
     node scripts/scrape-standings.mjs [divisionId ...]
     node scripts/scrape-standings.mjs                # all known divisions (Rookies/Minors/Majors)
     node scripts/scrape-standings.mjs 33696           # just Majors

   Division IDs come from team-registry.js's macLeagueDivisionId
   field, or from browsing macleague.org yourself -- each
   division's URL is macleague.org/division/{id}. Confirmed live
   2026-10-03: Rookies 33694, Minors 33695, Majors 33696 -- no
   Juniors/Seniors division page is linked from the site right now,
   so it's not included here.
   ============================================================ */
const KNOWN_DIVISION_IDS = ['33694', '33695', '33696'];

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWL_DELAY_MS = 5000; // matches macleague.org's robots.txt "Crawl-delay: 5"
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// The bare division page (/division/{id}) has a simple Team+PCT table plus
// "Today's Games" -- the richer table (GP/W/L/T/PCT/RF/RA/DIFF) lives at the
// nested /standings sub-page instead (confirmed against a live in-season
// page with real numbers, not just the off-season empty state). This parses
// that richer table.
function parseStandingsTable(html) {
  const nameMatch = html.match(/<h1>\s*(?:<[^>]+>\s*)*([^<\n]+?)\s*(?:<|$)/);
  const tableMatch = html.match(/<table class="table table-bordered nomargin">([\s\S]*?)<\/table>/);
  const rows = [];
  if (tableMatch) {
    const rowChunks = tableMatch[1].split('<tr>').slice(1); // drop header row split-off
    for (const chunk of rowChunks) {
      const teamMatch = chunk.match(/<a href="\/team\/(\d+)">\s*([^<]+?)\s*<\/a>/);
      if (!teamMatch) continue;
      // Column order after the Team <td> is fixed: GP, W, L, T, PCT, RF, RA, DIFF
      // -- each as its own <td class="text-center">...</td>. A page-template
      // change that added/removed a column would silently shift every field
      // after it into the wrong label instead of erroring, so a count
      // mismatch is treated the same as "couldn't parse this page" below
      // rather than stored as if it were trustworthy.
      const cellMatches = [...chunk.matchAll(/<td class="text-center">\s*([^<]+?)\s*<\/td>/g)].map(m => m[1].trim());
      if (cellMatches.length !== 8) throw new Error(`Standings row for team ${teamMatch[1]} has ${cellMatches.length} stat cells, expected 8 -- page structure may have changed`);
      const [gp, w, l, t, pct, rf, ra, diff] = cellMatches;
      const team = teamMatch[2].trim();
      rows.push({
        teamId: teamMatch[1], team,
        gp: gp ?? null, w: w ?? null, l: l ?? null, t: t ?? null,
        pct: pct ?? null, rf: rf ?? null, ra: ra ?? null, diff: diff ?? null,
        isUs: /lunenburg/i.test(team),
      });
    }
  }
  // tableMatch null means the expected table markup wasn't found at all
  // (template change, maintenance page, a block) -- distinct from a real
  // table that's legitimately empty (rowChunks with no team rows, e.g. a
  // division with no teams yet), which still returns tableFound: true with
  // an empty rows[]. The caller uses this to avoid overwriting a good
  // existing mirror with what looks like an empty season.
  return { name: nameMatch ? nameMatch[1].trim().replace(/\s*-\s*Standings$/i, '') : null, rows, tableFound: !!tableMatch };
}

// The site's own "jump to another team" <select>-adjacent dropdown menu
// (<ul class="dropdown-menu"><li><a href="/team/{id}">{name}</a></li>...)
// lists every real team in the league, including ones with no row in the
// standings table itself. Real, confirmed live bug this exists to fix:
// a team can have real games on its own /team/{id}/games page and still
// have no standings row at all (confirmed live, 2026-10-15: "8u Littleton
// Navy," team 289743, plays real games but the Rookies /standings table's
// own <table> genuinely only lists 9 teams, not 10) -- scripts/scrape-
// team-details.mjs used to read ONLY the standings rows for its own list
// of which teams to scrape, so a team in exactly this situation never got
// scraped at all. This directory is the complete list that doesn't have
// that gap. Every division's own page carries the SAME full-league
// dropdown (not scoped to just that division), so parsing it once per
// division fetch and deduping across all of them in main() below is
// redundant but harmless -- cheaper than a fourth fetch just for this.
function parseTeamDirectory(html) {
  const seen = new Set();
  const teams = [];
  for (const m of html.matchAll(/<li><a href="\/team\/(\d+)">\s*([^<]+?)\s*<\/a><\/li>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    teams.push({ teamId: m[1], team: m[2].trim() });
  }
  return teams;
}

// Today's Games lives on the bare division page, one "scorebox" table per
// game (verified against a live in-season page -- 2026-10-03, Rookies
// division, a real 2:00 PM game -- not just the off-season empty state).
// Each scorebox has a status row (game id + start time), two team rows
// (logo, /team/{id} link, name, score -- score is blank until the game
// starts/finishes), and a location row.
function parseTodayGames(html) {
  const todayMatch = html.match(/<h3>Today's Games<\/h3>([\s\S]*?)(?:<div class="col-xs-12 col-md-6">|<h3>Standings<\/h3>)/);
  // todayMatch null means the "Today's Games" block itself wasn't found --
  // distinct from finding it and it explicitly saying "no games scheduled",
  // which is a confirmed-empty day (found: true, games: []). See
  // parseStandingsTable's tableFound for the same distinction.
  if (!todayMatch) return { found: false, games: [] };
  const block = todayMatch[1];
  if (/no games scheduled/i.test(block)) return { found: true, games: [] };
  const games = [];
  const boxRe = /<div class="scorebox">\s*<table class="">([\s\S]*?)<\/table>/g;
  let m;
  while ((m = boxRe.exec(block))) {
    const chunk = m[1];
    const statusMatch = chunk.match(/<tr class="status">\s*<td colspan="100%" data-id="(\d+)">([\s\S]*?)<\/td>\s*<\/tr>/);
    const gameId = statusMatch ? statusMatch[1] : null;
    const time = statusMatch ? stripTags(statusMatch[2]) : null;
    const teams = [];
    const teamRe = /<tr class="team">\s*<td class="logo">\s*<img src="([^"]*)">\s*<\/td>\s*<td>\s*<a href="\/team\/(\d+)">\s*([^<]+?)\s*<\/a>\s*<\/td>\s*<td class="score">([\s\S]*?)<\/td>\s*<\/tr>/g;
    let tm;
    while ((tm = teamRe.exec(chunk))) {
      teams.push({ logoUrl: tm[1], teamId: tm[2], name: tm[3].trim(), score: stripTags(tm[4]) || null });
    }
    const locMatch = chunk.match(/<tr class="location">\s*<td colspan="100%">([^<]*)<\/td>/);
    games.push({ gameId, time, teams, location: locMatch ? locMatch[1].trim() : null });
  }
  return { found: true, games };
}

async function fetchDivision(divisionId) {
  const baseUrl = `https://www.macleague.org/division/${divisionId}`;
  const baseRes = await fetch(baseUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!baseRes.ok) throw new Error(`Fetch failed for division ${divisionId}: HTTP ${baseRes.status}`);
  const baseHtml = await baseRes.text();
  const nameMatch = baseHtml.match(/<h1>\s*(?:<[^>]+>\s*)*([^<\n]+?)\s*(?:<|$)/);
  const { found: todayFound, games: todayGames } = parseTodayGames(baseHtml);
  if (!todayFound) throw new Error(`Division ${divisionId}: couldn't find the "Today's Games" block -- page structure may have changed`);

  await new Promise(r => setTimeout(r, CRAWL_DELAY_MS)); // respect robots.txt Crawl-delay: 5 between the two fetches

  const standingsUrl = `${baseUrl}/standings`;
  const standingsRes = await fetch(standingsUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!standingsRes.ok) throw new Error(`Fetch failed for division ${divisionId} standings: HTTP ${standingsRes.status}`);
  const standingsHtml = await standingsRes.text();
  const { name: standingsName, rows, tableFound } = parseStandingsTable(standingsHtml);
  if (!tableFound) throw new Error(`Division ${divisionId}: couldn't find the standings table -- page structure may have changed`);
  const teamDirectory = parseTeamDirectory(standingsHtml);

  return {
    divisionId,
    name: standingsName || (nameMatch ? nameMatch[1].trim() : `Division ${divisionId}`),
    rows,
    todayGames,
    teamDirectory,
    fetchedAt: new Date().toISOString(),
  };
}

async function main() {
  const divisionIds = process.argv.slice(2).length ? process.argv.slice(2) : KNOWN_DIVISION_IDS;

  const divisions = {};
  for (let i = 0; i < divisionIds.length; i++) {
    const id = divisionIds[i];
    console.log(`Fetching division ${id}...`);
    divisions[id] = await fetchDivision(id);
    console.log(`  -> ${divisions[id].name}: ${divisions[id].rows.length} teams`);
    if (i < divisionIds.length - 1) {
      await new Promise(r => setTimeout(r, CRAWL_DELAY_MS)); // respect robots.txt Crawl-delay: 5
    }
  }

  // Deduped union of every division's own teamDirectory -- see that
  // function's header comment for why this exists (a real team can have
  // no standings row of its own). scripts/scrape-team-details.mjs reads
  // this for its own "which teams to scrape" list instead of flattening
  // divisions[].rows, which is exactly the list that was missing this
  // class of team in the first place.
  const seenTeamIds = new Set();
  const allTeams = [];
  Object.values(divisions).forEach(d => (d.teamDirectory || []).forEach(t => {
    if (seenTeamIds.has(t.teamId)) return;
    seenTeamIds.add(t.teamId);
    allTeams.push(t);
  }));

  const result = { divisions, allTeams, scrapedAt: new Date().toISOString() };

  const outPath = new URL('../data/standings-cache.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)}`);

  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (dbUrl && dbSecret) {
    const pushUrl = `${dbUrl}/shared/macLeagueStandings.json?auth=${dbSecret}`;
    const putRes = await fetch(pushUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
    if (!putRes.ok) throw new Error(`Push to Firebase failed: HTTP ${putRes.status}`);
    console.log('Pushed to shared/macLeagueStandings in Firebase.');
  } else {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET not set -- wrote local cache file only.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
