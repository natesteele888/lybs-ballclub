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
     window.signInWithGate(teamId, role, typedCode)
     window.hasGateSession()

   Gate password (Nov 2026): the account password is NOT the published
   SHA-256 hash any more. team-registry.js publishes sha256(code) so the
   login screen can check a code, which meant anyone could copy a hash
   from GitHub and use it directly as the Firebase password. Now the
   password is PBKDF2(code) with a separate salt (gatePassword below),
   so it can only be worked out by someone who knows the code itself.
   scripts/rotate-gate-passwords.mjs moves existing accounts over and
   uses the exact same recipe -- change one, change both. An account
   that still has the old password is also moved the first time its
   code is typed (signInWithGate below), so shipping this never locks a
   team out; the script is still how to end old saved sessions at once,
   and how to follow a code change (set-team-codes.mjs).
   ============================================================ */
(function () {
  // Public project identifier, not a secret -- see README.md "Go live".
  // Left blank until a real Firebase project exists; backend.js's MOCK
  // mode means nothing in this file is actually called until then.
  const FIREBASE_API_KEY = window.FIREBASE_API_KEY || '';
  const SIGNUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
  const SIGNIN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
  const UPDATE_URL = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`;
  const SAFETY_MARGIN_MS = 60000;

  const GATE_SESSION_KEY = 'lybsGateSession'; // {refreshToken, teamId, role}

  function gateEmail(teamId, role) {
    return `${role}-${teamId}-gate@lybsballclub.internal`;
  }

  // Must match scripts/rotate-gate-passwords.mjs exactly.
  const GATE_PW_SALT_PREFIX = 'lybs-ballclub-gate-v2';
  const GATE_PW_ITERATIONS = 100000;
  async function gatePassword(typedCode, teamId, role) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(typedCode), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`${GATE_PW_SALT_PREFIX}|${teamId}|${role}`), iterations: GATE_PW_ITERATIONS },
      key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // What every gate account had as its password before Nov 2026: the
  // published SHA-256 of the code. Only used to move an old account over.
  async function legacyGatePassword(typedCode) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typedCode));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
  window.signOutOfGate = function () {
    cached = null;
    try { localStorage.removeItem(GATE_SESSION_KEY); } catch (e) {}
    if (window.clearOfflineCopies) window.clearOfflineCopies();
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
    if (!res.ok) {
      // 400 = this refresh token is dead for good (e.g. the gate password
      // was changed, which ends every saved session). Forget it so the
      // next page load shows the code screen instead of failing forever.
      if (res.status === 400) window.signOutOfGate();
      throw new Error('Token refresh failed: HTTP ' + res.status);
    }
    const data = await res.json();
    return { idToken: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  }

  // Called by auth.js once a typed code's hash matches an entry in
  // TEAM_REGISTRY.codeHashes. typedCode is the code as typed; the
  // Firebase password is derived from it (gatePassword above), never
  // the published hash.
  window.signInWithGate = async function (teamId, role, typedCode) {
    if (window.__isMockBackend && window.__isMockBackend()) {
      cached = { idToken: 'mock-token', refreshToken: 'mock-refresh', expiresAt: Date.now() + 3600000, teamId, role };
      saveGateSession(cached.refreshToken, teamId, role);
      return cached;
    }
    const email = gateEmail(teamId, role);
    const password = await gatePassword(typedCode, teamId, role);
    const post = (url, body) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let res = await post(SIGNUP_URL, { email, password, returnSecureToken: true });
    let data;
    if (res.ok) {
      data = await res.json();
    } else {
      const errBody = await res.json().catch(() => ({}));
      const code = errBody.error && errBody.error.message;
      if (code !== 'EMAIL_EXISTS') throw new Error('Gate account setup failed: ' + (code || res.status));
      res = await post(SIGNIN_URL, { email, password, returnSecureToken: true });
      if (res.ok) {
        data = await res.json();
      } else {
        // Either the code really is wrong, or this account still has the
        // old password (the published hash of the code), because
        // scripts/rotate-gate-passwords.mjs has not been run for it yet.
        // Try the old one once; if it works the person does know the code,
        // so move the account onto the new password and the published
        // hash stops working. This is what lets the new app ship without
        // locking anyone out while the script is still to be run.
        const old = await post(SIGNIN_URL, { email, password: await legacyGatePassword(typedCode), returnSecureToken: true });
        if (!old.ok) throw new Error('Gate sign-in failed: HTTP ' + res.status);
        data = await old.json();
        try {
          const upd = await post(UPDATE_URL, { idToken: data.idToken, password, returnSecureToken: true });
          const moved = upd.ok ? await upd.json() : null;
          if (moved && moved.idToken && moved.refreshToken) data = moved;
        } catch (e) {
          // Signed in either way; the next sign-in tries the move again.
        }
      }
    }
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
        // Only the "nothing to refresh at all" branches fall back to
        // signInAnonymously() -- a REFRESH ATTEMPT that fails (network
        // blip, or a genuinely revoked/invalid refresh token) propagates
        // instead of being silently swallowed into the same fallback.
        // That used to downgrade a real gate/Google session to a fresh,
        // grant-less anonymous identity on any transient failure, with
        // no error shown and no re-login prompt -- every subsequent
        // protected read/write then failed permission-denied against
        // that new anonymous uid for the rest of the session. Letting it
        // throw here instead routes through dbGet/dbPut/dbUpdate's own
        // existing catch (backend.js), which already shows a "couldn't
        // connect" toast and re-throws -- the same visible failure every
        // other network error in this app already gets, and the next
        // call just retries the refresh instead of being stuck anonymous.
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
        return cached;
      })().finally(() => { inFlight = null; });
    }
    const c = await inFlight;
    return c.idToken;
  };

  // explicitToken lets a caller bypass window.__activeAuthMode's own
  // session-picking entirely -- see js/access-control.js's redeemInvites()/
  // enter() for why: a brand-new Google sign-in needs to authenticate as
  // itself for its own first invite/grant reads, before __activeAuthMode
  // is set (deliberately late, only once that flow confirms it actually
  // won the entry race -- see its own comment).
  window.firebaseAuthed = async function (url, explicitToken) {
    const token = explicitToken || await window.getFirebaseIdToken();
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    return `${url}${sep}auth=${encodeURIComponent(token)}`;
  };
})();
