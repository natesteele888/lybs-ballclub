/* ============================================================
   Team registry -- the one place that lists every team this app
   knows about, and the one place the login screen's code->team
   lookup lives.

   Like ASL Bengals' CODE_HASH/COACH_CODE_HASH, these are SHA-256
   hashes, not the plaintext codes -- safe to ship in the open
   repo, since a hash can't be reversed back into the code. The
   difference from that app: there, exactly 2 hashes exist and
   both map to a hardcoded kind ('player'/'coach') with no team
   concept. Here, each hash maps to a {teamId, role} pair, so one
   shared login screen serves every team -- typing a code both
   authenticates AND selects which team you land in.

   *** select's TWO hashes below are still DEV-ONLY PLACEHOLDER CODES ***
   sha256("LunenburgSelect2026") and sha256("LYBS#2027!") -- made up for
   local development, left untouched here deliberately: Select is an
   already-piloted team, and rotating its real login codes is not a
   decision this registry-expansion pass gets to make unprompted. Follow
   README.md's "Go live" step 6 for Select specifically, whenever that's
   actually wanted.

   The 7 teams below Select (Majors Black/Blue, Minors Black/Blue,
   Rookies Black/Blue/White -- Phase 7 of the season-lifecycle plan,
   the real 2026 baseball roster from lybs-reporting) DO have real,
   freshly-generated codes, not placeholders: each hash is
   sha256(a random per-team/role code), generated the same way README.md
   step 6 documents. The plaintext codes were handed to the board
   directly outside this repo, never committed -- same rule as every
   other code here, old or new. Softball and T-Ball aren't in this
   registry yet: data/pitch-smart-rules.json and data/rules-seed.json
   only have baseball-shaped division data today (see Phase 7 in the
   season-lifecycle plan for why that's the gating factor, not a
   forgotten step).

   To add another team: pick (or generate) two new codes, hash them the
   same way, add two entries to codeHashes below with a new teamId, and
   add that teamId's display defaults to `teams`. Nothing else in the
   app needs to change -- every other module reads the team through
   window.TeamConfig (see team-config.js), never by name.
   ============================================================ */
