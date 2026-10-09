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

   window.Identity.getSession()      -- {name, teamId, role} or null
   window.Identity.setSession(teamId, role, name)
   window.Identity.clear(teamId)
   ============================================================ */
(function () {
  function key(teamId) { return `lybsIdentity_${teamId}`; }

  window.Identity = {
    getSession(teamId) {
      try { return JSON.parse(localStorage.getItem(key(teamId)) || 'null'); }
      catch (e) { return null; }
    },
    setSession(teamId, role, name) {
      const session = { teamId, role, name: name.trim() };
      try { localStorage.setItem(key(teamId), JSON.stringify(session)); } catch (e) {}
      return session;
    },
    clear(teamId) {
      try { localStorage.removeItem(key(teamId)); } catch (e) {}
    },
  };
})();
