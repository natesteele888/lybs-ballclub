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
    cur[parts[parts.length - 1]] = value;
  }

  // ---- Real mode ----------------------------------------------------------
  function restUrl(path) {
    return `${window.FIREBASE_DB_URL}/${path}.json`;
  }

  window.dbGet = async function (path) {
    if (isMock()) {
      const db = loadMockDb();
      return getAtPath(db, path);
    }
    const url = await window.firebaseAuthed(restUrl(path));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dbGet ${path} failed: HTTP ${res.status}`);
    const data = await res.json();
    return data === undefined ? null : data;
  };

  window.dbPut = async function (path, value) {
    if (isMock()) {
      const db = loadMockDb();
      setAtPath(db, path, value);
      saveMockDb(db);
      return value;
    }
    const url = await window.firebaseAuthed(restUrl(path));
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`dbPut ${path} failed: HTTP ${res.status}`);
    return value;
  };

  window.__isMockBackend = isMock;
})();
