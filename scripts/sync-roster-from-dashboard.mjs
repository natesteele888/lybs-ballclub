#!/usr/bin/env node
/* ============================================================
   Pulls a team's roster from lybs-reporting's already-published,
   already-scrubbed data.js -- the dashboard's live draft tool
   writes picks into its own admin-only cloud bin, not that file; a
   human still transcribes the real result into manual_players.json
   (or Crossbar) by hand (see that repo's CLAUDE.md and draft.js).
   data.js is the actual system of record this reads from, same as
   the dashboard's own public site does.

   This is a LOCAL, filesystem-to-filesystem read of the sibling
   repo's committed data.js -- never a network fetch. That matters:
   lybs-reporting deliberately stopped shipping data.js as a public
   script file (see that repo's commit history -- "Keep the report
   builder and the test suite off the public site" and friends), so
   it's no longer reachable without signing into that app. Reading
   the committed file straight off disk, the way a human maintaining
   both repos would, respects that boundary instead of routing
   around it; this script refuses to run if it can't find the file
   locally, rather than guessing at a URL.

   Only pulls fields already safe to commit per that repo's own
   privacy table: first name + last initial, sport, division, team,
   year. Never amount (registration fee), gender, or anything else.
   Number/position/bats-throws aren't tracked there at all -- those
   stay blank for the coach to fill in after import, same as any
   other roster entry added by hand.

   Usage:
     node scripts/sync-roster-from-dashboard.mjs <year> <division> <team> [teamId]
     node scripts/sync-roster-from-dashboard.mjs 2026 Majors "Majors (A)" select

   Writes data/dashboard-roster-import.json (gitignored -- a
   transient staging file, not something the app reads directly).
   With FIREBASE_DB_URL/FIREBASE_DB_SECRET set AND a [teamId], also
   OVERWRITES that team's live roster in Firebase -- review the
   staged file first; this does not merge with whatever's there.
   ============================================================ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DASHBOARD_DATA_JS = new URL('../../lybs-reporting/data.js', import.meta.url);

async function loadDashboardData() {
  let text;
  try {
    text = await readFile(DASHBOARD_DATA_JS, 'utf8');
  } catch (e) {
    throw new Error(`Can't find ${fileURLToPath(DASHBOARD_DATA_JS)} -- this only works as a local, filesystem-to-filesystem read of the sibling lybs-reporting checkout, never a network fetch (see this script's header). Make sure both repos are checked out as siblings.`);
  }
  const jsonStr = text.replace(/^const INITIAL_DATA = /, '').replace(/;\s*$/, '');
  return JSON.parse(jsonStr);
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
  const data = await loadDashboardData();
  const matches = data.filter(p => p.year === year && p.division === division && p.team === team);
  if (!matches.length) {
    console.error(`No records found for year=${year} division="${division}" team="${team}". Check the exact spelling against the dashboard's own data -- team names there aren't normalized (e.g. "Majors (A)", not "Select" or "Majors A").`);
    process.exit(1);
  }

  const roster = matches.map(p => ({
    id: uid(),
    name: `${p.first} ${p.last}`,
    number: '',
    position: '',
    batsThrows: '',
  }));

  const outPath = new URL('../data/dashboard-roster-import.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ source: `lybs-reporting data.js, year=${year} division=${division} team="${team}"`, fetchedAt: new Date().toISOString(), roster }, null, 2));
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
