#!/usr/bin/env node
/* ============================================================
   Mirrors each MAC League team's own public page -- schedule,
   roster, and coaching staff (name/role, plus phone/email ONLY
   when that team's own page actually publishes them) -- into
   data/team-details-cache.json, and -- if FIREBASE_DB_URL and
   FIREBASE_DB_SECRET are set -- also pushes the result into
   shared/macLeagueTeamDetails, which js/team-page.js reads.

   Nathan: "this needs to be there on the site - not click to go
   off site to macleague site - bring the data from the public
   facing site. When coaches info and names are not available
   there, then we don't have them available on our side." This is
   that mirror -- js/team-page.js no longer links out, it renders
   whatever's here. A team with no staff/roster entries mirrored
   just shows nothing for that section, same honest-degrade
   discipline as every other mirror in this codebase (scrape-
   standings.mjs's isUs, scrape-pitchsmart.mjs's empty state) --
   never a guess at what a team hasn't published.

   Same politeness rules as scrape-standings.mjs: scheduled job
   only (see .github/workflows/team-details.yml), never fetched
   live from a visitor's browser, 5s crawl-delay between every
   single request (confirmed live against macleague.org/robots.txt
   -- "Disallow: /schedule", "Crawl-delay: 5"). /team/{id},
   /team/{id}/roster, and /team/{id}/games are all distinct paths
   from the disallowed /schedule and were fetched live to confirm
   their real structure before writing this (2026-10-15) -- see
   each parse function's own comment for what was actually seen.

   Three fetches per team (home/staff, roster, games), one
   crawl-delay apart each -- team details change far less often
   than live scores, so this runs on its own, much less frequent
   schedule than standings.yml's every-30-minutes (see
   team-details.yml), not as an extra step tacked onto that job.

   Team IDs come from data/standings-cache.json's own rows (every
   team scrape-standings.mjs already knows about, across every
   division) rather than re-discovering them -- pass explicit ids
   on the command line to scrape a subset instead.

   Usage:
     node scripts/scrape-team-details.mjs [teamId ...]
     node scripts/scrape-team-details.mjs                # every team in data/standings-cache.json
     node scripts/scrape-team-details.mjs 289743 284619   # just these two
   ============================================================ */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRAWL_DELAY_MS = 5000; // matches macleague.org's robots.txt "Crawl-delay: 5"
const USER_AGENT = 'LYBSBallclubStandingsBot/1.0 (+https://github.com/ -- contact league for questions)';

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed for ${url}: HTTP ${res.status}`);
  return res.text();
}

// Confirmed live (2026-10-15, a real Fall-season team page): a
// "2026 Fall" <span class="label label-org"> near the top, and a
// "Staff" <h3>, each coach as its own <p class="team_staff">:
// <strong>Name</strong><Br>Role, then an OPTIONAL phone line and an
// OPTIONAL email link -- a team with no phone/email published for
// someone just omits those lines entirely (confirmed: a real
// Assistant Coach entry with name+role only, nothing else). The
// team_staff class is used nowhere else on the page (confirmed by
// count against the real number of coaches shown), so splitting the
// whole page on it is safe -- no need to scope to "after the header"
// first.
function parseStaffAndSeason(html) {
  const seasonMatch = html.match(/<span class="label label-org">\s*(\d{4})\s+(\w+)\s*<\/span>/);
  const season = seasonMatch ? { year: Number(seasonMatch[1]), label: `${seasonMatch[1]} ${seasonMatch[2]}` } : null;
  // The "Staff" <h3> itself -- not just the coach entries beneath it -- is
  // OMITTED ENTIRELY for a team that hasn't published any staff at all
  // (confirmed live: a real team with zero coaches listed has no Staff
  // heading anywhere on its page), so a missing header can't be used to
  // detect a changed page template the way every other parser in this
  // file uses its own section header. "found" (whether this page loaded
  // at all) is checked against the page's own team-name <h1> instead.
  const pageFound = /<h1[^>]*>\s*[^<]+?\s*<\/h1>/.test(html);
  if (!pageFound) return { found: false, season, staff: [] };
  const blocks = html.split('<p class="team_staff">').slice(1);
  const staff = blocks.map(blk => {
    const body = blk.split('</p>')[0];
    const nameMatch = body.match(/<strong>\s*([^<]+?)\s*<\/strong>/);
    const afterName = body.split('</strong>')[1] || '';
    const roleMatch = afterName.match(/<Br>\s*([^<]+?)\s*(?:<br>|$)/i);
    const phoneMatch = body.match(/fa-phone"><\/i>\s*([^<]+?)\s*(?:<br>|<\/p>|$)/);
    const emailMatch = body.match(/href='(\/email\/[^']+)'/);
    return {
      name: nameMatch ? nameMatch[1].trim() : null,
      role: roleMatch ? roleMatch[1].trim() : null,
      phone: phoneMatch ? phoneMatch[1].trim() : null,
      emailUrl: emailMatch ? `https://www.macleague.org${emailMatch[1]}` : null,
    };
  }).filter(s => s.name);
  return { found: true, season, staff };
}