window.TEAM_REGISTRY = {
  codeHashes: {
    '8d62dce0f74603956a6a6103d85888008680e9e579182404a8fa21b29dd8496f': { teamId: 'select', role: 'player' },
    '82dcd01057b33fcc3749042f7e21212ba01ed8c41b04cad4ecd362a87ba14280': { teamId: 'select', role: 'coach' },
    // Majors Black -- real codes, plaintexts given to the board directly, never committed (see header comment).
    '83288b1b56756e23bfc5683f5d30b174aec3403ddb7f052e002376d54865c898': { teamId: 'majors-black', role: 'player' },
    '83c958fd52e1c70f52029255bd09a2c7154ec136c2d60e8d306bd936e659e1e9': { teamId: 'majors-black', role: 'coach' },
    // Majors Blue
    'cda17ee5cc55c64fab2121db54be93c3ecad548134bb73d1f4901bb935475948': { teamId: 'majors-blue', role: 'player' },
    'f43e57bfe3a5f6f918fd9863876f89dba9c221a65b09bac70a6881b839899469': { teamId: 'majors-blue', role: 'coach' },
    // Minors Black
    '01e39a8c2cc6a2080fe7c2e2a4b94556a54765bbb76db49f88c4136477629201': { teamId: 'minors-black', role: 'player' },
    '811bd66216eea73c421709add7c813c825d396f7f4307cb939018327acda211c': { teamId: 'minors-black', role: 'coach' },
    // Minors Blue
    'b9047c54e6890a6be780e7fd5cc75403a333e81492dbb361397c9ec0c8ccde7f': { teamId: 'minors-blue', role: 'player' },
    '46d11b56490d9ebf3b272cc4726d84ee743438aa1126a8c44d050fb669b4a64b': { teamId: 'minors-blue', role: 'coach' },
    // Rookies Black
    '64a747e9493c2788d9d03a28fbd3a4b8eb8d58929778779f5150b0bacc563cae': { teamId: 'rookies-black', role: 'player' },
    '02079f9af22896f52b3b1eda72bd58e467ef5157a2c6effccb8633a54f5ae5b6': { teamId: 'rookies-black', role: 'coach' },
    // Rookies Blue
    '675c22b6612202cb560b873693cad68a3085c753bcf11aed9b76f7441301ee7c': { teamId: 'rookies-blue', role: 'player' },
    'c05911a518ca96f055a750df520b056155ec6628fa324512db04bcb3ad8b6af1': { teamId: 'rookies-blue', role: 'coach' },
    // Rookies White
    '0f3cf1bf0d521a02bbff9abdf487ff64f00e49ad57f1e2f444e2c0e2a5e3db8b': { teamId: 'rookies-white', role: 'player' },
    '521bfd8e4a2a007cb721376d958ff211711576e0ae0f4577ed7fbd8048668303': { teamId: 'rookies-white', role: 'coach' },
  },
  // Bootstrap display defaults. Once teams/{teamId}/config exists in the
  // real database, team-config.js prefers that over this -- this is only
  // what a brand-new team looks like before anyone has edited its config.
  //
  // colors below (for the 7 Phase-7 teams, not select) are a placeholder
  // scheme, not researched branding -- these teams don't have an
  // established individual logo/crest the way Select does. Derived
  // directly from the color word already in each team's own name
  // (Black/Blue/White, one consistent pair per color, reused across
  // teams since this app only ever shows one team's own colors at a
  // time -- two teams sharing "Blue" are never on screen together).
  // Swap in real colors anytime by editing this file; nothing else
  // needs to change.
  teams: {
    select: {
      name: 'Lunenburg Select (Majors A)',
      shortName: 'Select',
      sport: 'Baseball',
      colors: { primary: '#2E52E8', secondary: '#1A2CBD' }, // sampled from LYBS_Primary_Logo.png
      macLeagueDivisionId: '33696', // Majors -- https://www.macleague.org/division/33696
      macLeagueDivisionName: 'Majors', // matches a key in data/pitch-smart-rules.json and data/rules-seed.json's "division" tags
    },
    // lybs-reporting team field: "Majors Black (B)"
    'majors-black': {
      name: 'Lunenburg Majors Black',
      shortName: 'Majors Black',
      sport: 'Baseball',
      colors: { primary: '#2B2B2E', secondary: '#8A8F98' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33696', // Majors -- https://www.macleague.org/division/33696
      macLeagueDivisionName: 'Majors',
    },
    // lybs-reporting team field: "Majors Blue (B)"
    'majors-blue': {
      name: 'Lunenburg Majors Blue',
      shortName: 'Majors Blue',
      sport: 'Baseball',
      colors: { primary: '#2563EB', secondary: '#1E3A8A' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33696', // Majors -- https://www.macleague.org/division/33696
      macLeagueDivisionName: 'Majors',
    },
    // lybs-reporting team field: "Minors Black"
    'minors-black': {
      name: 'Lunenburg Minors Black',
      shortName: 'Minors Black',
      sport: 'Baseball',
      colors: { primary: '#2B2B2E', secondary: '#8A8F98' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33695', // Minors -- https://www.macleague.org/division/33695
      macLeagueDivisionName: 'Minors',
    },
    // lybs-reporting team field: "Minors Blue"
    'minors-blue': {
      name: 'Lunenburg Minors Blue',
      shortName: 'Minors Blue',
      sport: 'Baseball',
      colors: { primary: '#2563EB', secondary: '#1E3A8A' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33695', // Minors -- https://www.macleague.org/division/33695
      macLeagueDivisionName: 'Minors',
    },
    // lybs-reporting team field: "Rookies Black"
    'rookies-black': {
      name: 'Lunenburg Rookies Black',
      shortName: 'Rookies Black',
      sport: 'Baseball',
      colors: { primary: '#2B2B2E', secondary: '#8A8F98' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33694', // Rookies -- https://www.macleague.org/division/33694
      macLeagueDivisionName: 'Rookies',
    },
    // lybs-reporting team field: "Rookies Blue"
    'rookies-blue': {
      name: 'Lunenburg Rookies Blue',
      shortName: 'Rookies Blue',
      sport: 'Baseball',
      colors: { primary: '#2563EB', secondary: '#1E3A8A' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33694', // Rookies -- https://www.macleague.org/division/33694
      macLeagueDivisionName: 'Rookies',
    },
    // lybs-reporting team field: "Rookies White"
    'rookies-white': {
      name: 'Lunenburg Rookies White',
      shortName: 'Rookies White',
      sport: 'Baseball',
      colors: { primary: '#C9CED6', secondary: '#4B5563' }, // placeholder -- see teams' own header comment above
      macLeagueDivisionId: '33694', // Rookies -- https://www.macleague.org/division/33694
      macLeagueDivisionName: 'Rookies',
    },
  },
};
