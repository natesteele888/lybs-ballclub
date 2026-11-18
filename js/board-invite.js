/* ============================================================
   Coach invite from the LYBS Dashboard.

   The Dashboard is where the league decides who coaches which team
   (lybs-reporting, Manage -> Access). Ballclub keeps its own grants
   (access/{teamId}/{uid}) in its own Firebase project, and one project
   can't read the other's roles. So the Dashboard hands the decision over
   by link instead: each team chip on a coach's row there has a Ballclub
   link that opens this app as

     #coach-invite&email=<coach's email>&team=<Dashboard team name>
                  &division=<division>&sport=<Baseball|Softball>

   After a Google sign-in, this file checks that the account opening the
   link is a Ballclub board member (boardMembers/{uid}), matches the
   Dashboard team to a TEAM_REGISTRY team, asks once, and writes the same
   coach invite the board can already write (invites/{emailKey}/{teamId},
   mirrored at invitesByTeam/{teamId}/{emailKey}). The coach gets the team
   on their next Google sign-in, through access-control.js's
   redeemInvites. No database rule changes: database.rules.json already
   lets a board member write an invite of any role, and nobody else can.

   The email only ever travels in the link's hash, which the browser never
   sends to a server, and the hash is cleared as soon as it is read.
   ============================================================ */
(function () {
  const PREFIX = '#coach-invite&';

  function readRequest(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return null;
    const q = new URLSearchParams(hash.slice(PREFIX.length));
    return {
      email: (q.get('email') || '').trim(),
      team: (q.get('team') || '').trim(),
      division: (q.get('division') || '').trim(),
      sport: (q.get('sport') || '').trim(),
    };
  }

  // "Majors Black (B)" -> "majors-black". The bracket is the Dashboard's
  // sport tag, which the registry keeps in its own sport field instead.
  function slug(s) {
    return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // The registry id for a Dashboard team, or '' if Ballclub has no such
  // team. Tries the team name alone, then with its division in front
  // ("Black" in "Majors" -> majors-black), against both the id and the
  // team's shortName. A team whose sport differs is never a match.
  function matchTeam(teams, req) {
    if (!teams || !req || !req.team) return '';
    const wanted = [slug(req.team), slug(req.division + ' ' + req.team)].filter(Boolean);
    const sportOk = id => !req.sport || !teams[id].sport
      || String(teams[id].sport).toLowerCase() === req.sport.toLowerCase();
    const ids = Object.keys(teams);
    for (const w of wanted) {
      const id = ids.find(i => sportOk(i) && (i === w || slug(teams[i].shortName) === w));
      if (id) return id;
    }
    return '';
  }

  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
  const emailKey = e => (e || '').trim().toLowerCase().replace(/\./g, ',');

  function clearHash() {
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { location.hash = ''; }
  }

  function say(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
    else console.log(text);
  }

  async function ask(text) {
    if (typeof window.confirmModal === 'function') return window.confirmModal(text);
    return window.confirm(text);
  }

  // Returns what happened, for the caller's log and the tests:
  // null (no link), 'bad-link', 'no-team', 'not-board', 'cancelled',
  // 'invited' or 'failed'. Never throws, so a bad link can't stop entry.
  async function handle(user, token) {
    const req = readRequest(location.hash);
    if (!req) return null;
    clearHash();
    try {
      if (!user || !validEmail(req.email) || !req.team) {
        say("That coach link from the Dashboard is missing the coach's email or team.");
        return 'bad-link';
      }
      const teams = (window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams) || {};
      const teamId = matchTeam(teams, req);
      if (!teamId) {
        say(`${req.team} isn't a Ballclub team yet, so there's no team to add this coach to.`);
        return 'no-team';
      }
      let isBoard = false;
      try { isBoard = (await window.dbGet(window.boardMemberPath(user.uid), token)) === true; }
      catch (e) { isBoard = false; }
      if (!isBoard) {
        say(`Only a Ballclub board member can add a coach, and ${user.email || 'this account'} isn't one.`);
        return 'not-board';
      }
      const name = teams[teamId].shortName || teams[teamId].name || teamId;
      const yes = await ask(`Give ${req.email} coach access to ${name} in Ballclub? It takes effect the next time they sign in with Google.`);
      if (!yes) return 'cancelled';
      const key = emailKey(req.email);
      const invite = {
        teamId, role: 'coach', email: req.email,
        invitedByName: user.name || user.email || '',
        createdAt: Date.now(),
      };
      await window.dbUpdate({
        [window.invitePath(key, teamId)]: invite,
        [window.inviteByTeamPath(teamId, key)]: invite,
      }, token);
      say(`${req.email} is invited as a coach of ${name}.`);
      return 'invited';
    } catch (e) {
      console.error('Coach invite from the Dashboard failed:', e);
      say("Couldn't save that coach invite. Check your connection and open the link again.");
      return 'failed';
    }
  }

  window.BoardInvite = { readRequest, matchTeam, slug, handle };
})();
