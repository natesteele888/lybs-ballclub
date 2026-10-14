# Sandlot design tokens

The shared look for the youth-sports apps. Full system with live previews:
https://claude.ai/artifact/86uwd9UYjeKu2tAUmTZZ2E

## Colour

App chrome is dark — these get read in a dugout in daylight glare, and a white screen
washes out. The **field itself is daylight bright**, which is what makes it legible.

```
field-900  #0c1512 / light #eef2ec    page background
field-800  #131f1a / light #e4eae2    ground around the field graphic
panel      #132420 / light #ffffff    cards, job list, scoreboard strip
panel-raised #1a302a / light #f3f7f1  buttons and chips at rest
hairline   #28453c / light #d2ddd3    borders and rules. never a shadow
chalk      #f2f5f1 / light #10201a    primary text, foul lines, bases
chalk-muted #8fa89e / light #56695f   labels, players with no job

grass        #3f8455      fair territory
grass-mown   #4a9764      mow stripes, infield grass
clay         #b5794c      infield skin, home circle
clay-light   #a3683f      base cutouts, mound
warning-track #965f3a     ring inside the fence
fence        #2c4438      fence line and field boundary
foul-pole    #f5d76e      the two poles, nowhere else
out-of-play  #0e1a15      beyond the fence

role colours — identical in both themes, always carry field-900 ink
ball-amber #ffc53d (11.6:1)   cut-cyan #4fd1e0 (10.4:1)
backup-violet #b39aff (7.8:1) chase-orange #ff9a3d (8.9:1)
talk-lime #8fe388 (11.8:1)    runner-rose #ff7b72 (8.1:1) — offence + out bulbs
```

## Type

`Barlow Condensed` for signage — team names, headings, jersey numbers, scoreboard
labels, role names. `Barlow` for anything read in sentences.

```
cover-name 100/90 700   team-name 20/22 700   section 19/24 700
card-title 17/22 700    job-role 26/28 700
body 16/24 400   cue 14/20 400   meta 12/16 400
board-label 11/14 600 (0.14em tracking)   jersey 15/15 700   position-tag 10/12 500
```

Scoreboard styles are the **only** place letters are tracked out or set in capitals,
because a real scoreboard does it. Headings and navigation are sentence case.

## Shape

`space-1..6` = 4 / 8 / 12 / 16 / 24 px. Radii: `sm` 6 (chips, inputs), `md` 10
(cards, the field frame), `round` 999 (jersey chips, out bulbs). **Do not add a
fourth radius** — a mixed radius scale is the fastest way to make a hand-built app
look templated.

## Patterns worth keeping

- The field is the hero: full width at the top of the screen, controls underneath.
  No title bar above it on a phone.
- The nine jobs are **one lineup card** with hairline rules between rows, not nine
  stacked panels. Jersey chip in the role colour, position tag under it, role name in
  the role colour, cue in chalk.
- Scoreboard strip is the control and the display at once — tappable base diamond and
  three out bulbs. No separate readout next to it.
- Borders, not shadows. There is no elevation scale.
