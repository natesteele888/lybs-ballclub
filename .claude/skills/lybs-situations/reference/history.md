# What was already tried

Short notes so the same ground isn't recovered.

**Dark abstract field → rejected.** The first version drew the field in very dark
greens on near-black with neon routes. The reaction: "it looks futuristic versus
something that's easier to understand." Daylight colours fixed it.

**Tan foul territory → rejected.** An attempt at making foul ground unmistakable by
colouring it tan. Wrong — foul territory is grass. What makes it readable is the
white chalk line plus the dirt stopping exactly on it.

**Thin dirt base paths on a grass infield → wrong.** The skinned infield is a large
arc from foul line to foul line with the grass diamond inside it, not green with
strips drawn on.

**Mow stripes removed, then restored.** Taken out to match a flat reference image,
then put back because the user liked them. They stay.

**Radiating wedges from home** is the right mow pattern — 10 wedges across the fan,
every other one filled, carried through foul territory.

**Flat per-situation table → never do this.** 11,880 rows. The wildcard rules table
is 707 and a coach can read it.

**Timing constants were tuned twice.** First pass was far too generous to the
defence: cutoff men were charged a catch-and-release delay they don't pay, gap balls
were retrieved instantly, and runners were too fast. Current values are in
`timing-and-animation.md`; don't revert them without re-checking a sac fly and a ball
off the wall.

## Open ideas, not built

- Practice-plan generator: pull a set of situations into a numbered drill sheet to
  print for Saturday.
- Per-player assignment sheet — give each kid their own card for the situations they
  play.
- Softball variants (see SKILL.md).
- Infield-in is currently a single toggle affecting only `INF_IN` rows with a runner
  on third; depth variants (double-play depth, corners in) would be more `context`
  values.
