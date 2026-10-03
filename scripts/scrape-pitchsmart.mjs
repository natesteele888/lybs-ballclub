#!/usr/bin/env node
/* ============================================================
   Mirrors MAC League's Pitch Smart page into shared/pitchSmart,
   same pattern as scrape-standings.mjs (scheduled job, never
   fetched live from the browser -- see that script's header for
   why).

   *** HONEST STATE AS OF 2026-10-04: THE PARSER BELOW IS UNVERIFIED. ***
   Every division's Pitch Smart page (macleague.org/division/{id}/pitchsmart)
   returned "There is no pitch smart data for the selected filters" when
   checked -- pitch-count reporting is a Spring-only requirement (see
   data/pitch-smart-rules.json's note), so there's nothing to inspect right
   now. Rather than guess at a table structure I can't see and ship a parser
   that might silently return garbage, parseePitchSmartPage() below does the
   one thing I *can* verify -- detects the real "no data" empty state
   cleanly -- and documents exactly what to do once real data exists:

     1. Run this script, or just `curl` the page directly, once Spring
        games with pitch counts have been played.
     2. Inspect the HTML: is it a <table> like standings (most likely,
        given the site's consistent template), or something else?
     3. Fill in the TODO below with real column selectors once you can
        see them -- expected shape per pitcher is {name, appearances:
        [{date, pitches}]}, matching what js/pitch-smart.js's
        computeStatus() already expects.
     4. Until then, this writes an empty mirror (not fake/sample data) so
        the app's "no data mirrored yet" empty state (js/pitch-smart.js's
        renderOpponentEligibility) stays accurate rather than silently wrong.

   Usage:
     node scripts/scrape-pitchsmart.mjs [divisionId ...]
     node scripts/scrape-pitchsmart.mjs 33696   # Majors
   ============================================================ */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWL_DELAY_MS = 5000; // matches macleague.org's robots.txt "Crawl-delay: 5"
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

function parsePitchSmartPage(html) {
  if (/no pitch smart data/i.test(html)) {
    return { teams: {}, hasData: false };
  }
  // TODO (see header): once real data exists, find the real markup and
  // parse it into { [teamName]: { division, pitchers: [{name, appearances:
  // [{date, pitches}]}] } }. Left unimplemented on purpose rather than
  // guessing -- this branch currently just flags that *something* other
  // than the known empty state came back, so a human notices and fills
  // this in instead of the job silently writing nothing forever.
  console.warn('Pitch Smart page has non-empty-state content -- parser needs to be written. See this script\'s header.');
  return { teams: {}, hasData: false, unparsed: true };
}

async function fetchDivision(divisionId) {
  const url = `https://www.macleague.org/division/${divisionId}/pitchsmart`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed for division ${divisionId}: HTTP ${res.status}`);
  const html = await res.text();
  return parsePitchSmartPage(html);
}

async function main() {
  const divisionIds = process.argv.slice(2);
  if (!divisionIds.length) {
    console.error('Usage: node scripts/scrape-pitchsmart.mjs <divisionId> [<divisionId> ...]');
    process.exit(1);
  }

  let teams = {};
  for (let i = 0; i < divisionIds.length; i++) {
    const id = divisionIds[i];
    console.log(`Fetching Pitch Smart for division ${id}...`);
    const result = await fetchDivision(id);
    console.log(result.hasData ? `  -> ${Object.keys(result.teams).length} teams` : '  -> no data yet (expected off-season)');
    teams = { ...teams, ...result.teams };
    if (i < divisionIds.length - 1) {
      await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
    }
  }

  const outPath = new URL('../data/pitchsmart-cache.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ teams, scrapedAt: new Date().toISOString() }, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)}`);

  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (dbUrl && dbSecret) {
    const pushUrl = `${dbUrl}/shared/pitchSmart.json?auth=${dbSecret}`;
    const putRes = await fetch(pushUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teams) });
    if (!putRes.ok) throw new Error(`Push to Firebase failed: HTTP ${putRes.status}`);
    console.log('Pushed to shared/pitchSmart in Firebase.');
  } else {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET not set -- wrote local cache file only.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
