/* ============================================================
   Firebase Auth gate -- multi-tenant version of the pattern used
   by the ASL Bengals app (js/cloud-auth.js there). Same mechanism:
   type a code -> auth.js hashes it and looks it up in
   window.TEAM_REGISTRY.codeHashes -> on a match, sign into a real
   Firebase account whose "password" IS that hash, so the plaintext
   code itself never travels anywhere or gets stored.

   What's different from the Bengals version: that app has exactly
   two fixed gate accounts (player-gate@, coach-gate@), because it
   only ever serves one team. Here the account email is derived
   from BOTH the role and the teamId (gateEmail below), so Select's
   player account is a different Firebase identity than Majors B's
   player account once that team is added -- each team's data stays
   isolated by Realtime Database security rules keyed off exactly
   which gate account is signed in, the same way the Bengals
   database rules key off sign_in_provider today.

   Exposes the same surface as the Bengals version:
     window.getFirebaseIdToken()
     window.firebaseAuthed(url)
     window.signInWithGate(teamId, role, passwordHash)
     window.hasGateSession()
     window.currentGateSession() -- {teamId, role} or null
   ============================================================ */
(function () {
  // Public project identifier, not a secret -- see README.md "Go live".
  // Left blank until a real Firebase project exists; backend.js's MOCK
  // mode means nothing in this file is actually called until then.
  const FIREBASE_API_KEY = window.FIREBASE_API_KEY || '';
  const SIGNUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
  const SIGNIN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
  const SAFETY_MARGIN_MS = 60000;

  const GATE_SESSION_KEY = 'lybsGateSession'; // {refreshToken, teamId, role}

  function gateEmail(teamId, role) {
    return `${role}-${teamId}-gate@lybsballclub.internal`;
  }

  let cached = null;   // { idToken, refreshToken, expiresAt, teamId, role }
  let inFlight = null;

  function loadGateSession() {
    try { return JSON.parse(localStorage.getItem(GATE_SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveGateSession(refreshToken, teamId, role) {
    try { localStorage.setItem(GATE_SESSION_KEY, JSON.stringify({ refreshToken, teamId, role })); }
    catch (e) {}
  }
  window.hasGateSession = function () {
    const s = loadGateSession();
    return !!(s && s.refreshToken);
  };
  window.currentGateSession = function () {
    if (cached) return { teamId: cached.teamId, role: cached.role };
    const s = loadGateSession();
    return s ? { teamId: s.teamId, role: s.role } : null;
  };
  window.signOutOfGate = function () {
    cached = null;
    try { localStorage.removeItem(GATE_SESSION_KEY); } catch (e) {}
  };

  async function signInAnonymously() {
    const res = await fetch(SIGNUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!res.ok) throw new Error('Anonymous sign-in failed: HTTP ' + res.status);
    const data = await res.json();
    return { idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + Number(data.expiresIn) * 1000 };
  }

  async function refreshIdToken(refreshToken) {
    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (!res.ok) throw new Error('Token refresh failed: HTTP ' + res.status);
    const data = await res.json();
    return { idToken: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  }

  // Called by auth.js once a typed code's hash matches an entry in
  // TEAM_REGISTRY.codeHashes. passwordHash is that same SHA-256 hex
  // string, reused as the Firebase account password.
  window.signInWithGate = async function (teamId, role, passwordHash) {
    if (window.__isMockBackend && window.__isMockBackend()) {
      cached = { idToken: 'mock-token', refreshToken: 'mock-refresh', expiresAt: Date.now() + 3600000, teamId, role };
      saveGateSession(cached.refreshToken, teamId, role);
      return cached;
    }
    const email = gateEmail(teamId, role);
    let res = await fetch(SIGNUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: passwordHash, returnSecureToken: true }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const code = errBody.error && errBody.error.message;
      if (code === 'EMAIL_EXISTS') {
        res = await fetch(SIGNIN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: passwordHash, returnSecureToken: true }),
        });
        if (!res.ok) throw new Error('Gate sign-in failed: HTTP ' + res.status);
      } else {
        throw new Error('Gate account setup failed: ' + (code || res.status));
      }
    }
    const data = await res.json();
    cached = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn) * 1000,
      teamId, role,
    };
    saveGateSession(cached.refreshToken, teamId, role);
    return cached;
  };

  window.getFirebaseIdToken = async function () {
    if (window.__isMockBackend && window.__isMockBackend()) return 'mock-token';
    // Only when js/access-control.js's enter() actually used a Google
    // session to get into the app -- not just whenever one happens to
    // exist. A device can hold a lingering gate session AND a persisted
    // Google session at once; whichever one actually won the entry race
    // (see access-control.js's loginScreen-hidden guard) is the one every
    // dbGet/dbPut has to keep using for the rest of the page's life, or
    // every call would silently carry the other identity's token while
    // the UI still shows the one that actually won.
    if (window.__activeAuthMode === 'google' && window.googleAuth && window.googleAuth.hasSession()) {
      return window.googleAuth.getIdToken();
    }
    if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) return cached.idToken;
    if (!inFlight) {
      inFlight = (async () => {
        try {
          if (cached && cached.refreshToken) {
            cached = Object.assign({}, await refreshIdToken(cached.refreshToken), { teamId: cached.teamId, role: cached.role });
          } else {
            const saved = loadGateSession();
            if (saved && saved.refreshToken) {
              cached = Object.assign({}, await refreshIdToken(saved.refreshToken), { teamId: saved.teamId, role: saved.role });
              saveGateSession(cached.refreshToken, saved.teamId, saved.role);
            } else {
              cached = await signInAnonymously();
            }
          }
        } catch (e) {
          cached = await signInAnonymously();
        }
        return cached;
      })().finally(() => { inFlight = null; });
    }
    const c = await inFlight;
    return c.idToken;
  };

  window.firebaseAuthed = async function (url) {
    const token = await window.getFirebaseIdToken();
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    return `${url}${sep}auth=${encodeURIComponent(token)}`;
  };
})();