// Confirmed live against 14 real teams across all three divisions
// (2026-10-15): every one of them currently has an EMPTY roster --
// <div class="row equal_height" data-target=".participant"> with
// nothing inside. No real populated example exists right now to
// verify a player-card's markup against, so this deliberately only
// ever confirms the known-empty state (same honest-stub approach
// scrape-pitchsmart.mjs already uses for the same reason) -- flags
// `unparsed: true` rather than guessing if it ever finds this
// container non-empty, so a human notices and finishes this once
// real data exists to look at.
function parseRoster(html) {
  const found = /<div class="row equal_height" data-target="\.participant">/.test(html);
  if (!found) return { found: false, players: [], unparsed: false };
  const after = html.split('<div class="row equal_height" data-target=".participant">')[1] || '';
  const body = after.split('</div>')[0];
  if (!body.trim()) return { found: true, players: [], unparsed: false };
  return { found: true, players: [], unparsed: true };
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function pad2(n) { return String(n).padStart(2, '0'); }

// Confirmed live (2026-10-15, a real 7-game Fall schedule): a
// "Game Schedule" <h3>, then one <div class="box" style="margin-
// top:10px;"> per game -- month/day as two separate <h1>s (no year
// on the game itself; the page's own season label above supplies
// it, safe for a single season that never crosses a year boundary),
// an "@ " or "vs. " <span> plus the opponent name, an optional
// Google-Maps-linked location <p>, and a <h3 class="mb10"> that's
// EITHER a kickoff time (not yet played) OR "{this team's score} -
// {opponent's score} (W|L|T)" (played) -- confirmed both live on
// real teams with a mix of each. No separate box-score anywhere
// else on the page -- this (this team's own reported result) is a
// second, independent source of a completed game's score alongside
// the standings mirror's own RF/RA totals, not a replacement for it.
function parseGames(html, seasonYear) {
  const headerFound = /<h3><i class="fas fa-calendar-alt"><\/i> Game Schedule<\/h3>/.test(html);
  if (!headerFound) return { found: false, games: [] };
  const boxes = html.split('<div class="box" style="margin-top:10px;">').slice(1);
  const games = boxes.map(chunk => {
    const monthMatch = chunk.match(/font-size:25px;[^>]*>([A-Za-z]{3})<\/h1>/);
    const dayMatch = chunk.match(/font-size:45px;[^>]*>(\d+)<\/h1>/);
    const matchupMatch = chunk.match(/<span class="small">(@|vs\.)\s*<\/span>\s*([^<]+?)\s*<\/h2>/);
    const locMatch = chunk.match(/<p><a target="_blank" href="([^"]+)">([^<]+)<\/a><\/p>/);
    const statusMatch = chunk.match(/<h3 class="mb10"[^>]*>([\s\S]*?)<\/h3>/);
    const statusBody = statusMatch ? statusMatch[1] : '';
    const scoreMatch = statusBody.match(/(\d+)\s*-\s*(\d+)\s*\(\s*(W|L|T)\s*\)/);
    const timeMatch = !scoreMatch && statusBody.match(/([\d: ]+(?:AM|PM))/);
    const month = monthMatch ? MONTHS[monthMatch[1]] : null;
    const day = dayMatch ? Number(dayMatch[1]) : null;
    const date = (month && day && seasonYear) ? `${seasonYear}-${pad2(month)}-${pad2(day)}` : null;
    return {
      date,
      homeAway: matchupMatch && matchupMatch[1] === '@' ? 'Away' : (matchupMatch ? 'Home' : null),
      opponent: matchupMatch ? matchupMatch[2].trim() : null,
      time: timeMatch ? stripTags(timeMatch[1]) : null,
      ourScore: scoreMatch ? Number(scoreMatch[1]) : null,
      oppScore: scoreMatch ? Number(scoreMatch[2]) : null,
      result: scoreMatch ? scoreMatch[3] : null,
      location: locMatch ? locMatch[2].trim() : null,
      mapUrl: locMatch ? locMatch[1] : null,
    };
  }).filter(g => g.date && g.opponent);
  return { found: true, games };
}

