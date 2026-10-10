/* ============================================================
   Access control -- resolves what a Google-signed-in person can
   do, once js/google-auth.js confirms who they are. Two jobs:

   1. Redeem pending invites (invites/{emailKey}/{teamId|'board'} --
      see js/backend.js's invitePath()/inviteByTeamPath()) by writing
      the matching access/{teamId}/{uid} grant or a board-wide
      boardMembers/{uid} grant, matching database.rules.json's own
      invite-matching rule -- see that file's "access"/"boardMembers"
      entries.
   2. Resolve whatever grants this uid already holds (from a prior
      sign-in, or from step 1 just now) and hand off to the exact
      same window.onIdentityReady() the code-gate login (js/auth.js)
      already uses -- nothing downstream of that call needs to know
      or care which path got you there. A 'parent' grant here reads
      identically to the gate's 'player' role everywhere else in the
      app (canEdit() only ever checks for 'coach').

   Wired from index.html: as soon as window.googleAuth reports an
   initial user (a resumed session) or a fresh sign-in, this runs.
   A signed-in person with no grant anywhere sees a plain "ask for
   an invite" message instead of entering the app -- there is no
   self-serve request-access flow.

   Only one team exists today, so enter() just takes grants.teams[0]
   rather than offering a real picker, and a board-only grant (no
   team role at all) falls back to a read-only view of that same
   first team rather than a dead end -- both stopgaps for "only one
   team exists," not a real multi-team picker or board console.
   Revisit once a second team exists to make either one matter.
   ============================================================ */
(function () {
  function emailKey(email) {
    return (email || '').trim().toLowerCase().replace(/\./g, ',');
  }

  // Every team this build knows about -- the same list the code-gate login
  // reads to populate TEAM_REGISTRY.teams. Probed one at a time (plus
  // 'board'), not listed as a whole: invites/{emailKey} carries no .read
  // rule of its own to allow listing, only each {teamIdOrBoard} leaf does
  // -- see database.rules.json.
  function knownTeamIds() {
    return Object.keys((window.TEAM_REGISTRY && window.TEAM_REGISTRY.teams) || {});
  }

  async function redeemInvites(uid, email) {
    const key = emailKey(email);
    const candidates = [...knownTeamIds(), 'board'];
    for (const teamIdOrBoard of candidates) {
      let invite;
      try {
        invite = await window.dbGet(window.invitePath(key, teamIdOrBoard));
      } catch (e) { continue; } // no invite pending (or no read access to it) -- nothing to do
      if (!invite || !invite.role) continue;
      try {
        if (teamIdOrBoard === 'board') await window.dbPut(window.boardMemberPath(uid), true);
        else await window.dbPut(window.accessPath(teamIdOrBoard, uid), invite.role);
      } catch (e) {
        console.error('Could not redeem invite for', teamIdOrBoard, e);
        continue; // leave the invite in place -- retried next sign-in
      }
      // Best-effort cleanup -- the grant above already landed, so a
      // failure here is harmless: a leftover invite just gets silently
      // re-redeemed (a no-op, since the grant already matches) next time.
      window.dbPut(window.invitePath(key, teamIdOrBoard), null).catch(() => {});
      window.dbPut(window.inviteByTeamPath(teamIdOrBoard, key), null).catch(() => {});
    }
  }

  async function resolveGrants(uid) {
    const teamIds = knownTeamIds();
    const [isBoard, ...roles] = await Promise.all([
      window.dbGet(window.boardMemberPath(uid)),
      ...teamIds.map(teamId => window.dbGet(window.accessPath(teamId, uid))),
    ]);
    const teams = teamIds
      .map((teamId, i) => ({ teamId, role: roles[i] }))
      .filter(g => g.role === 'coach' || g.role === 'parent');
    return { board: !!isBoard, teams };
  }

  function showMessage(text) {
    const el = document.getElementById('loginError');
    if (el) el.textContent = text;
  }

  async function enter(user) {
    // Already past the login screen (a gate-code login, or an earlier
    // call for this same user) -- don't re-enter on top of it. A device
    // with both a lingering gate session and a Google grant would
    // otherwise race the two paths against each other.
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen || loginScreen.classList.contains('hide')) return;

    await window.dbPut(window.personPath(user.uid), { name: user.name, email: user.email });
    const grants = await resolveGrants(user.uid);

    if (grants.teams.length) {
      const grant = grants.teams[0];
      const identity = window.Identity.setSession(grant.teamId, grant.role, user.name);
      await window.TeamConfig.load(grant.teamId);
      // Read by cloud-auth.js's getFirebaseIdToken() -- marks this as the
      // session every dbGet/dbPut should authenticate as from here on,
      // distinct from merely having a Google session available at all.
      window.__activeAuthMode = 'google';
      loginScreen.classList.add('hide');
      window.onIdentityReady(grant.teamId, grant.role, identity, grants.board);
      return;
    }

    // Board-only stopgap: no team grant, but this is a real board member.
    // There's no board console yet (no cross-team dashboard, no "pick a
    // team" picker), and only one team exists today, so land read-only
    // ('parent' role -- canEdit() stays false) on the first known team
    // rather than leaving a board member with nowhere to go at all. This
    // is explicitly a stopgap for "only one team exists" -- revisit once
    // a second team or a real board console makes knownTeamIds()[0] not
    // an obviously-right pick anymore.
    if (grants.board) {
      const teamId = knownTeamIds()[0];
      if (teamId) {
        const identity = window.Identity.setSession(teamId, 'parent', user.name);
        await window.TeamConfig.load(teamId);
        window.__activeAuthMode = 'google';
        loginScreen.classList.add('hide');
        window.onIdentityReady(teamId, 'parent', identity, true);
        return;
      }
    }

    showMessage(grants.board
      ? `Signed in as ${user.email} with board access, but no team exists yet to view.`
      : `Signed in as ${user.email}, but no team has invited you yet -- ask your coach or board for an invite.`);
  }

  window.AccessControl = {
    async handleSignedInUser(user) {
      if (!user) return;
      await redeemInvites(user.uid, user.email);
      await enter(user);
    },
  };

  window.googleAuth.onReady(user => { if (user) window.AccessControl.handleSignedInUser(user); });

  const googleBtn = document.getElementById('googleSignInBtn');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      const errEl = document.getElementById('googleSignInError');
      if (errEl) errEl.textContent = '';
      googleBtn.disabled = true;
      try {
        const user = await window.googleAuth.signIn();
        if (user) await window.AccessControl.handleSignedInUser(user);
      } catch (e) {
        console.error('Google sign-in failed:', e);
        if (errEl) errEl.textContent = "Couldn't sign in with Google -- try again.";
      } finally {
        googleBtn.disabled = false;
      }
    });
  }
})();
