#!/usr/bin/env node
/* ============================================================
   Pulls one team's contacts from lybs-reporting over the same
   Apps Script endpoint scripts/sync-roster-from-dashboard.mjs
   already uses (see that repo's apps-script/Code.gs -- action
   'contact', fed by that repo's publish_contacts.py, a LOCAL
   script a human reviews before anything is sent -- see its own
   docstring and lybs-reporting's CLAUDE.md "Contacts Carve-Out"
   section).

   Deliberately NOT a whole-roster replace the way this team's
   roster was first created. A roster already exists by the time
   contacts are available (the draft happens, THEN rosters get
   pushed, THEN contacts can be pulled) -- overwriting the whole
   array the way the roster-sync script does would blow away
   number/position/batsThrows a coach has since filled in. This
   fetches the CURRENT roster first, merges each contact's email
   onto the matching entry by name, and only then PUTs the merged
   array back -- one request each way, nothing else touched.

   Matches by exact name (case-insensitive) against each roster
   entry's own .name field -- the only join key available once a
   roster already exists as free-text names, not player ids shared
   across both apps. A name that doesn't match anything (typo,
   nickname entered differently, two kids with the same name) is
   reported and skipped rather than guessed at -- same philosophy
   lybs-reporting's own process.py uses for its overrides.

   Usage:
     LYBS_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec \
     LYBS_REVIEW_KEY=... \
     node scripts/sync-contacts-from-dashboard.mjs <year> <division> <team> <teamId>
     node scripts/sync-contacts-from-dashboard.mjs 2026 Majors "Select" select

   Always writes data/dashboard-contacts-import.json (gitignored --
   a transient staging file, not something the app reads directly)
   so what was fetched can be reviewed even if nothing gets merged.
   With FIREBASE_DB_URL/FIREBASE_DB_SECRET set, ALSO fetches the
   team's current roster, merges matched emails into it, and PUTs
   the merged roster back -- review the staged file first; this
   does not ask again before writing.
   ============================================================ */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function fetchContacts(year, division, team) {
  const endpoint = process.env.LYBS_APPS_SCRIPT_URL;
  const key = process.env.LYBS_REVIEW_KEY;
  if (!endpoint || !key) {
    throw new Error('Set LYBS_APPS_SCRIPT_URL and LYBS_REVIEW_KEY first -- the same Apps Script URL and review key the roster sync script uses.');
  }
  // text/plain, not application/json -- same reasoning as every other script
  // that talks to this endpoint: Apps Script's web app redirects through
  // googleusercontent.com, and a JSON content-type triggers a CORS preflight
  // that redirect can't answer.
  const body = { action: 'contact', key, year, division, team };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `Apps Script refused that (HTTP ${res.status}).`);
  return data.contacts || [];
}

function normName(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

async function main() {
  const [yearArg, division, team, teamId] = process.argv.slice(2);
  if (!yearArg || !division || !team || !teamId) {
    console.error('Usage: node scripts/sync-contacts-from-dashboard.mjs <year> <division> <team> <teamId>');
    console.error('Example: node scripts/sync-contacts-from-dashboard.mjs 2026 Majors "Select" select');
    process.exit(1);
  }
  const year = Number(yearArg);
  const contacts = await fetchContacts(year, division, team);
  if (!contacts.length) {
    console.error(`No contacts published for year=${year} division="${division}" team="${team}". Check the spelling matches lybs-reporting's own data exactly, or ask whoever runs that app to run publish_contacts.py --publish if this team hasn't been pushed since the last draft.`);
    process.exit(1);
  }

  const outPath = new URL('../data/dashboard-contacts-import.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify({ source: `lybs-reporting Apps Script, year=${year} division=${division} team="${team}"`, fetchedAt: new Date().toISOString(), contacts }, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)} -- ${contacts.length} contact(s) (names shown, emails withheld from this log):`);
  contacts.forEach(c => console.log(`  ${c.first} ${c.last}`));

  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (!dbUrl || !dbSecret) {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET not set -- wrote the staging file only. Review it, then re-run with those set once ready to merge into the live roster.');
    return;
  }

  const rosterUrl = `${dbUrl}/teams/${teamId}/roster.json?auth=${dbSecret}`;
  const getRes = await fetch(rosterUrl);
  if (!getRes.ok) throw new Error(`Could not read the current roster: HTTP ${getRes.status}`);
  const roster = (await getRes.json()) || [];
  if (!Array.isArray(roster) || !roster.length) {
    throw new Error(`teams/${teamId}/roster is empty or missing -- push the roster itself first (sync-roster-from-dashboard.mjs), contacts merge onto an existing roster, they don't create one.`);
  }

  let merged = 0;
  const unmatched = [];
  contacts.forEach(c => {
    const target = normName(`${c.first} ${c.last}`);
    const matches = roster.filter(p => normName(p.name) === target);
    if (matches.length === 1) {
      matches[0].email = c.email;
      merged++;
    } else {
      unmatched.push({ name: `${c.first} ${c.last}`, reason: matches.length === 0 ? 'no roster entry with this exact name' : `${matches.length} roster entries share this name` });
    }
  });

  const putRes = await fetch(rosterUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roster) });
  if (!putRes.ok) throw new Error(`Push to Firebase failed: HTTP ${putRes.status}`);
  console.log(`Merged ${merged}/${contacts.length} email(s) into teams/${teamId}/roster -- number/position/batsThrows on every entry left untouched.`);
  if (unmatched.length) {
    console.log(`${unmatched.length} contact(s) could not be matched by name -- check these by hand (roster.js's own edit form, or fix the name and re-run):`);
    unmatched.forEach(u => console.log(`  ${u.name}: ${u.reason}`));
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
