/* ============================================================
   Backend access -- single source of truth for every Firebase
   Realtime Database path this app touches, plus a MOCK MODE that
   lets the whole app run against an in-memory/localStorage store
   when no real Firebase project is wired up yet.

   This fixes the thing found while auditing ASL Bengals' app
   (the pattern this one is modeled on): that app has its RTDB URL
   as a literal string copy-pasted into 9+ files, and ~24 flat,
   unprefixed top-level paths with no per-team segment. Here, every
   path goes through teamPath()/sharedPath() below, and every path
   is namespaced under teams/{teamId}/... or shared/..., so one
   Firebase project can hold every LYBS team instead of needing a
   separate project per team.

   Real mode talks to Firebase's plain REST endpoints (same as the
   ASL Bengals app) rather than the full Firebase JS SDK, to stay a
   no-build-step static site.

   IMPORTANT: mock mode enforces none of database.rules.json -- every
   dbGet/dbPut below silently succeeds against localStorage regardless
   of what the rules say, so a missing or wrong rule for a new
   teamPath()/sharedPath() key is invisible until real Firebase is
   wired up (this already happened once: six features' worth of new
   paths shipped with no matching .write rule, discovered only by
   diffing this file's call sites against database.rules.json by
   hand). Adding a new key here means adding a matching rule there in
   the SAME change, not as a follow-up.

   Exposes:
     window.FIREBASE_DB_URL     -- set this to your real RTDB URL
       (e.g. 'https://lybs-ballclub-default-rtdb.firebaseio.com')
       to go live. Leave it as 'MOCK' (the default below) to run
       entirely against local mock data -- no Firebase project
       needed yet.
     window.teamPath(teamId, key)   -> 'teams/{teamId}/{key}'
     window.sharedPath(key)         -> 'shared/{key}'
     window.coachPrivatePath(teamId, key) -> 'coachPrivate/{teamId}/{key}' --
       for data that must stay coach-only to READ, not just to write (so
       far: Coach's Notes). teams/{teamId} itself grants .read to coach
       AND player gate emails, and Firebase RTDB rules cascade downward
       only -- a .read rule nested under teams/{teamId} can never be MORE
       restrictive than that ancestor grant, only less. A path that needs
       real read privacy has to live outside the teams/ tree entirely,
       with its own top-level rule -- see database.rules.json's
       "coachPrivate" entry.
     window.accessPath(teamId, uid)       -> 'access/{teamId}/{uid}' --
       "coach" | "parent", keyed by the signed-in Google account's stable
       uid rather than teams/{teamId} itself, so a real per-person grant
       (js/access-control.js) can coexist with the shared code-gate
       accounts above without the two models needing to agree on shape.
     window.boardMemberPath(uid)          -> 'boardMembers/{uid}' -- true
       for a board-wide grant, same uid-keyed idea, not scoped to any team.
     window.personPath(uid)               -> 'people/{uid}' -- {name, email},
       written once at first Google sign-in so an access-list UI has a
       name to show instead of a raw uid.
     window.invitePath(emailKey, teamIdOrBoard)       -> 'invites/{emailKey}/{teamIdOrBoard}'
     window.inviteByTeamPath(teamIdOrBoard, emailKey) -> 'invitesByTeam/{teamIdOrBoard}/{emailKey}'
       Same pending-invite record, stored at both paths (RTDB has no
       reverse-index query, same reason coachPrivate above is its own
       top-level tree) -- by-email so a freshly-signed-in person can look
       up "what's pending for me," by-team so a coach/board panel can look
       up "what's pending for my team." emailKey is the invitee's email,
       lowercased and with '.' replaced by ',' (RTDB keys can't contain
       '.') -- see js/access-control.js's emailKey().
     window.dbGet(path)             -- async, resolves to the JSON
       value at that path (or null).
     window.dbPut(path, value)      -- async, writes the whole
       value at that path (RTDB semantics: PUT replaces).
   ============================================================ */