async function fetchTeam(teamId) {
  const homeHtml = await fetchPage(`https://www.macleague.org/team/${teamId}`);
  const { found: pageFound, season, staff } = parseStaffAndSeason(homeHtml);
  if (!pageFound) throw new Error(`Team ${teamId}: couldn't find the team name on its own home page -- page structure may have changed`);
  const nameMatch = homeHtml.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);

  await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  const rosterHtml = await fetchPage(`https://www.macleague.org/team/${teamId}/roster`);
  const { found: rosterFound, players, unparsed } = parseRoster(rosterHtml);
  if (!rosterFound) throw new Error(`Team ${teamId}: couldn't find the Roster section -- page structure may have changed`);
  if (unparsed) console.warn(`Team ${teamId}: roster has real content but this parser has never seen a populated example -- see parseRoster's header comment, needs a human to look and finish it.`);

  await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  const gamesHtml = await fetchPage(`https://www.macleague.org/team/${teamId}/games`);
  const { found: gamesFound, games } = parseGames(gamesHtml, season ? season.year : null);
  if (!gamesFound) throw new Error(`Team ${teamId}: couldn't find the Game Schedule section -- page structure may have changed`);

  return {
    teamId,
    name: nameMatch ? nameMatch[1].trim() : null,
    season: season ? season.label : null,
    staff,
    roster: players,
    games,
    fetchedAt: new Date().toISOString(),
  };
}

async function defaultTeamIds() {
  const cachePath = new URL('../data/standings-cache.json', import.meta.url);
  let data;
  try {
    data = JSON.parse(await readFile(cachePath, 'utf-8'));
  } catch (e) {
    throw new Error(`No team ids given and couldn't read ${fileURLToPath(cachePath)} to find every known team -- run scrape-standings.mjs first, or pass explicit team ids.`);
  }
  // Prefers allTeams (scrape-standings.mjs's own team-directory union,
  // see that script's parseTeamDirectory) over flattening divisions[].rows
  // -- a real team can have no standings row of its own (confirmed live:
  // "8u Littleton Navy," team 289743, has real games but the Rookies
  // standings table only lists 9 of the division's real 10 teams), and
  // rows is exactly where that team would silently go missing from this
  // list. Falls back to rows for a standings-cache.json written before
  // allTeams existed, rather than erroring on an otherwise-usable file.
  if (Array.isArray(data.allTeams) && data.allTeams.length) {
    return data.allTeams.map(t => t.teamId).filter(Boolean);
  }
  const ids = [];
  Object.values(data.divisions || {}).forEach(div => (div.rows || []).forEach(r => { if (r.teamId) ids.push(r.teamId); }));
  return ids;
}

async function main() {
  const teamIds = process.argv.slice(2).length ? process.argv.slice(2) : await defaultTeamIds();
  if (!teamIds.length) throw new Error('No team ids to scrape.');

  const teams = {};
  for (let i = 0; i < teamIds.length; i++) {
    const id = teamIds[i];
    console.log(`Fetching team ${id} (${i + 1}/${teamIds.length})...`);
    try {
      teams[id] = await fetchTeam(id);
      console.log(`  -> ${teams[id].name}: ${teams[id].staff.length} staff, ${teams[id].roster.length} roster, ${teams[id].games.length} games`);
    } catch (e) {
      // One team's page being down/changed shouldn't throw away every
      // other team already fetched this run -- logged loudly so it's
      // not silently missed, but the job still writes everyone else.
      console.error(`  -> FAILED: ${e.message}`);
    }
    if (i < teamIds.length - 1) {
      await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
    }
  }

  const result = { teams, scrapedAt: new Date().toISOString() };

  const outPath = new URL('../data/team-details-cache.json', import.meta.url);
  await mkdir(dirname(fileURLToPath(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${fileURLToPath(outPath)}`);

  const dbUrl = process.env.FIREBASE_DB_URL;
  const dbSecret = process.env.FIREBASE_DB_SECRET;
  if (dbUrl && dbSecret) {
    const pushUrl = `${dbUrl}/shared/macLeagueTeamDetails.json?auth=${dbSecret}`;
    const putRes = await fetch(pushUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
    if (!putRes.ok) throw new Error(`Push to Firebase failed: HTTP ${putRes.status}`);
    console.log('Pushed to shared/macLeagueTeamDetails in Firebase.');
  } else {
    console.log('FIREBASE_DB_URL/FIREBASE_DB_SECRET not set -- wrote local cache file only.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
