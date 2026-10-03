# LYBS Ballclub

A team app for LYBS baseball/softball teams, modeled on the [ASL Bengals](https://natesteele888.github.io/ASL-Bengals/dev2/) app's pattern (static PWA, Firebase Realtime Database, shared-code login) but built multi-tenant from the start so one deployment can serve every team -- starting with **Select (Lunenburg A / Majors-A)**.

No build step: open `index.html` (or run a static server) and it runs. Runs entirely on **mock data in your browser's localStorage** until you wire up a real Firebase project -- see "Go live" below.

## What's here

- **Schedule / Practices / Roster** -- CRUD tabs, coach-editable, read-only for everyone else.
- **GameChanger widget** -- paste the Scoreboard Widget snippet from `web.gc.com -> Tools -> Create Scoreboard Widget`; it renders in a sandboxed iframe. Display-only -- GameChanger has no API, so this is never a data source for the calendar or anything else.
- **MAC League standings** -- mirrored from `macleague.org` by `scripts/scrape-standings.mjs`, run on a schedule (`.github/workflows/standings.yml`), never fetched live from the browser. See that script's header comment for why.
- **Rules search & save** -- MAC League's Majors/General/Playoff rules (`data/rules-seed.json`, pulled from `macleague.org/coaching-resources/...` on 2026-10-03), searchable, with a per-device "pin for quick reference."
- **My Calendar** -- downloads an `.ics` file combining every team this device has logged into. Built from our own Schedule/Practices data, not synced from GameChanger (no feed exists to sync from).

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

1. **Create a Firebase project** (console.firebase.google.com -- free Spark plan, same as the ASL Bengals project) and enable Realtime Database.
2. Set the real URL and Web API key in `index.html`, right before `js/backend.js` loads:
   ```html
   <script>
     window.FIREBASE_DB_URL = 'https://YOUR-PROJECT-default-rtdb.firebaseio.com';
     window.FIREBASE_API_KEY = 'YOUR_WEB_API_KEY';
   </script>
   ```
3. **Generate real access codes** (don't ship the dev placeholders above). For each team:
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('YOUR_REAL_CODE').digest('hex'))"
   ```
   Add the resulting hash to `js/team-registry.js`'s `codeHashes` map, mapped to `{teamId, role}`. Give out the plaintext code to players/parents (player role) or coaches (coach role) -- never commit the plaintext code anywhere.
4. **Set Realtime Database security rules** so each team's gate account can only read/write its own `teams/{teamId}/...` subtree, `shared/*` is world-readable (standings, rules) and admin-writable, matching the gate-account-per-{teamId,role} pattern in `js/cloud-auth.js`.
5. **Add a second team** (Majors B, Minors, ...): pick two new codes, hash them (step 3), add their entries to `codeHashes` and a bootstrap `teams.{teamId}` entry in `js/team-registry.js`. Nothing else changes -- every module reads the active team through `window.TeamConfig`.
6. **Standings job**: add `FIREBASE_DB_URL` and `FIREBASE_DB_SECRET` (Firebase console -> Project settings -> Service accounts -> Database secrets) as repo secrets, then enable the `standings.yml` workflow (or trigger it manually once to seed the first mirror).
7. **Deploy**: push to GitHub, enable GitHub Pages on the repo (Settings -> Pages -> Deploy from branch -> `main` / root) -- same hosting as ASL Bengals.
8. **GameChanger widget**: once Select's GameChanger team page exists, a coach goes to `web.gc.com -> Tools -> Create Scoreboard Widget`, copies the snippet, and pastes it into the GameChanger tab (visible once signed in as a coach).

## Privacy

Carries forward the same discipline as the `lybs-reporting` dashboard: roster entries are name/number/position only -- no DOB, contact info, or address, ever. The MAC League mirror stores only aggregate standings/results, never the coach names or phone numbers that `macleague.org` team pages happen to expose publicly.

## Not built yet

- **Player development visuals** (situational defensive positioning diagrams) -- a content-authoring project, not an integration; no external database exists to pull this from.
- **Cross-platform communication sync** (Facebook/website/GameChanger) -- `lybs-reporting` already has a manual-approval photo/caption pipeline for the league's Facebook page; a single team would want a lighter version of that, not a new system.