(function () {
  // Flip this to your real Firebase Realtime Database URL once the
  // project exists (see README.md "Go live" section). Until then,
  // every dbGet/dbPut below is served from a local mock store so
  // the whole app can be built and clicked through today.
  window.FIREBASE_DB_URL = window.FIREBASE_DB_URL || 'MOCK';

  function isMock() {
    return !window.FIREBASE_DB_URL || window.FIREBASE_DB_URL === 'MOCK';
  }

  window.teamPath = function (teamId, key) {
    return `teams/${teamId}/${key}`;
  };
  window.sharedPath = function (key) {
    return `shared/${key}`;
  };
  window.coachPrivatePath = function (teamId, key) {
    return `coachPrivate/${teamId}/${key}`;
  };
  // uid is optional -- omit it to get the whole team's {uid: role} map
  // (js/team-access.js's "who has access" list), rather than one entry.
  window.accessPath = function (teamId, uid) {
    return uid ? `access/${teamId}/${uid}` : `access/${teamId}`;
  };
  window.boardMemberPath = function (uid) {
    return `boardMembers/${uid}`;
  };
  window.personPath = function (uid) {
    return `people/${uid}`;
  };
  window.invitePath = function (emailKey, teamIdOrBoard) {
    return `invites/${emailKey}/${teamIdOrBoard}`;
  };
  // emailKey is optional -- omit it to get the whole team's pending-invite
  // map (js/team-access.js's "pending invites" list), rather than one entry.
  window.inviteByTeamPath = function (teamIdOrBoard, emailKey) {
    return emailKey ? `invitesByTeam/${teamIdOrBoard}/${emailKey}` : `invitesByTeam/${teamIdOrBoard}`;
  };

  // ---- Mock store -------------------------------------------------------
  // Backed by localStorage under one namespaced key so a page reload
  // during local development doesn't lose anything you typed in.
  const MOCK_KEY = 'lybsBallclubMockDb';
  function loadMockDb() {
    try { return JSON.parse(localStorage.getItem(MOCK_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveMockDb(db) {
    try { localStorage.setItem(MOCK_KEY, JSON.stringify(db)); } catch (e) {}
  }
  function getAtPath(db, path) {
    const parts = path.split('/').filter(Boolean);
    let cur = db;
    for (const p of parts) {
      if (cur == null) return null;
      cur = cur[p];
    }
    return cur === undefined ? null : cur;
  }
  function setAtPath(db, path, value) {
    const parts = path.split('/').filter(Boolean);
    let cur = db;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
      cur = cur[p];
    }
    const lastKey = parts[parts.length - 1];
    // Real RTDB deletes the node when you PUT null, so Object.keys() on the
    // parent no longer lists it -- matters for anything keyed by a dynamic
    // id (e.g. access/{teamId}/{uid}, invites/{emailKey}/{teamId}), where
    // the deleted key being merely set to null, not removed, would leave it
    // showing up in a parent-level read/list forever.
    if (value === null || value === undefined) delete cur[lastKey];
    else cur[lastKey] = value;
  }

  // ---- Real mode ----------------------------------------------------------
  function restUrl(path) {
    return `${window.FIREBASE_DB_URL}/${path}.json`;
  }

  // Both below surface a network/HTTP failure with window.showToast (see
  // js/util.js) before rethrowing -- a tap on a dead sideline connection
  // used to just silently do nothing (withBusyButton's own `finally`
  // still clears the busy state regardless of outcome, so that alone
  // reads identically to success). Rethrowing keeps every try/catch a
  // caller already has working exactly as before; this only adds the
  // one thing nothing was doing, telling the person it didn't work.
  window.dbGet = async function (path) {
    if (isMock()) {
      const db = loadMockDb();
      return getAtPath(db, path);
    }
    try {
      const url = await window.firebaseAuthed(restUrl(path));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`dbGet ${path} failed: HTTP ${res.status}`);
      const data = await res.json();
      return data === undefined ? null : data;
    } catch (e) {
      window.showToast("Couldn't load the latest data -- check your connection.");
      throw e;
    }
  };

  window.dbPut = async function (path, value) {
    if (isMock()) {
      const db = loadMockDb();
      setAtPath(db, path, value);
      saveMockDb(db);
      return value;
    }
    try {
      const url = await window.firebaseAuthed(restUrl(path));
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`dbPut ${path} failed: HTTP ${res.status}`);
      return value;
    } catch (e) {
      window.showToast("Couldn't save -- check your connection and try again.");
      throw e;
    }
  };

  window.__isMockBackend = isMock;
})();
