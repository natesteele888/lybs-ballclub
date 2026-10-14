---
name: lybs-situations
description: Build, extend or debug the defensive situations trainer inside the LYBS app — the animated field diagram, the play timing engine, and the CSV rules that decide where all nine players go. Use for anything touching situations.csv, responsibilities.csv, the field SVG, play animation, or adapting the standalone "Where Do I Go?" prototype into LYBS.
---

# LYBS Situations Trainer

A teaching module that shows a youth player where to go on any defensive play.
Pick a ball event, a base state and an out count; the app resolves all nine
responsibilities from a rules table and animates the play in real time — ball off
the bat, runners breaking, fielders moving to their spots, throws going base to
base, and an out/safe call at the end.

A working standalone prototype ships with this skill at
`assets/baseball-situations.html` (single file, no build step, no dependencies).
**Read it before changing anything.** It is the reference implementation and every
number in these docs came out of it.

## Read these as needed

- `reference/data-model.md` — the two CSVs, the wildcard resolver, every column
- `reference/field-geometry.md` — exact coordinates, landmarks, drawing order
- `reference/timing-and-animation.md` — the play timeline and speed constants
- `reference/design-tokens.md` — the Sandlot palette and type
- `reference/validators.md` — the checks that must pass before shipping
- `reference/history.md` — approaches already tried and rejected; read before redesigning
- `assets/situations.csv`, `assets/responsibilities.csv` — 55 situations, 707 rules
- `reference/field-reference.jpeg` — the field look to match

Before shipping any change:

```
node scripts/validate.js <built-app.html>
```

It loads the app's own resolver and timeline builder and exercises all 1,320 plays.
Current state: `55 situations · 707 rules · 1320 plays checked — PASS`.

## The one idea that makes this work

Do not store a row per situation. 55 ball events × 8 base states × 3 out counts ×
9 players is **11,880 assignments** — unmaintainable by hand, and no volunteer coach
will ever edit it.

Instead store **707 rules with wildcards** and resolve at runtime by specificity:

```
ball_id, bases, outs, context, pos, role, target, cue, throw
GB_SS,   *,           *,   *, SS, FIELD, BALL, "Field it clean...",      BASE_1
GB_SS,   1|12|13|123, 0|1, *, SS, FIELD, BALL, "Force at second...",     BASE_2>BASE_1
```

A `*` is the default. A specific row overrides it. Specificity score is
`bases≠* → 4`, `outs≠* → 2`, `context≠* → 8`, ties broken by row order (later wins),
so a coach's edit appended to the file always beats the built-in rule. That property
is load-bearing — do not reorder the scoring.

## Hard invariants

These are not style preferences. Each one corresponds to a bug that shipped and had
to be fixed, and `reference/validators.md` has a script for each.

1. **No two players may be sent to the same target in the same situation.** Excluding
   `BALL` (converging on a pop-up is correct) and `HOLD`. A violation here means two
   kids run to the same patch of grass. The first build had 16 such patterns across
   243+ situations, including two players both covering first base on every bunt.
2. **Exactly one player covers each base.** First, second and third are assigned once
   each, then every remaining player gets a backup spot of his own.
3. **Every ball position and landmark must sit inside the field and on the correct
   side of the foul lines.** Foul pops foul, everything else fair.
4. **Every situation must resolve to a complete set of nine assignments** with a cue
   for each, for all 24 base/out states, with no unknown landmark names.
5. **Changing a ball type in the UI must change the play that is currently loaded**,
   not just what a future tap produces. That one shipped as a bug and read as broken
   logic to the user.

## Adapting into LYBS

LYBS is baseball **and** softball, and the situations module is a player-facing
teaching tool, not part of the coach/admin dashboard. Before writing code:

1. **Inspect the LYBS repo first.** Find how it stores data (the prototype uses
   embedded CSV with localStorage overrides; LYBS likely has its own shared cloud
   store), how it routes between views, and whether it already has a team/roster
   model the situations module should read instead of carrying its own.
2. **Keep the two CSVs as the source of truth.** Load them from wherever LYBS keeps
   shared data rather than embedding them, but keep the embedded copy as a fallback
   so the module still works offline and in a bare HTML file.
3. **Scope per team, not per app.** LYBS covers many teams across two sports. A
   coach's rule edits belong to that team's division, not to the whole league.
   Expect `league → division → team` in the key, and expect a league-wide default set
   that a team can fork.
4. **Softball needs its own situation set, not a reskin.** The field geometry is
   shared (60 ft bases at 12U), but the pitching distance is different, leadoffs are
   not allowed until release, the dropped third strike rules differ by division, and
   slap hitting changes the corners' responsibilities. Add a `sport` column to
   `situations.csv` and filter on it rather than maintaining two forks.
5. **Do not pull in the rest of the dashboard.** This is deliberately a player's app:
   field, jobs, quiz, rules, team. Schedules and standings live in LYBS already —
   link to them, don't duplicate them.

## Tuning for a division

Everything that makes the plays feel right for an age group lives in two places:

- The `TIME` object at the top of the file — runner speed, throw speed, hang time,
  gather and transfer. One edit re-times all 1,320 plays. 10U is slower on both
  sides; 14U throws much harder and the runner numbers barely move.
- The `responsibilities.csv` rows themselves — league rule differences (leadoffs,
  dropped third strike, infield fly enforcement) are rule edits, not code edits.

## What not to do

- Don't expand the rules into a flat per-situation table "for speed". Resolution is
  microseconds and the file becomes unmaintainable.
- Don't add a fourth corner radius or a second accent colour. See `design-tokens.md`.
- Don't make the field dark and abstract. It was built that way first and the user's
  reaction was that it looked futuristic and was hard to read. Daylight grass, tan
  skinned infield, white chalk, mown fan pattern.
- Don't let the cue text drift into third person. It is what a coach says to a kid at
  practice: second person, imperative, one instruction, under about fifteen words.
