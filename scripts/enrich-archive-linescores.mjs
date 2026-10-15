#!/usr/bin/env node
/* ============================================================
   Enriches data/season-archive.json's already-finished games with
   a real GameChanger line score (runs per inning, plus final
   runs/hits/errors) -- NOT a full box score (per-player stats) or
   a recap, both of which sit behind a GameChanger login with no
   public way around it (confirmed live, 2026-10-15: a real public
   GameChanger team schedule page's Box score tab shows the real
   grid structure but every row is blurred behind a sign-in wall,
   and the Recap tab cuts off after one auto-generated sentence
   behind the same wall). Nathan: "line score is fine if that is
   all that is available."

   One-off / occasionally-rerun, NOT a scheduled job: every game
   here already happened and its line score never changes, so
   there's nothing to keep polling for the way live standings does.
   Re-run this by hand whenever a new season's games (and gcTeamId)
   get added to data/season-archive.json.

   Confirmed live (2026-10-15): api.team-manager.gc.com serves a
   real, unauthenticated JSON API behind GameChanger's own public
   team schedule pages (this is a correction to this app's own
   earlier assumption that GameChanger "has never offered" an API --
   it has one, it's just missing full box score / recap data, and a
   browser can't call it directly: a cross-origin fetch() from a
   different origin was tested live and rejected by CORS, so this
   only works as a server-side script, same as every other scraper
   in this repo):
     GET /public/teams/{gcTeamId}/games
       -> every game this team has on GameChanger, each with its own
          real id (a UUID, not derivable from date/opponent).
     GET /public/game-stream-processing/{gameId}/details?include=line_scores
       -> that game's line_score: {team, opponent_team}, each
          {scores: [runs per inning], totals: [runs, hits, errors]}.
          The two sides' innings arrays can be different lengths --
          a home team already trailing doesn't bat in its last frame
          (confirmed live against a real game: 6 innings for the
          home side, 7 for the away side, same final game).

   Neither api.team-manager.gc.com nor web.gc.com publishes a
   robots.txt (checked live -- both 404/fall through to the app
   shell), so there's no published crawl-delay to honor the way
   macleague.org's scripts do -- this still waits between requests
   rather than firing them all at once, out of the same politeness,
   not because anything requires it.

   Usage:
     node scripts/enrich-archive-linescores.mjs
   ============================================================ */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUEST_DELAY_MS = 1000;
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Matches an archived game ({date:'YYYY-MM-DD', opponent, score:'X-Y'}) to
// one of this team's real GameChanger games. GC's start_ts is UTC; the
// America/New_York LOCAL calendar date is what lines up with the
// archive's own date field (a late-evening ET game can already be the
// next day in UTC). When more than one game lands on the same date, the
// final score disambiguates -- two games against different opponents on
// the same day is the one real case this app's own schedule already
// plans around (a doubleheader), and GC's opponent name rarely matches
// this app's own opponent spelling exactly, so score is the more
// reliable tiebreaker of the two.
function findGcGame(archiveGame, gcGames) {
  const [ourScore, theirScore] = (archiveGame.score || '').split('-').map(s => Number(s.trim()));
  const candidates = gcGames.filter(g => {
    if (!g.start_ts) return false;
    const localDate = new Date(g.start_ts).toLocaleDateString('en-CA', { timeZone: g.timezone || 'America/New_York' });
    return localDate === archiveGame.date;
  });
  if (candidates.length <= 1) return candidates[0] || null;
  return candidates.find(g => g.score && g.score.team === ourScore && g.score.opponent_team === theirScore) || null;
}

function shapeLineScore(raw) {
  if (!raw || !raw.team || !raw.opponent_team) return null;
  const side = s => ({
    innings: s.scores || [],
    runs: s.totals ? s.totals[0] : null,
    hits: s.totals ? s.totals[1] : null,
    errors: s.totals ? s.totals[2] : null,
  });
  return { ours: side(raw.team), theirs: side(raw.opponent_team) };
}

async function main() {
  const path = new URL('../data/season-archive.json', import.meta.url);
  const data = JSON.parse(await readFile(path, 'utf-8'));

  let enriched = 0, noMatch = 0, alreadyHad = 0;
  for (const team of data.teams || []) {
    if (!team.gcTeamId) { console.log(`Skipping ${team.name} -- no gcTeamId.`); continue; }
    console.log(`Fetching GameChanger schedule for ${team.name}...`);
    let gcGames;
    try {
      gcGames = await fetchJson(`https://api.team-manager.gc.com/public/teams/${team.gcTeamId}/games`);
    } catch (e) {
      console.error(`  -> FAILED to fetch schedule: ${e.message}`);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    for (const game of team.games || []) {
      if (game.lineScore) { alreadyHad++; continue; } // don't re-fetch what a prior run already found
      const match = findGcGame(game, gcGames);
      if (!match) { noMatch++; continue; }
      try {
        const details = await fetchJson(`https://api.team-manager.gc.com/public/game-stream-processing/${match.id}/details?include=line_scores`);
        const lineScore = shapeLineScore(details.line_score);
        if (lineScore) { game.lineScore = lineScore; enriched++; }
        else noMatch++;
      } catch (e) {
        console.error(`  -> FAILED line score for ${team.name} vs ${game.opponent} (${game.date}): ${e.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${fileURLToPath(path)}.`);
  console.log(`Enriched ${enriched} games, ${alreadyHad} already had a line score, ${noMatch} had no GameChanger match.`);
}

main().catch(err => { console.error(err); process.exit(1); });
