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
| `triple` | batter takes three; every existing runner scores, regardless of base |
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

On a gap ball or a ball hit over/off the fence (`Extra base hits` and `Cutoffs &
relays` groups — every `GAP_*`, `LINE_*`, `OVER_*`, `CORNER_*`, `WALL_*`, `TRIPLE_*`
row), the two middle infielders split, exactly one each, regardless of which side the
ball was hit to or what the bases/outs are:

```
relay  = ball hit left of center ? SS : 2B     // goes out, takes the OF's throw
cover2 = the OTHER one                         // stays, covers second -- always,
                                                // every base state, no exceptions
1B     = TRAIL at the matching TRAIL_* point    // the corner infielder is the one
                                                 // free to back up the relay, not
                                                 // a middle infielder going a second
                                                 // time and not 1B covering second
far_OF = the opposite-side outfielder backs up third (BU_3_IN default, BU_3 once
         a runner's actually on) -- never "back up second", nothing is being
         thrown there
3B     = always covers third; C stays home; P backs up third, then the plate once
         a runner's on
```

**Never send 1B (or a corner outfielder) to cover second.** That was a real bug:
with both middle infielders committed to the relay (one relaying, one "trailing"
15 feet behind him), second base was left open, and the patch for it sent the
first baseman — on the *opposite* side of the infield from where the relay even
is — sprinting over to cover second, abandoning first entirely. No one teaches
that. The fix is above: only one middle infielder ever leaves the bag; the other
stays and covers second himself.
