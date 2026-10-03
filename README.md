# LYBS Ballclub

A team app for LYBS baseball/softball teams, modeled on the [ASL Bengals](https://natesteele888.github.io/ASL-Bengals/dev2/) app's pattern (static PWA, Firebase Realtime Database, shared-code login) but built multi-tenant from the start so one deployment can serve every team -- starting with **Select (Lunenburg A / Majors-A)**.

No build step: open `index.html` (or run a static server) and it runs. Runs entirely on **mock data in your browser's localStorage** until you wire up a real Firebase project -- see "Go live" below.

## What's here

- **Schedule / Practices / Roster** -- CRUD tabs, coach-editable, read-only for everyone else.
- **GameChanger widget** -- paste the Scoreboard Widget snippet from `web.gc.com -> Tools -> Create Scoreboard Widget`; it renders in a sandboxed iframe. Display-only -- GameChanger has no API, so this is never a data source for the calendar or anything else.
- **MAC League standings** -- mirrored from `macleague.org` by `scripts/scrape-standings.mjs`, run on a schedule (`.github/workflows/standings.yml`), never fetched live from the browser. See that script's header comment for why.
- **Rules search & save** -- MAC League's full set of rulebooks (`data/rules-seed.json`, pulled from `macleague.org/coaching-resources/...`, last refreshed for the 2026 season -- see that file's `season`/`fetchedAt` fields): Rookies, Minors, Majors, Juniors & Seniors each have their own rules (they genuinely differ), plus General, Playoff, Operating Guidelines and All-Stars Information that apply more broadly. Searchable, filterable by division (a division's rules + General show together, since the league's own rules are written that way), with a per-device "pin for quick reference." Rules get amended mid-season -- several entries carry the league's own "(Updated .../changed on ...)" notes -- so re-pull this each offseason at minimum.
- **My Calendar** -- downloads an `.ics` file combining every team this device has logged into. Built from our own Schedule/Practices data, not synced from GameChanger (no feed exists to sync from).
- **History** -- past-season archive (currently Spring/Summer 2026): schedule/scores pulled from each team's public GameChanger page, rosters supplied by the coach (GameChanger gates rosters behind login). Player names are reduced to first name + last initial before being written anywhere.
- **Club badges** -- Standings, History, and the live Schedule tab fuzzy-match opponent names against MAC League's 10 towns (`data/mac-league-clubs.json`, `js/club-logos.js`) and show that town's badge. Hotlinked straight to `macleague.org`'s own hosted images (`crossbar.s3.amazonaws.com`) -- never downloaded or re-hosted here, same display purpose the league's own site already uses them for.
- **Result cards** -- every completed game (all of History, plus any played game on the live Schedule tab) renders as a big two-logo result card -- our crest and the opponent's badge, huge score numbers, a colored W/L/T pill (`js/game-card.js`). Games without a score yet stay in the compact list row.

## Design

Palette in `css/styles.css` is sampled directly from the real crest (`/Volumes/AutoNuvo_1/LYBS Assets/PNG/LYBS_Primary_Logo.png`), not eyeballed:

| Token | Hex | Where it came from |
|---|---|---|
| `--lybs-blue` | `#2E52E8` | Knight's cape / wordmark highlight |
| `--lybs-blue-deep` | `#1A2CBD` | Cape shadow |
| `--lybs-navy` | `#090D32` | Used as the app's base background and the PWA icon fill |
| `--lybs-silver` / `--lybs-steel` | `#B4BBBF` / `#7E8284` | Knight's armor |

Fonts: **Anton** for headlines (team name, card titles), **Oswald** for nav/labels/buttons (condensed, uppercase, athletic), **Inter** for body copy -- loaded from Google Fonts in `css/styles.css`'s `@import`.

Logo assets live in `assets/images/`, generated from the source files in `/Volumes/AutoNuvo_1/LYBS Assets/PNG/` (both are outside this repo -- that folder is the source-of-truth art, this repo only has the resized/optimized exports):
- `lybs-primary.png` -- full crest, login hero
- `lybs-icon.png` -- shield/helmet mark, identity screen + PWA icon source
- `lybs-wordmark.png` -- horizontal lockup, top nav bar
- `icon-192.png` / `icon-512.png` / `favicon-*.png` -- the icon mark composited onto a solid navy square (a transparent PNG looks broken as a home-screen icon)

If the league's brand ever changes (new crest, different team joins with its own mark), regenerate these with Pillow rather than hand-exporting -- same crop/resize/composite steps work for any source logo.

