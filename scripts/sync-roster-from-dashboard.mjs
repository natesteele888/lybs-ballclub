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

   Every team at once (one Dashboard publish, one pull -- the
   "Pull rosters from the Dashboard" button in GitHub Actions runs
   this, see .github/workflows/roster-sync.yml):
     node scripts/sync-roster-from-dashboard.mjs --all            # look only
     node scripts/sync-roster-from-dashboard.mjs --all --apply    # merge into Ballclub
     node scripts/sync-roster-from-dashboard.mjs --all --apply --replace
   --all asks for each team in js/team-registry.js by its teamId (the
   Dashboard's team_id_map.json links each Ballclub teamId to that
   season's drafted team). It prints counts only, never names, because
   a public repo's Actions log is public. A team with nothing published
   is skipped, never emptied. --apply MERGES by default: a player already
   on the Ballclub roster keeps their number, position, bats/throws and
   any full name a coach typed; new players are added; players not on
   the Dashboard roster stay and are counted. --replace starts the
   roster over from the Dashboard (use it once at a new season's start).

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

/* "Jordan Smith", "jordan s" and "Jordan S." all key to "jordan s" -- the
   Dashboard only ever has first name + last initial, while a coach may have
   typed a full last name in Ballclub. */
export function nameKey(name) {
  const parts = String(name || '').trim().toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (parts[0] + ' ' + last).trim();
}

function blankEntry(p) {
  return { id: uid(), name: `${p.first} ${p.last}`.trim(), number: '', position: '', batsThrows: '' };
}

/* Merge the Dashboard's players into a team's existing Ballclub roster.
   Returns { roster, kept, added, extra }. With replace, the existing roster
   is ignored except to keep a matched player's details. A name that matches
   two existing players is added fresh rather than guessed at. */
export function mergeRoster(existing, players, { replace = false } = {}) {
  const current = Array.isArray(existing) ? existing.filter(p => p && p.name) : [];
  const byKey = new Map();
  current.forEach(p => { const k = nameKey(p.name); byKey.set(k, byKey.has(k) ? null : p); });
  const used = new Set();
  const roster = [];
  let kept = 0, added = 0;
  for (const p of players) {
    const match = byKey.get(nameKey(`${p.first} ${p.last}`));
    if (match && !used.has(match)) { used.add(match); roster.push(match); kept++; }
    else { roster.push(blankEntry(p)); added++; }
  }
  const leftover = current.filter(p => !used.has(p));
  if (!replace) roster.push(...leftover);
  return { roster, kept, added, extra: leftover.length };
}

/* teamIds from js/team-registry.js, read the same way the browser does. */
export async function registryTeamIds() {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const src = await readFile(new URL('../js/team-registry.js', import.meta.url), 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  return Object.keys((ctx.window.TEAM_REGISTRY || {}).teams || {});
}

async function firebase(path, init) {
  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  const res = await fetch(`${dbUrl}/${path}.json?auth=${dbSecret}`, init);
  if (!res.ok) throw new Error(`Firebase ${init ? 'write' : 'read'} failed: HTTP ${res.status}`);
  return res.json();
}

async function syncAll({ apply, replace }) {
  if (apply && !(process.env.FIREBASE_DB_URL && process.env.FIREBASE_DB_SECRET)) {
    throw new Error('--apply needs FIREBASE_DB_URL and FIREBASE_DB_SECRET set.');
  }
  const ids = await registryTeamIds();
  const staged = [];
  let failed = 0;
  console.log(`${apply ? (replace ? 'Replacing' : 'Merging') : 'Looking at'} ${ids.length} Ballclub teams${apply ? '' : ' (nothing changes without --apply)'}:`);
  for (const teamId of ids) {
    let players;
    try { players = await fetchRosterPlayers(null, null, null, teamId); }
    catch (err) { console.log(`  ${teamId}: skipped, ${err.message}`); continue; }
    if (!players.length) { console.log(`  ${teamId}: skipped, nothing published`); continue; }
    try {
      const existing = apply ? await firebase(`teams/${teamId}/roster`) : [];
      const m = mergeRoster(Array.isArray(existing) ? existing : Object.values(existing || {}), players, { replace });
      staged.push({ teamId, roster: m.roster });
      if (apply) await firebase(`teams/${teamId}/roster`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m.roster) });
      const extra = m.extra ? (replace ? `, ${m.extra} not on the Dashboard dropped` : `, ${m.extra} not on the Dashboard kept`) : '';
      console.log(`  ${teamId}: ${players.length} on the Dashboard${apply ? ` -> ${m.kept} matched, ${m.added} added${extra}` : ''}`);
    } catch (err) { failed++; console.log(`  ${teamId}: FAILED, ${err.message}`); }
  }
  const outPath = new URL('../data/dashboard-roster-import.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ source: 'lybs-reporting Apps Script, all teams by teamId', fetchedAt: new Date().toISOString(), teams: staged }, null, 2));
  if (failed) throw new Error(`${failed} team(s) failed -- see above. The others went through.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    return syncAll({ apply: args.includes('--apply'), replace: args.includes('--replace') });
  }
  const [yearArg, division, team, teamId] = args;
  if (!yearArg || !division || !team) {
    console.error('Usage: node scripts/sync-roster-from-dashboard.mjs <year> <division> <team> [teamId]');
    console.error('   or: node scripts/sync-roster-from-dashboard.mjs --all [--apply] [--replace]');
    console.error('Example: node scripts/sync-roster-from-dashboard.mjs 2026 Majors "Majors (A)" select');
    process.exit(1);
  }
  const year = Number(yearArg);
  const players = await fetchRosterPlayers(year, division, team, teamId);
  if (!players.length) {
    console.error(`No roster published for year=${year} division="${division}" team="${team}". Check the exact spelling against lybs-reporting's own data -- team names there aren't normalized (e.g. "Majors (A)", not "Select" or "Majors A") -- or ask whoever runs that app to click "Publish team rosters" in publish_data.html if this team hasn't been pushed since the last draft.`);
    process.exit(1);
  }

  const roster = players.map(blankEntry);

  const outPath = new URL('../data/dashboard-roster-import.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ source: `lybs-reporting Apps Script, year=${year} division=${division} team="${team}"`, fetchedAt: new Date().toISOString(), roster }, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)} -- ${roster.length} players:`);
  roster.forEach(p => console.log(`  ${p.name}`));

  if (process.env.FIREBASE_DB_URL && process.env.FIREBASE_DB_SECRET && teamId) {
    await firebase(`teams/${teamId}/roster`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roster) });
    console.log(`Pushed to teams/${teamId}/roster in Firebase -- this REPLACES whatever roster was already there.`);
  } else {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET/[teamId] not all set -- wrote the staging file only. Review it, then re-run with a teamId once ready to apply it.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
