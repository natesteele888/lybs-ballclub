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

   *** DEV-ONLY PLACEHOLDER CODES ***
   The two hashes below are sha256("LunenburgSelect2026") and
   sha256("SelectCoachFrontSeat") -- made up for local development
   only. Before this goes live, generate real codes and swap these
   out (see README.md "Go live" section for the one-line command),
   and do the same any time a code needs to be rotated.

   To add a second team (Majors B, Minors, ...): pick two new
   codes, hash them the same way, add two entries to codeHashes
   below with a new teamId, and add that teamId's display defaults
   to `teams`. Nothing else in the app needs to change -- every
   other module reads the team through window.TeamConfig (see
   team-config.js), never by name.
   ============================================================ */
window.TEAM_REGISTRY = {
  codeHashes: {
    '8d62dce0f74603956a6a6103d85888008680e9e579182404a8fa21b29dd8496f': { teamId: 'select', role: 'player' },
    'b2d705eaf8872023731ed13eb5fec4623f7f9fe89e30e34e58e1ce1d618b171b': { teamId: 'select', role: 'coach' },
  },
  // Bootstrap display defaults. Once teams/{teamId}/config exists in the
  // real database, team-config.js prefers that over this -- this is only
  // what a brand-new team looks like before anyone has edited its config.
  teams: {
    select: {
      name: 'Lunenburg Select (Majors A)',
      shortName: 'Select',
      sport: 'Baseball',
      colors: { primary: '#0a2f5c', secondary: '#c8102e' },
      macLeagueDivisionId: '33696', // Majors -- https://www.macleague.org/division/33696
    },
  },
};
