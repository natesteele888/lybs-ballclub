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
      // -- each as its own <td class="text-center">...</td>.
      const cellMatches = [...chunk.matchAll(/<td class="text-center">\s*([^<]+?)\s*<\/td>/g)].map(m => m[1].trim());
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
  return { name: nameMatch ? nameMatch[1].trim().replace(/\s*-\s*Standings$/i, '') : null, rows };
}

// Today's Games lives on the bare division page, one "scorebox" table per
// game (verified against a live in-season page -- 2026-10-03, Rookies
// division, a real 2:00 PM game -- not just the off-season empty state).
// Each scorebox has a status row (game id + start time), two team rows
// (logo, /team/{id} link, name, score -- score is blank until the game
// starts/finishes), and a location row.
function parseTodayGames(html) {
  const todayMatch = html.match(/<h3>Today's Games<\/h3>([\s\S]*?)(?:<div class="col-xs-12 col-md-6">|<h3>Standings<\/h3>)/);
  if (!todayMatch) return [];
  const block = todayMatch[1];
  if (/no games scheduled/i.test(block)) return [];
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
  return games;
}

async function fetchDivision(divisionId) {
  const baseUrl = `https://www.macleague.org/division/${divisionId}`;
  const baseRes = await fetch(baseUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!baseRes.ok) throw new Error(`Fetch failed for division ${divisionId}: HTTP ${baseRes.status}`);
  const baseHtml = await baseRes.text();
  const nameMatch = baseHtml.match(/<h1>\s*(?:<[^>]+>\s*)*([^<\n]+?)\s*(?:<|$)/);
  const todayGames = parseTodayGames(baseHtml);

  await new Promise(r => setTimeout(r, CRAWL_DELAY_MS)); // respect robots.txt Crawl-delay: 5 between the two fetches

  const standingsUrl = `${baseUrl}/standings`;
  const standingsRes = await fetch(standingsUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!standingsRes.ok) throw new Error(`Fetch failed for division ${divisionId} standings: HTTP ${standingsRes.status}`);
  const standingsHtml = await standingsRes.text();
  const { name: standingsName, rows } = parseStandingsTable(standingsHtml);

  return {
    divisionId,
    name: standingsName || (nameMatch ? nameMatch[1].trim() : `Division ${divisionId}`),
    rows,
    todayGames,
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

  const result = { divisions, scrapedAt: new Date().toISOString() };

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
