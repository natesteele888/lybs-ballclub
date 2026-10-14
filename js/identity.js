/* ============================================================
   Player/coach identity -- the "who's playing?" step after a code
   is accepted. Originally modeled on ASL Bengals' PlayerIdentity (a
   name + 4-digit PIN made up on the spot), but the PIN was never
   actually checked against anything anywhere in this app -- pure
   friction, one more thing to make up and remember, for a
   disambiguation it didn't do. Removed; this device just remembers
   whatever name was typed, same as it already remembered the PIN
   without ever using it. Scoped per team: the same name on two
   different teams' logins gets two independent identities, since a
   parent coaching one team and watching another shouldn't collide.

   window.Identity.getSession(teamId, role) -- {name, teamId, role} or null
   window.Identity.setSession(teamId, role, name)
   window.Identity.clear(teamId, role)
   ============================================================ */
(function () {
  // Scoped by role as well as team -- a team can have two different gate
  // codes mapping to the same teamId but different roles (see
  // team-registry.js's codeHashes, 'select'/player and 'select'/coach),
  // so a shared device that's already remembered a name under one role
  // used to silently reuse that same name when the OTHER role's code was
  // entered next, with no re-prompt -- e.g. a coach seeing a parent's
  // remembered name attached to everything they post. Same reasoning as
  // the per-team scoping above: a coach and a parent on the same team are
  // different hats one device might wear, same as two different teams.
  function key(teamId, role) { return `lybsIdentity_${teamId}_${role}`; }

  window.Identity = {
    getSession(teamId, role) {
      try { return JSON.parse(localStorage.getItem(key(teamId, role)) || 'null'); }
      catch (e) { return null; }
    },
    setSession(teamId, role, name) {
      const session = { teamId, role, name: name.trim() };
      try { localStorage.setItem(key(teamId, role), JSON.stringify(session)); } catch (e) {}
      return session;
    },
    clear(teamId, role) {
      try { localStorage.removeItem(key(teamId, role)); } catch (e) {}
    },
  };
})();
