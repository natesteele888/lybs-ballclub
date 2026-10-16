#!/usr/bin/env node
/* ============================================================
   Pulls a team's roster from lybs-reporting over the same Apps
   Script endpoint Ways-to-Help / Post Review / photo intake
   already use (see that repo's apps-script/Code.gs -- action
   'roster', key-gated the same way list/decide/sync-board are).

   This used to read lybs-reporting's committed data.js straight
   off disk as a sibling checkout -- that only ever worked from
   one machine with both repos checked out side by side, and
   stopped matching how lybs-reporting actually ships data.js once
   that repo moved it behind login (see that repo's commit
   history -- "Keep the report builder and the test suite off the
   public site" and friends). Going through Code.gs instead -- the
   one surface lybs-reporting already exposes to the outside world
   -- works from anywhere once you have the endpoint URL and review
   key, the same two secrets Post Review already needs over there.

   A human still has to run "Publish team rosters" from
   lybs-reporting's publish_data.html after a draft result gets
   hand-transcribed into manual_players.json and process.py
   regenerates data.js -- this script only ever reads what's
   already been published, same as before.

   Only pulls fields already safe to commit per that repo's own
   privacy table: first name + last initial, sport, division, team,
   year. Never amount (registration fee), gender, or anything else.
   Number/position/bats-throws aren't tracked there at all -- those
   stay blank for the coach to fill in after import, same as any
   other roster entry added by hand.

   Usage:
     LYBS_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec \
     LYBS_REVIEW_KEY=... \
     node scripts/sync-roster-from-dashboard.mjs <year> <division> <team> [teamId]
     node scripts/sync-roster-from-dashboard.mjs 2026 Majors "Majors (A)" select

   Writes data/dashboard-roster-import.json (gitignored -- a
   transient staging file, not something the app reads directly).
   With FIREBASE_DB_URL/FIREBASE_DB_SECRET set AND a [teamId], also
   OVERWRITES that team's live roster in Firebase -- review the
   staged file first; this does not merge with whatever's there.
   ============================================================ */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function fetchRosterPlayers(year, division, team, teamId) {
  const endpoint = process.env.LYBS_APPS_SCRIPT_URL;
  const key = process.env.LYBS_REVIEW_KEY;
  if (!endpoint || !key) {
    throw new Error('Set LYBS_APPS_SCRIPT_URL and LYBS_REVIEW_KEY first -- the same Apps Script URL and review key lybs-reporting\'s Post Review tab uses (Board -> Post Review -> Settings over there). Ask whoever runs that app if you don\'t have them.');
  }
  // text/plain, not application/json -- same reasoning as every other page
  // that talks to this endpoint: Apps Script's web app redirects through
  // googleusercontent.com, and a JSON content-type triggers a CORS preflight
  // that redirect can't answer.
  const body = teamId
    ? { action: 'roster', key, teamId }
    : { action: 'roster', key, year, division, team };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `Apps Script refused that (HTTP ${res.status}).`);
  return data.players || [];
}

function uid() { return 'r' + Date.now() + Math.random().toString(36).slice(2, 7); }

async function main() {
  const [yearArg, division, team, teamId] = process.argv.slice(2);
  if (!yearArg || !division || !team) {
    console.error('Usage: node scripts/sync-roster-from-dashboard.mjs <year> <division> <team> [teamId]');
    console.error('Example: node scripts/sync-roster-from-dashboard.mjs 2026 Majors "Majors (A)" select');
    process.exit(1);
  }
  const year = Number(yearArg);
  const players = await fetchRosterPlayers(year, division, team, teamId);
  if (!players.length) {
    console.error(`No roster published for year=${year} division="${division}" team="${team}". Check the exact spelling against lybs-reporting's own data -- team names there aren't normalized (e.g. "Majors (A)", not "Select" or "Majors A") -- or ask whoever runs that app to click "Publish team rosters" in publish_data.html if this team hasn't been pushed since the last draft.`);
    process.exit(1);
  }

  const roster = players.map(p => ({
    id: uid(),
    name: `${p.first} ${p.last}`,
    number: '',
    position: '',
    batsThrows: '',
  }));

  const outPath = new URL('../data/dashboard-roster-import.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ source: `lybs-reporting Apps Script, year=${year} division=${division} team="${team}"`, fetchedAt: new Date().toISOString(), roster }, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)} -- ${roster.length} players:`);
  roster.forEach(p => console.log(`  ${p.name}`));

  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (dbUrl && dbSecret && teamId) {
    const pushUrl = `${dbUrl}/teams/${teamId}/roster.json?auth=${dbSecret}`;
    const putRes = await fetch(pushUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roster) });
    if (!putRes.ok) throw new Error(`Push to Firebase failed: HTTP ${putRes.status}`);
    console.log(`Pushed to teams/${teamId}/roster in Firebase -- this REPLACES whatever roster was already there.`);
  } else {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET/[teamId] not all set -- wrote the staging file only. Review it, then re-run with a teamId once ready to apply it.');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
