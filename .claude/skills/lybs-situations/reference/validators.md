# Validators

```
node scripts/validate.js assets/baseball-situations.html
```

Run it after any change to the CSVs, the geometry or the coverage logic. On the
shipped prototype it reports:

```
55 situations · 707 rules · 1320 plays checked
PASS — all five invariants hold
```

The script loads the app's own JS (everything above the playback section), stubs
`localStorage` and `performance`, and exercises the real resolver and timeline
builder — so it tests the shipping code, not a copy of the rules.

## What it checks

**collision** — two players sent to the same target in the same situation, excluding
`BALL` and `HOLD`. This is the one that matters most. The first build had 16 patterns
across 243+ situations; the user spotted it as "the pitcher and right fielder backing
up in the same spot."

**coverage** — more than one player with role `COVER` on the same base. Caught both
corners covering first on every bunt, and the pitcher plus the first baseman both
covering first on a grounder to second.

**geometry** — every ball position, landmark and fielder start classified as fair,
foul, backstop or off-field. Foul pops must be foul and everything else fair; the
five infielders must start on dirt and the three outfielders on grass. Eleven ball
positions had to move when the field geometry changed.

**completeness** — all 9 positions resolve for all 24 base/out states (plus the
infield-in variant), every assignment has a cue, and every landmark and throw target
is a real name.

**timeline** — every play builds, with a finite duration under 16 seconds and no bad
runner legs.

## Porting it to LYBS

The geometry constants at the top (`HOME`, `ARC`, `R`, `BACK`, `BR`, the 196 skin
radius) must match whatever the LYBS field renderer uses. If you change the viewBox,
change them here in the same commit or the validator silently passes garbage.

If LYBS loads the CSVs from a shared store rather than embedding them, point the
script at a built bundle or refactor it to import the resolver directly. Keep it
runnable from the command line — it's the only thing standing between a CSV edit and
nine kids running to the same patch of grass.

## Manual checks worth doing before shipping a change

- Run a 6-4-3 and watch the scoring notation appear.
- Run a fly ball to centre with a runner on third and watch the ball's shadow
  separate on the way up.
- Pick a ball type chip and confirm the **currently loaded** play changes.
- Scrub to 2.0s and confirm every player is somewhere sensible mid-flight.
