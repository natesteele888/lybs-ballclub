# Age Eligibility

A standalone, embeddable "which division is my child eligible for" calculator and chart. Lives at `age-eligibility.html`, deployed at `https://natesteele888.github.io/lybs-ballclub/age-eligibility.html`, and embedded live on [lunenburgybs.com's Find My Division page](https://www.lunenburgybs.com/parent-resources/find-my-division/140842), replacing that page's old third-party "Convert_" widget.

Not part of the main app shell -- not in `sw.js`'s `SHELL_FILES`, not reachable from `index.html`'s own nav. It's a sibling page, built to stand entirely on its own (no sign-in, no app chrome, fixed light theme since it sits inside an arbitrary external page that's almost certainly light).

## What it does

- A birth-date field that instantly shows every division (baseball and softball, current data only goes up to the brackets LYBS actually fields) that birth date falls into, for whichever year is selected.
- A horizontally-scrollable age chart -- one bar per division, grouped by sport, with a year-over-year axis. Entering a birth date draws a dashed "you are here" marker across the chart at that date, through whichever bar(s) it lands in, and auto-scrolls the chart to bring the marker into view.
- A 2026/2027 toggle. Defaults to **the newest year the data has** (not whatever the calendar says) -- see "Yearly upkeep" below for why.
- A cutoff-dates table (the same data as the chart, in plain text/numbers) and the registration-process disclaimer lunenburgybs.com's old widget carried, so nothing parents relied on got lost in the swap.

## Data source

Reads `data/league-info.json`'s `leagueAges` object -- the exact same data the in-app League Ages tab (`js/league-info.js`) reads, so the two can never drift apart. That file is itself mirrored from [MAC League's own League Ages page](https://www.macleague.org/about/league-ages/151011), which in turn republishes [Babe Ruth League's official age charts](https://www.baberuthleague.org/league-resources/softball-age-chart) so every MAC League town uses the same dates.

**Divisions deliberately left out of this chart**, even though MAC League's page lists them: Baseball 15/16U Juniors and Baseball 18U Seniors -- regional brackets other MAC League towns use that LYBS doesn't field baseball teams for (12U Majors is the highest level of baseball LYBS offers). Showing a bracket LYBS doesn't run would mislead a family into thinking a team exists for it.

**Naming note:** MAC League's own page calls softball's oldest local bracket "16U Juniors." LYBS calls that same bracket (same age range, same real team) **16U Seniors** -- that's the name used throughout this chart, not MAC League's.

**Governance note:** baseball plays through MAC League locally. Softball currently runs through Babe Ruth League *directly*, not MAC League -- though that could change. Worth knowing if registration flows or contacts ever need to differ by sport.

See `data/league-info.json`'s own `leagueAges.note` field for the always-current version of both of these -- that's the single source of truth, this file is just the narrative version.

## Yearly upkeep

The year-toggle defaults to `years[years.length - 1]` (the newest year key present in `leagueAges`), not the current calendar year. By the back half of a calendar year, that year's own season is already wrapping up and next year's registration is typically already open (see `data/league-info.json`'s `seasons` array), so a visitor checking eligibility late in the year is almost always asking about the *upcoming* season, not the one about to end.

This only stays correct if next year's `leagueAges` entry gets added **ahead of time**, the same way the rest of this data (season dates, fees, etc.) already gets updated each year. When adding a new year:
1. Re-fetch https://www.macleague.org/about/league-ages/151011 and cross-check every division's range against it (and, if anything looks off, the Babe Ruth League chart it's sourced from).
2. Add the new year's entries to both `leagueAges["20XX"]` arrays in `data/league-info.json`, keeping the same set of divisions already in use here (not MAC League's full list -- see "Divisions deliberately left out" above) and the same "16U Seniors" naming for softball.
3. No code changes needed -- the chart, calculator, and year toggle are all purely data-driven off whatever year keys exist.

## Embedding elsewhere

```html
<iframe
  id="lybs-age-eligibility"
  title="LYBS Age Eligibility"
  loading="lazy"
  scrolling="no"
  style="width:100%;max-width:760px;border:0;display:block;overflow:hidden;"
  height="600"></iframe>
<script>
  document.getElementById('lybs-age-eligibility').src =
    'https://natesteele888.github.io/lybs-ballclub/age-eligibility.html?v=' + Date.now();
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://natesteele888.github.io') return;
    if (e.data && typeof e.data.lybsAgeEligibilityHeight === 'number') {
      var f = document.getElementById('lybs-age-eligibility');
      if (f) f.style.height = e.data.lybsAgeEligibilityHeight + 'px';
    }
  });
</script>
```

A few things baked into this snippet, worth knowing before changing it:

- **No static `src` attribute.** GitHub Pages serves this file with `Cache-Control: max-age=600` (confirmed via `curl -sI`), so a static `src` can serve a stale copy to returning visitors for up to 10 minutes after a real deploy. The script sets `src` with a `Date.now()` cache-buster on every load instead -- same trick `age-eligibility.html` already uses internally for its own `data/league-info.json` fetch.
- **`scrolling="no"` + `overflow:hidden`.** The page posts its own content height to the parent via `postMessage({lybsAgeEligibilityHeight: h}, '*')` on load, on resize, and once `document.fonts.ready` resolves (Google Fonts loading async can reflow text just enough to invalidate the last height report) -- but these two attributes are a hard backstop against an iframe scrollbar ever flashing, independent of whether that timing is perfect.
- **The origin check** (`e.origin !== 'https://natesteele888.github.io'`) in the message listener should stay -- don't blindly trust postMessage from anywhere.
- No title or intro paragraph renders inside the embed (it did originally, but got removed -- see `age-eligibility.html`'s own header comment) since the host page already has its own heading and intro copy; showing both read as redundant. The in-app League Ages tab (`js/league-info.js`) is a separate render path and still shows its own title/note in full, since there's no outer page duplicating it there.

## If this needs real changes later

The chart/calculator logic (`ageChartSvg()`, `eligibleDivisions()`, the marker/scroll behavior) lives entirely inside `age-eligibility.html`'s own `<script>` tag -- it's a deliberate near-verbatim port of `js/league-info.js`'s own chart code, not a shared module, because this page has to stand alone with no app shell to import from. If the in-app version's chart logic changes, this file's copy won't pick that up automatically and would need the same change ported over by hand.
