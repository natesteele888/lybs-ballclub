# Timing and animation

The play is a **timeline**, not a tween to endpoints. Ball off the bat, runners
breaking on contact, fielders moving at their own speed, throws base to base, and an
out/safe call when the ball and the runner both arrive.

## Constants

```js
const TIME={
  runner:26,        // px/sec — 106px = 60ft, so 4.1s home to first
  rounding:1.15,    // a runner taking two+ bases doesn't stop at the bag
  fielder:34, throw:118, react:.25, transfer:.42,
  ball:{ground:130,bunt:74,hit:150,gap:150,loose:95,run:120,steal:400,pick:400},
  hang:{fly:3.2,pop:2.5},
  gather:{ground:.55,bunt:.75,hit:.7,gap:2.6,fly:.55,pop:.4,loose:.85,steal:.9,pick:.1,run:.2}
};
```

This object is the division tuning knob. One edit re-times all 1,320 plays. For 10U
drop `runner` to ~22 and `throw` to ~95; for 14U raise `throw` to ~150 and leave the
runner close to where it is.

Notes on the non-obvious ones:

- `hang` replaces speed for `fly` and `pop` — a fly ball's time is hang time, not
  distance over velocity.
- `gather.gap` is 2.6s because chasing a ball to the fence takes real time. It was
  0.7 at first and runners from second were being thrown out at the plate on balls
  off the wall, which is wrong.
- `gather.steal` is 0.9s — that's the catcher's pop time, not a fielding delay.
- `transfer` is charged between throw legs **except after a `CUT_` landmark**, because
  a cutoff man lets the ball through. A `RELAY_` man does catch and re-throw, so he
  pays it.

## Building a play

```
leg 0        origin (ball_from) → ball position, duration by type/hang, arc by type
             (38 for fly/pop, 14 for hit/gap, 0 for grounders)
gather       charged once to the ball carrier
each throw   dist / TIME.throw, min 0.22s, + transfer unless the previous
             landmark was a CUT_
fielders     start at t=0, dist / TIME.fielder, ease-in-out
runners      per the `runners` code; polyline through bases, constant speed,
             × rounding when taking two or more
duration     max(ball end, all runner ends) + 0.8s so the call can land
```

The ball carrier is `POSLIST.find(p => assign[p].throw)` — **any role**, not just
`FIELD`. Rundown chasers throw too.

## Scoring notation

The throw chain produces `6-4-3` automatically: the carrier's number, then the
receiver at each landmark (the player targeting it with role `COVER`, `PLATE`, `CUT`,
`RELAY` or `CHASE`). Shown next to the out/safe chips.

## Out / safe

For each throw leg whose target is a base, find the runner headed there and compare
arrival times. Ball first → out. Suppressed entirely for `rundown`, where the runner
is returning to the base he came from and there is no call to make.

These are honest consequences of the model, not scripted outcomes. Bases loaded with
a grounder to short comes up **safe at first** — the 6-2-3 relay arrives at 4.48s
against a batter at 4.30s. Don't "fix" results like that by special-casing; fix the
constants if a division's numbers are off.

## Transport

Play/Pause, a **scrubber**, a clock, and a Slow button at 35% speed. The scrubber is
the one coaches use — freeze at 2.0s and ask the right fielder why he hasn't moved.
Scrubbing pauses playback and seeks; changing any situation input stops playback and
resets to t=0.

Shadows are updated inside the same frame loop as their owners. The ball's ground
shadow uses the un-arced y, with radius and opacity driven by lift.
