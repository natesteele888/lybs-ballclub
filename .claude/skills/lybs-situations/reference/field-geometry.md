# Field geometry

All coordinates are in a `0 0 520 482` SVG viewBox. Scale: **106 px = 60 ft**, so
1 ft ≈ 1.77 px. Keep this viewBox — every landmark and ball position depends on it.

`reference/field-reference.jpeg` is the look to match: tan skinned infield as a large
arc, green foul territory, white chalk, flat clean shapes.

## Anchors

```
HOME   (260, 415)      MOUND  (260, 334)      // 46 ft from home
1B     (335, 340)      2B     (260, 265)      3B  (185, 340)
```

## Field shape

The field is a **fan** with edges 58° off centre, while the foul lines run at 45°.
That gap is what gives foul territory real width — if the edges and the lines are
both at 45° there is nowhere for a foul pop to land.

```
fan (green)   M260,415 L31,272 A232.6,232.6 0 0 1 489,272 Z
track (tan)   M260,438 L12.4,260.3 A252.7,252.7 0 0 1 507.6,260.3 Z
backstop      green circle (260,428) r80, inside a tan circle r94
foul lines    home → (52.5, 207.5) and (467.5, 207.5)
foul poles    short yellow verticals at those two endpoints
infield skin  M260,415 L121.4,276.4 A196,196 0 0 1 398.6,276.4 Z
```

The infield skin is a **45° sector of radius 196 from home** — foul line to foul
line, about 1.3× the distance to second base. The grass diamond sits inside it and
the base paths are the tan gap between. Drawing thin dirt strips on a grass infield
is backwards and looks wrong.

## Drawing order

1. `out-of-play` fill across the frame
2. tan backstop circle, tan outer fan, dark stroke on both (the fence line)
3. green backstop disc, green fan
4. mow stripes + lighting gradient, clipped to the fan
5. green stroke on the fan edge (the grass lip)
6. infield skin + its gradient + lip stroke
7. home plate circle, backstop arc
8. grass diamond + gradient + lip, base cutouts, mound + rubber
9. foul lines, foul poles
10. coach's boxes, batter's boxes, catcher's box
11. bases, home plate
12. routes (dashed, role colour), then shadows + players + runners + ball

## Mow pattern and depth

Fan mow: 10 wedges across the 116° fan, every other one filled with `grass-mown` at
0.62 opacity, radius 360, clipped to the fan. It carries through foul territory,
which is how it's actually mown.

Three radial gradients give it the game feel — grass lighting (bright at the infield,
dark at the fence), dirt grading, and a mound highlight from the upper left. Players,
runners and the ball all cast ellipse shadows. The ball's shadow **separates from the
ball** on anything airborne: it spreads and fades as the ball rises, tightens as it
falls. That one detail is what makes a fly ball readable.

## Fielder start positions

```
P  (260,336)   C  (260,452)   1B (348,316)   2B (312,258)   3B (172,316)
SS (208,258)   LF (108,214)   CF (260,162)   RF (412,214)
```

All five infielders land on the dirt; all three outfielders on grass. Verify after
any geometry change.

## Landmarks

```
bases      BASE_1 BASE_2 BASE_3 PLATE MOUND          BALL = the ball's position
backups    BU_1 (392,308)      BU_2 (260,210)     BU_3 (128,308)
           BU_1_IN (369,334)   BU_1_LINE (318,362)   BU_3_IN (151,334)
           BU_2_L (234,232)    BU_2_R (286,232)      BU_PLATE (300,466)
cutoffs    CUT_PLATE_L (224,372)  CUT_PLATE_R (296,372)
           CUT_3 (214,296)  CUT_3_L (198,300)  CUT_3_R (230,294)
           CUT_2 (260,300)  CUT_2_L (224,290)  CUT_2_R (296,290)
relays     RELAY_LF (150,270)  RELAY_LC (198,234)  RELAY_CF (252,224)
           RELAY_RC (322,234)  RELAY_RF (370,270)
           RELAY_CORNER_L (152,290)  RELAY_CORNER_R (368,290)
           RELAY_DEEP_L (176,190)    RELAY_DEEP_R (344,190)
trails     TRAIL_LC (234,270)  TRAIL_RC (288,270)  TRAIL_LF (188,300)
           TRAIL_RF (332,300)  TRAIL_DEEP_L (218,238)  TRAIL_DEEP_R (302,238)
rundowns   CHASE_TO_1 (318,320)  CHASE_TO_2 (238,288)  CHASE_TO_3 (208,362)
```

**Backups are split by depth so two players never stack.** The right fielder takes
the deep ball behind first (`BU_1`), the pitcher takes the short one inside him
(`BU_1_IN`), the catcher trails down the line (`BU_1_LINE`). Same at second
(left/right) and third (deep/inside).

Rundown chasers target a point **in the lane**, not the bag, so you can see the
runner trapped between two fielders.

## Adding a landmark or moving a ball

Run the geometry validator (`reference/validators.md`). It classifies any point as
fair, foul, backstop or off-field. Eleven ball positions had to move when the field
became a fan — foul pops were sitting nearly perpendicular to home and two
over-the-head balls were beyond the fence.
