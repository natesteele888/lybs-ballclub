/* ============================================================
   Player/coach identity -- the "who's playing?" step after a code
   is accepted. Same idea as ASL Bengals' PlayerIdentity: a name +
   4-digit PIN made up on the spot the first time and reused after,
   so the app can tell devices/people apart without anyone creating
   a real account. Scoped per team: the same name on two different
   teams' logins gets two independent identities, since a parent
   coaching one team and watching another shouldn't collide.

   window.Identity.getSession()      -- {name, pin, teamId, role} or null
   window.Identity.setSession(name, pin)
   window.Identity.clear()
   ============================================================ */
(function () {
  function key(teamId) { return `lybsIdentity_${teamId}`; }

  window.Identity = {
    getSession(teamId) {
      try { return JSON.parse(localStorage.getItem(key(teamId)) || 'null'); }
      catch (e) { return null; }
    },
    setSession(teamId, role, name, pin) {
      const session = { teamId, role, name: name.trim(), pin };
      try { localStorage.setItem(key(teamId), JSON.stringify(session)); } catch (e) {}
      return session;
    },
    clear(teamId) {
      try { localStorage.removeItem(key(teamId)); } catch (e) {}
    },
  };
})();
