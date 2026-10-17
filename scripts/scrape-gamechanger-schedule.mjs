#!/usr/bin/env node
/* ============================================================
   Mirrors each team's own live GameChanger schedule into
   teams/{teamId}/gameChangerSchedule, the same api.team-manager.gc.com
   endpoint scripts/enrich-archive-linescores.mjs already proved out
   (see that script's own header for the full discovery writeup: a
   real, unauthenticated, CORS-blocked-from-browsers JSON API behind
   GameChanger's public team pages). That script enriches already-
   finished archived games by hand, one-off; this is the scheduled,
   in-season counterpart -- the "pull schedule changes on app open"
   piece js/gamechanger.js's pasted-widget-only mode didn't cover
   (see that file's own header for the UI half of this feature: a
   board member pastes the team's gcTeamId there, once, through the
   app; this script is what turns that into live data).

   GET /public/teams/{gcTeamId}/games -> every game this team has on
   GameChanger. Confirmed live, 2026-10-17, against a real past
   season's gcTeamId (data/season-archive.json's own): each entry is
   {id, opponent_team: {name, avatar_url?}, start_ts, end_ts,
   timezone, home_away, score: {team, opponent_team}, game_status,
   ...}. No venue/location field exists in this response at all --
   don't invent one. avatar_url (when present) is a short-lived signed
   URL, not worth storing -- dropped below, same as every field this
   script doesn't actually use.

   Where the gcTeamId list comes from: js/team-registry.js is this
   app's own single source of truth for "every team we know about"
   (its own header comment says so) -- not a committed JSON file this
   script could import directly (it's a plain classic <script> that
   assigns window.TEAM_REGISTRY, no ESM export), so this reads it as
   text and runs it in a throwaway vm context with `window` stubbed,
   same idea as reading a browser global from Node. For EACH team id
   found that way, this then reads teams/{teamId}/gcTeamId from the
   real database (board-settable through the app, js/gamechanger.js --
   nothing here ever sets it) -- a team with none set is skipped, not
   an error, since most teams won't have one yet.

   Unlike every other scraper in this repo, there's no meaningful
   local-only stage: the gcTeamId list this script needs to do
   anything at all only exists in the real database, not a committed
   or gitignored local file -- so FIREBASE_DB_URL/FIREBASE_DB_SECRET
   are required up front, not optional-with-a-local-fallback the way
   scrape-team-details.mjs's are. Still writes a local gitignored
   cache file alongside the push, for the same debuggability every
   other scraper here gets.

   Usage:
     FIREBASE_DB_URL=... FIREBASE_DB_SECRET=... node scripts/scrape-gamechanger-schedule.mjs
   ============================================================ */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, fileURLToPath } from 'node:path';
import vm from 'node:vm';

const REQUEST_DELAY_MS = 1000;
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function knownTeamIds() {
  const path = new URL('../js/team-registry.js', import.meta.url);
  const src = await readFile(path, 'utf-8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const teams = (sandbox.window.TEAM_REGISTRY && sandbox.window.TEAM_REGISTRY.teams) || {};
  return Object.keys(teams);
}

// Projects a raw GC game down to just what a schedule view needs --
// see this file's own header for why nothing else (avatar_url,
// has_videos_available, is_full_day, end_ts) is worth keeping.
function shapeGame(raw) {
  return {
    id: raw.id,
    opponent: (raw.opponent_team && raw.opponent_team.name) || null,
    startTs: raw.start_ts || null,
    timezone: raw.timezone || 'America/New_York',
    homeAway: raw.home_away || null,
    status: raw.game_status || null,
    ourScore: raw.score ? raw.score.team : null,
    theirScore: raw.score ? raw.score.opponent_team : null,
  };
}

async function main() {
  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (!dbUrl || !dbSecret) {
    throw new Error('FIREBASE_DB_URL and FIREBASE_DB_SECRET are both required -- unlike other scrapers here, the gcTeamId list this script needs only exists in the real database, there is no local fallback.');
  }

  const teamIds = await knownTeamIds();
  const results = {};

  for (const teamId of teamIds) {
    const gcTeamId = await fetch(`${dbUrl}/teams/${teamId}/gcTeamId.json?auth=${dbSecret}`)
      .then(r => r.json()).catch(() => null);
    if (!gcTeamId) { console.log(`Skipping ${teamId} -- no gcTeamId set.`); continue; }

    console.log(`Fetching GameChanger schedule for ${teamId} (gcTeamId ${gcTeamId})...`);
    let games;
    try {
      games = await fetchJson(`https://api.team-manager.gc.com/public/teams/${gcTeamId}/games`, { 'User-Agent': USER_AGENT });
    } catch (e) {
      console.error(`  -> FAILED: ${e.message}`);
      continue;
    }
    results[teamId] = { games: games.map(shapeGame), fetchedAt: new Date().toISOString() };
    console.log(`  -> ${results[teamId].games.length} game(s)`);

    const putRes = await fetch(`${dbUrl}/teams/${teamId}/gameChangerSchedule.json?auth=${dbSecret}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results[teamId]),
    });
    if (!putRes.ok) console.error(`  -> Push to Firebase failed: HTTP ${putRes.status}`);
    else console.log(`  -> Pushed to teams/${teamId}/gameChangerSchedule.`);

    await sleep(REQUEST_DELAY_MS);
  }

  const outPath = new URL('../data/gamechanger-schedule-cache.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ teams: results, scrapedAt: new Date().toISOString() }, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
