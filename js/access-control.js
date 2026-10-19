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

   A Google account can hold more than one real team grant (a parent
   with kids on two teams) -- the app itself still only ever shows ONE
   team at a time (see js/team-config.js's single "active team" model),
   so a multi-grant account picks which one via showTeamPicker() below,
   either the first time it signs in (then remembered, so a reload
   doesn't re-prompt) or later from the app shell's own "Switch team"
   button (window.AccessControl.switchTeam()). A single-grant account
   never sees the picker at all -- same immediate entry as before.

   A board-only grant (no team role at all) still falls back to a
   read-only view of knownTeamIds()[0] rather than a dead end -- that
   part really is just a stopgap for "no real board console exists
   yet," unrelated to the multi-team picker above.
   ============================================================ */
(function () {
  // RTDB keys can't contain '.', so every dot in the email gets replaced --
  // this has to stay a true global replace. database.rules.json recomputes
  // this same key server-side (for the self-redeem invite match at
  // invites/{emailKey}), but its rules-language .replace() can only
  // replace ONE occurrence per call -- no regex/global flag, no loop
  // construct, so "replace all" there is 10 chained .replace() calls
  // instead (one per potential dot). That only agrees with this true
  // global replace for emails with at most 10 dots total -- comfortably
  // covers every realistic address, but isn't literally the same
  // operation. This was a real, live bug: any "first.last@domain.com"
  // address (2+ dots total) computed a different key here than the rule
  // self-matched against, so a real pending invite silently never
  // resolved for most actual email addresses. If this function's
  // behavior ever changes, that 10x chain in database.rules.json (5 call
  // sites: access/$uid, boardMembers/$uid, invites/$emailKey x2,
  // invitesByTeam/$emailKey) needs to change with it.
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

  // token: this user's own Google ID token, passed explicitly all the way
  // through to dbGet/dbPut -- see those functions' own comments for why.
  // A brand-new sign-in has no grant yet for the normal fallback session
  // (a stale gate session, or a grant-less anonymous one, whichever
  // window.__activeAuthMode/getFirebaseIdToken() would otherwise pick) to
  // read or write any of this against, and window.__activeAuthMode itself
  // isn't set to 'google' until enter() below actually confirms a grant --
  // too late for these first reads/writes, which is what determines
  // whether there's a grant to confirm in the first place.
  async function redeemInvites(uid, email, token) {
    const key = emailKey(email);
    const candidates = [...knownTeamIds(), 'board'];
    for (const teamIdOrBoard of candidates) {
      let invite;
      try {
        invite = await window.dbGet(window.invitePath(key, teamIdOrBoard), token);
      } catch (e) { continue; } // no invite pending (or no read access to it) -- nothing to do
      if (!invite || !invite.role) continue;
      try {
        if (teamIdOrBoard === 'board') await window.dbPut(window.boardMemberPath(uid), true, token);
        else await window.dbPut(window.accessPath(teamIdOrBoard, uid), invite.role, token);
      } catch (e) {
        console.error('Could not redeem invite for', teamIdOrBoard, e);
        continue; // leave the invite in place -- retried next sign-in
      }
      // Best-effort cleanup -- the grant above already landed, so a
      // failure here is harmless: a leftover invite just gets silently
      // re-redeemed (a no-op, since the grant already matches) next time.
      // One atomic multi-path update, not two independent dbPuts -- a
      // dropped connection between two separate calls could delete one
      // mirror but not the other, and team-access.js's pending-invites
      // panel reads only the invitesByTeam side, so it could keep
      // showing someone as "not yet accepted" after they'd already
      // redeemed. Same dbUpdate shape team-access.js's own invite-send/
      // cancel handlers already use for this exact mirrored pair.
      window.dbUpdate({
        [window.invitePath(key, teamIdOrBoard)]: null,
        [window.inviteByTeamPath(teamIdOrBoard, key)]: null,
      }, token).catch(() => {});
    }
  }

  async function resolveGrants(uid, token) {
    const teamIds = knownTeamIds();
    const [isBoard, ...roles] = await Promise.all([
      window.dbGet(window.boardMemberPath(uid), token),
      ...teamIds.map(teamId => window.dbGet(window.accessPath(teamId, uid), token)),
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

  // Last team a multi-grant Google account picked, so a reload doesn't
  // re-prompt every single time -- re-validated against this uid's
  // CURRENT grants on every use (see enter()/switchTeam() below), so a
  // stale value (access revoked, or a different Google account on this
  // same device/browser) just falls back to the picker again, never
  // silently wrong. Single-grant accounts never write or read this.
  const TEAM_CHOICE_KEY = 'lybsGoogleTeamChoice';
  function getRememberedChoice() {
    try { return localStorage.getItem(TEAM_CHOICE_KEY); } catch (e) { return null; }
  }
  function rememberChoice(teamId) {
    try { localStorage.setItem(TEAM_CHOICE_KEY, teamId); } catch (e) {}
  }

  // Resolves each grant's team name for the picker below, without
  // touching the single active "current" team config -- see
  // js/team-config.js's own comment on peek() vs load() for why load()
  // itself can't be used here (it would clobber whichever team actually
  // IS active with the last one resolved).
  async function namedGrants(teams, token) {
    const configs = await Promise.all(teams.map(g => window.TeamConfig.peek(g.teamId, token)));
    return teams.map((g, i) => Object.assign({}, g, {
      name: (configs[i] && (configs[i].shortName || configs[i].name)) || g.teamId,
    }));
  }

  // Resolves to the picked {teamId, role, name}, or null if cancelled.
  // Used both the first time a multi-grant account signs in (no
  // remembered choice yet, or one that no longer matches a current
  // grant) and later, reopened from the app shell's own "Switch team"
  // button (switchTeam() below).
  function showTeamPicker(named) {
    return new Promise(resolve => {
      const screen = document.getElementById('teamPickerScreen');
      const list = document.getElementById('teamPickerList');
      list.innerHTML = named.map((g, i) => `
        <button class="btn btnGhost" data-pick="${i}" style="width:100%;margin-bottom:8px;text-align:left;">
          ${escapeHtml(g.name)} <span style="opacity:.7;">&middot; ${g.role === 'coach' ? 'Coach' : 'Parent'}</span>
        </button>`).join('');
      let settled = false;
      const finish = picked => { if (settled) return; settled = true; screen.classList.add('hide'); resolve(picked); };
      list.querySelectorAll('[data-pick]').forEach(btn => {
        btn.addEventListener('click', () => finish(named[Number(btn.dataset.pick)]));
      });
      const cancelBtn = document.getElementById('teamPickerCancelBtn');
      cancelBtn.onclick = () => finish(null);
      document.getElementById('loginScreen').classList.add('hide');
      document.getElementById('identityScreen').classList.add('hide');
      screen.classList.remove('hide');
    });
  }

  async function enter(user, token) {
    // Already past the login screen (a gate-code login, or an earlier
    // call for this same user) -- don't re-enter on top of it. A device
    // with both a lingering gate session and a Google grant would
    // otherwise race the two paths against each other. This is only the
    // cheap first check, before any awaits below -- window.__identityResolved
    // (set by index.html's onIdentityReady) is re-checked again right
    // before every side effect past that point, since the gate path can
    // still win while this function is mid-await.
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen || loginScreen.classList.contains('hide') || window.__identityResolved) return;

    await window.dbPut(window.personPath(user.uid), { name: user.name, email: user.email }, token);
    const grants = await resolveGrants(user.uid, token);
    if (window.__identityResolved) return; // gate path won while the two awaits above were in flight

    if (grants.teams.length) {
      let grant = grants.teams[0];
      if (grants.teams.length > 1) {
        const remembered = getRememberedChoice();
        const rememberedGrant = remembered && grants.teams.find(g => g.teamId === remembered);
        if (rememberedGrant) {
          grant = rememberedGrant;
        } else {
          const picked = await showTeamPicker(await namedGrants(grants.teams, token));
          if (window.__identityResolved) return; // re-check -- the picker itself can take a while
          // showTeamPicker() hid loginScreen when it opened -- re-show it
          // so the message below (and a retry) is actually visible, not
          // left behind a hidden screen.
          if (!picked) { loginScreen.classList.remove('hide'); showMessage('Sign-in cancelled.'); return; }
          grant = picked;
        }
        rememberChoice(grant.teamId);
      }
      const identity = window.Identity.setSession(grant.teamId, grant.role, user.name);
      await window.TeamConfig.load(grant.teamId, token);
      if (window.__identityResolved) return; // re-check -- TeamConfig.load() is itself async
      // Read by cloud-auth.js's getFirebaseIdToken() -- marks this as the
      // session every dbGet/dbPut should authenticate as from here on,
      // distinct from merely having a Google session available at all.
      // Set only once onIdentityReady confirms THIS call actually won --
      // setting it any earlier could flip the backend auth mode to
      // 'google' even on the rare run where the gate path's own call
      // lands in the gap between this check and the one just above.
      window.__activeAuthMode = 'google';
      loginScreen.classList.add('hide');
      window.onIdentityReady(grant.teamId, grant.role, identity, grants.board, grants.teams);
      return;
    }

    // Board-only stopgap: no team grant, but this is a real board member.
    // There's no board console yet (no cross-team dashboard), so land
    // read-only ('parent' role -- canEdit() stays false) on the first
    // known team rather than leaving a board member with nowhere to go
    // at all -- unrelated to the multi-team picker above (a board grant
    // with no team role isn't a multi-team choice, just a missing one).
    if (grants.board) {
      const teamId = knownTeamIds()[0];
      if (teamId) {
        const identity = window.Identity.setSession(teamId, 'parent', user.name);
        await window.TeamConfig.load(teamId, token);
        if (window.__identityResolved) return; // re-check -- TeamConfig.load() is itself async
        window.__activeAuthMode = 'google';
        loginScreen.classList.add('hide');
        window.onIdentityReady(teamId, 'parent', identity, true, []);
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
      const token = await window.googleAuth.getIdToken();
      await redeemInvites(user.uid, user.email, token);
      await enter(user, token);
    },

    // Re-opens the team picker for the CURRENTLY signed-in Google
    // account -- the app shell's "Switch team" button (only shown when
    // index.html's MY_TEAMS has more than one entry, see onIdentityReady
    // there). Re-resolves grants fresh rather than reusing whatever
    // index.html was handed at entry, so a grant added/removed since
    // then (another tab redeeming an invite, a coach revoking access)
    // is reflected immediately. No window.__identityResolved race to
    // guard here -- that guard is only for the ambiguous "which sign-in
    // path wins" moment at initial entry; this is a deliberate action
    // taken long after entry already finished. Returns the picked
    // {teamId, role, name}, or null if cancelled or there's nothing to
    // switch to (not a real multi-grant account after all, e.g. the
    // board-only stopgap, or every other grant got revoked since entry).
    async switchTeam() {
      const user = window.googleAuth.currentUser();
      if (!user) return null;
      const token = await window.googleAuth.getIdToken();
      const grants = await resolveGrants(user.uid, token);
      if (grants.teams.length < 2) return null;
      const picked = await showTeamPicker(await namedGrants(grants.teams, token));
      if (!picked) return null;
      rememberChoice(picked.teamId);
      const identity = window.Identity.setSession(picked.teamId, picked.role, user.name);
      await window.TeamConfig.load(picked.teamId, token);
      return { teamId: picked.teamId, role: picked.role, identity, isBoard: grants.board, allTeams: grants.teams };
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