## Local development

Nothing to install. `window.FIREBASE_DB_URL` defaults to `'MOCK'` in `js/backend.js`, which routes every read/write through a localStorage-backed mock database instead of a real one -- the whole app is clickable today with no Firebase project.

Dev login codes (see `js/team-registry.js` -- **placeholders, not for production**):
- Player/family code: `LunenburgSelect2026`
- Coach code: `SelectCoachFrontSeat`

Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8080
```

## Go live

Status as of 2026-10-03 -- project `lybs-ballclub` exists under natesteele888@gmail.com (same account as `lybs-dashboard`), the Web app is registered, and its API key is already wired into `index.html`.

1. ~~Create a Firebase project and register a Web app~~ -- **done** (`console.firebase.google.com/project/lybs-ballclub`).
2. **Create the Realtime Database instance** -- the one step that genuinely needs a console click (the CLI's non-interactive mode can't answer the "choose a location" prompt, and doing this by extracting a token and hand-rolling the API call isn't a safe shortcut to take, so this is a manual step): go to the project's **Build -> Realtime Database -> Create Database**, pick a US location (e.g. `us-central1`), start in **locked mode** (our rules file governs access either way). Note whatever URL it gives you -- it's usually `https://lybs-ballclub-default-rtdb.firebaseio.com`, but confirm it matches.
3. Uncomment and set `window.FIREBASE_DB_URL` in `index.html` (right above `js/backend.js`) to that URL.
4. **Deploy the security rules** already written in `database.rules.json` (gate-account-per-`{teamId,role}` model, matching `js/cloud-auth.js`):
   ```bash
   npx firebase-tools@15.32.1 deploy --only database --project lybs-ballclub --account natesteele888@gmail.com
   ```
5. **Enable the Email/Password sign-in provider** -- Console -> Build -> Authentication -> Sign-in method -> Email/Password -> Enable. This is what `cloud-auth.js`'s gate accounts (`signUp`/`signInWithPassword` against Identity Toolkit) actually run on; without it every login attempt fails.
6. **Generate real access codes** (don't ship the dev placeholders in `js/team-registry.js` to real players/parents). For each team:
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('YOUR_REAL_CODE').digest('hex'))"
   ```
   Add the resulting hash to `js/team-registry.js`'s `codeHashes` map, mapped to `{teamId, role}`. Give out the plaintext code to players/parents (player role) or coaches (coach role) -- never commit the plaintext code anywhere.
7. **Add a second team** (Majors B, Minors, ...): pick two new codes, hash them (step 6), add their entries to `codeHashes` and a bootstrap `teams.{teamId}` entry in `js/team-registry.js`. Nothing else changes -- every module reads the active team through `window.TeamConfig`.
8. **Standings job**: add `FIREBASE_DB_URL` and `FIREBASE_DB_SECRET` (Firebase console -> Project settings -> Service accounts -> Database secrets) as GitHub repo secrets, then enable the `standings.yml` workflow (or trigger it manually once to seed the first mirror).
8b. **Pull a team's real roster from the league dashboard** once a season's draft is final there: `node scripts/sync-roster-from-dashboard.mjs 2026 Majors "Majors (A)" select` (requires `lybs-reporting` checked out as a sibling repo -- see that script's header for why this is a local file read, never a network fetch). Review `data/dashboard-roster-import.json`, then re-run with `FIREBASE_DB_URL`/`FIREBASE_DB_SECRET` set to push it live -- this **replaces** that team's roster, so check the staged file first.
9. ~~Deploy to GitHub Pages~~ -- **done**, live at `natesteele888.github.io/lybs-ballclub`.
10. **GameChanger widget**: once Select's GameChanger team page exists, a coach goes to `web.gc.com -> Tools -> Create Scoreboard Widget`, copies the snippet, and pastes it into the GameChanger tab (visible once signed in as a coach).

## Privacy

Carries forward the same discipline as the `lybs-reporting` dashboard: roster entries are name/number/position only -- no DOB, contact info, or address, ever. The MAC League mirror stores only aggregate standings/results, never the coach names or phone numbers that `macleague.org` team pages happen to expose publicly.

## Not built yet

- **Player development visuals** (situational defensive positioning diagrams) -- a content-authoring project, not an integration; no external database exists to pull this from.
- **Cross-platform communication sync** (Facebook/website/GameChanger) -- `lybs-reporting` already has a manual-approval photo/caption pipeline for the league's Facebook page; a single team would want a lighter version of that, not a new system.
