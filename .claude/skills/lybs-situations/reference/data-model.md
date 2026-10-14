# Data model

Two CSVs drive everything. They are **hand-editable source**, not generated output —
a coach can open them in a spreadsheet. The original build used a Python generator to
produce them; that scaffolding is gone and is not needed. Edit the CSVs directly.

## situations.csv — what happened

One row per ball event. 55 rows.

| column | meaning |
| --- | --- |
| `ball_id` | stable key, e.g. `GB_SS`, `SINGLE_LF`, `D3K_THROW` |
| `label` | what the user sees: "Ground ball to short" |
| `group` | picker heading: Ground balls, Bunts, Pop ups, Fly balls (caught), Base hits, Extra base hits, Cutoffs & relays, Rundowns, First and third, Pickoffs, Dropped third strike, Battery plays |
| `ball_type` | `ground` `bunt` `pop` `fly` `hit` `gap` `loose` `steal` `pick` `run` — drives ball speed, hang time and which tap-filter finds it |
| `ball_x`, `ball_y` | where the ball ends up, in field viewBox coords |
| `teaching_point` | optional coach's note shown under the play |
| `tap` | `no` keeps it out of tap-the-field selection (decision plays, steals, pickoffs — they sit near the plate and would hijack taps) |
| `ball_from` | landmark the ball starts at. Default `PLATE`; pickoffs use `MOUND`, rundowns use a base |
| `set_bases` | base state this play assumes (`13` for first-and-third). Selecting the play sets the diamond |
| `set_outs` | out count this play assumes (bases-loaded dropped third strike is `2`) |
| `runners` | how the bases advance — see below |

### `runners` codes

| code | behaviour |
| --- | --- |
| `force` | batter to first; forced runners advance one |
| `contact` | batter to first; **all** runners advance one (squeeze, backstop D3K) |
| `single` | batter to first; runner on 1st takes two bases; runner on 2nd scores |
| `double` | batter takes two; everyone else takes two or scores |
| `tag` | batter is out; runners on 2nd and 3rd tag after the catch, with a running start |
| `wp` | all runners advance one after a short delay |
| `steal2` / `steal3` | that one runner advances |
| `pickoff` | runner leads off and dives back |
| `rundown` | runner shuttles in the lane and retreats |
| `none` | nobody moves (caught pop-ups, foul pops) |

Runners who hold still are drawn standing on their bag — they are included in the
plan with zero movement so they don't vanish.

## responsibilities.csv — who does what

707 rules. Columns: `ball_id, bases, outs, context, pos, role, target, cue, throw`.

- `bases` — `*`, or a pipe list of states: `_ 1 2 3 12 13 23 123`
- `outs` — `*`, or a pipe list of `0 1 2`
- `context` — `*` or `INF_IN` (only applies when the infield-in toggle is on)
- `pos` — `P C 1B 2B 3B SS LF CF RF`
- `role` — `FIELD CHASE COVER CUT RELAY TRAIL BACKUP PLATE DIRECT HOLD`
- `target` — a landmark name, or `BALL`, or `POS_<pos>` to stay put
- `cue` — what the coach says. Second person, imperative, under ~15 words
- `throw` — only on the ball carrier. `>`-separated landmark chain: `BASE_2>BASE_1`

### Resolution

For each position, take every matching row and keep the highest specificity:

```
score = (bases !== '*' ? 4 : 0) + (outs !== '*' ? 2 : 0) + (context !== '*' ? 8 : 0)
        + rowIndex / 100000        // later rows win ties
```

`INF_IN` rows are skipped entirely unless the toggle is on. Any position with no
matching row falls back to `HOLD` at its own start position.

**Coach edits are appended** to the end of the table, so they outrank built-in rules
at equal specificity. Keep that behaviour.

## Roles and what they mean

| role | colour | label |
| --- | --- | --- |
| `FIELD` | amber | Field the ball |
| `CHASE` | orange | Run the runner back |
| `COVER` | chalk | Cover a base |
| `CUT` / `RELAY` / `TRAIL` | cyan | Cutoff man / Relay man / Trail the relay |
| `BACKUP` | violet | Back up a throw |
| `PLATE` | chalk | Protect the plate |
| `DIRECT` | lime | Talk / direct traffic |
| `HOLD` | muted | Hold your spot |

The colours are the teaching system — a kid learns the colour before the word. They
are identical in light and dark because they are field markings, not UI chrome.

## Coverage logic that must be preserved

On an infield grounder, assign each base exactly once, then give every leftover
player his own backup spot:

```
first_cover  = (fielder === '1B') ? 'P' : '1B'
second_cover = fielder in ('1B','2B','C') ? 'SS' : '2B'   // swap if that's the fielder
third_cover  = (fielder === '3B') ? 'SS' : '3B'           // if SS takes third, 2B takes second
leftovers:  P → BU_1_IN   C → BU_1_LINE   SS → BU_2_L   2B → BU_1_IN or BU_2_R
outfield:   RF → BU_1     CF → BU_2       LF → BU_3
```

On a bunt, the first baseman **charges** and the second baseman covers first. Both
covering first was a real shipped bug.
