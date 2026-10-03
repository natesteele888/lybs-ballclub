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

   Usage:
     node scripts/scrape-standings.mjs [divisionId ...]
     node scripts/scrape-standings.mjs 33696          # Majors
     node scripts/scrape-standings.mjs 33696 33695     # Majors + Minors

   Division IDs come from team-registry.js's macLeagueDivisionId
   field, or from browsing macleague.org yourself -- each
   division's URL is macleague.org/division/{id}.
   ============================================================ */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWL_DELAY_MS = 5000; // matches macleague.org's robots.txt "Crawl-delay: 5"
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDivisionPage(html, divisionId) {
  const nameMatch = html.match(/<h1>\s*(?:<[^>]+>\s*)*([^<\n]+?)\s*(?:<|$)/);

  // ---- Standings table ----
  const tableMatch = html.match(/<table class="table table-bordered nomargin">([\s\S]*?)<\/table>/);
  const rows = [];
  if (tableMatch) {
    const rowChunks = tableMatch[1].split('<tr>').slice(1); // drop header row split-off
    for (const chunk of rowChunks) {
      const teamMatch = chunk.match(/<a href="\/team\/(\d+)">\s*([^<]+?)\s*<\/a>/);
      const pctMatch = chunk.match(/<td class="text-center">\s*([\d.]+)\s*<\/td>/);
      if (teamMatch) {
        const team = teamMatch[2].trim();
        rows.push({
          teamId: teamMatch[1],
          team,
          pct: pctMatch ? pctMatch[1].trim() : null,
          isUs: /lunenburg/i.test(team),
        });
      }
    }
  }

  // ---- Today's Games block ----
  // Only verified against the off-season "No games scheduled" empty state --
  // re-check this regex against a live in-season page once games exist, and
  // adjust if the populated markup differs from this guess.
  const todayMatch = html.match(/<h3>Today's Games<\/h3>([\s\S]*?)(?:<div class="col-xs-12 col-md-6">|<h3>Standings<\/h3>)/);
  let todayGames = [];
  if (todayMatch) {
    const text = stripTags(todayMatch[1]);
    todayGames = text && !/no games scheduled/i.test(text) ? [text] : [];
  }

  return {
    divisionId,
    name: nameMatch ? nameMatch[1].trim() : `Division ${divisionId}`,
    rows,
    todayGames,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchDivision(divisionId) {
  const url = `https://www.macleague.org/division/${divisionId}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed for division ${divisionId}: HTTP ${res.status}`);
  const html = await res.text();
  return parseDivisionPage(html, divisionId);
}

async function main() {
  const divisionIds = process.argv.slice(2);
  if (!divisionIds.length) {
    console.error('Usage: node scripts/scrape-standings.mjs <divisionId> [<divisionId> ...]');
    console.error('Example: node scripts/scrape-standings.mjs 33696   # MAC League Majors');
    process.exit(1);
  }

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
