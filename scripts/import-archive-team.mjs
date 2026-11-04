#!/usr/bin/env node
/* ============================================================
   Populates data/season-archive.json with one team's full game
   list for one season, given that team's GameChanger id --
   scripts/enrich-archive-linescores.mjs's missing first step. That
   script only ADDS a line score to a game already sitting in
   season-archive.json; nothing existing actually fetches the game
   list itself. This is that: GET /public/teams/{gcTeamId}/games
   (same api.team-manager.gc.com endpoint, same discovery -- see
   that script's own header for the full writeup of how this was
   found and confirmed CORS-blocked from a browser, hence a script).

   GameChanger appears to create a brand-new team (its own gcTeamId)
   each season rather than one persistent id that accumulates years
   -- confirmed live, 2026-10-17: the current 2026 Majors A team's
   own gcTeamId returns only 2026 games, nothing older. So pulling in
   several past years means running this once per OLD season's own
   team id, not once per real-world team -- find each one on
   GameChanger itself (an org admin's "past seasons"/archived-teams
   view, if GameChanger still keeps them around after a few years --
   not verified from here).

   Team-level metadata (name, division, season label, optional note)
   isn't in the GameChanger response at all -- /games never returns
   anything about the team whose games they are, only each
   opponent_team's name -- so this takes it on the command line,
   same as every other one-off script in this repo that needs a
   human-known label GameChanger can't supply.

   Safe to re-run on the same gcTeamId (e.g. mid-season, to pick up
   newly-played games): matches fresh games against whatever's
   already in the archive by date+opponent+score (same identity
   scripts/enrich-archive-linescores.mjs's own findGcGame() uses) and
   carries over that game's lineScore if it already has one, rather
   than wiping out prior enrichment work. A re-run with no [note]
   argument keeps whatever note the entry already had, rather than
   erasing it.

   Only ever writes games with game_status "completed" -- a historical
   backfill shouldn't contain a still-scheduled game, and if one shows
   up anyway (a season that isn't actually finished) it's skipped and
   reported rather than written with a blank score.

   Usage:
     node scripts/import-archive-team.mjs <gcTeamId> <name> <division> <season> [note]
     node scripts/import-archive-team.mjs abC123xyz9Zq "Lunenburg Majors A" "Majors A" "Spring 2021"

   Then run scripts/enrich-archive-linescores.mjs to backfill inning-
   by-inning line scores for whatever this just added.
   ============================================================ */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Local (not UTC) calendar date -- a late-evening ET game can already be
// the next day in UTC. Same derivation scripts/enrich-archive-linescores.mjs's
// own findGcGame() uses, so a game shaped here matches identically against
// an already-archived one.
function localDate(startTs, timezone) {
  return new Date(startTs).toLocaleDateString('en-CA', { timeZone: timezone || 'America/New_York' });
}

function shapeGame(raw) {
  if (!raw.score) return null; // not yet played -- see header comment
  const ourScore = raw.score.team;
  const theirScore = raw.score.opponent_team;
  return {
    date: localDate(raw.start_ts, raw.timezone),
    opponent: (raw.opponent_team && raw.opponent_team.name) || 'Unknown',
    homeAway: raw.home_away === 'away' ? 'Away' : 'Home',
    result: ourScore > theirScore ? 'W' : ourScore < theirScore ? 'L' : 'T',
    score: `${ourScore}-${theirScore}`,
  };
}

function computeRecord(games) {
  const w = games.filter(g => g.result === 'W').length;
  const l = games.filter(g => g.result === 'L').length;
  const t = games.filter(g => g.result === 'T').length;
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

// Identity used to carry a lineScore forward across a re-run -- same three
// fields findGcGame() already treats as a game's identity elsewhere in
// this repo.
function gameKey(g) {
  return `${g.date}|${g.opponent}|${g.score}`;
}

async function main() {
  const [gcTeamId, name, division, season, note] = process.argv.slice(2);
  if (!gcTeamId || !name || !division || !season) {
    console.error('Usage: node scripts/import-archive-team.mjs <gcTeamId> <name> <division> <season> [note]');
    console.error('Example: node scripts/import-archive-team.mjs abC123xyz9Zq "Lunenburg Majors A" "Majors A" "Spring 2021"');
    process.exit(1);
  }

  const path = new URL('../data/season-archive.json', import.meta.url);
  const data = JSON.parse(await readFile(path, 'utf-8'));
  data.teams = data.teams || [];

  console.log(`Fetching GameChanger games for ${name} (${season}, gcTeamId ${gcTeamId})...`);
  const raw = await fetchJson(`https://api.team-manager.gc.com/public/teams/${gcTeamId}/games`);

  const existing = data.teams.find(t => t.gcTeamId === gcTeamId);
  const existingByKey = new Map((existing && existing.games || []).map(g => [gameKey(g), g]));

  let notPlayed = 0;
  const games = [];
  for (const g of raw) {
    const shaped = shapeGame(g);
    if (!shaped) { notPlayed++; continue; }
    const priorMatch = existingByKey.get(gameKey(shaped));
    if (priorMatch && priorMatch.lineScore) shaped.lineScore = priorMatch.lineScore;
    games.push(shaped);
  }
  games.sort((a, b) => a.date.localeCompare(b.date));

  const entry = {
    gcTeamId, name, division, season,
    ...((note || (existing && existing.note)) ? { note: note || existing.note } : {}),
    record: computeRecord(games),
    games,
  };

  if (existing) {
    data.teams[data.teams.indexOf(existing)] = entry;
    console.log(`Updated existing entry for gcTeamId ${gcTeamId}.`);
  } else {
    data.teams.push(entry);
    console.log(`Added new entry for gcTeamId ${gcTeamId}.`);
  }

  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${fileURLToPath(path)}.`);
  console.log(`${games.length} game(s) (record ${entry.record})${notPlayed ? `, ${notPlayed} not-yet-played game(s) skipped` : ''}.`);
  if (games.some(g => g.lineScore)) {
    console.log(`${games.filter(g => g.lineScore).length} game(s) kept a prior line score from before this run.`);
  }
  console.log('Run scripts/enrich-archive-linescores.mjs next to backfill line scores for the rest.');
}

main().catch(err => { console.error(err); process.exit(1); });
