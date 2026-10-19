/* ============================================================
   Login screen -- type a team/coach code, we hash it and look it
   up in window.TEAM_REGISTRY.codeHashes (team-registry.js). A
   match both authenticates (cloud-auth.js's signInWithGate) and
   selects which team this device is now looking at. Same
   5-attempt / 30-second lockout as the ASL Bengals login.
   ============================================================ */
(function () {
  const STORAGE_KEY = 'lybsAuthedTeam'; // remembers {teamId, role} across reloads
  const LOCKOUT_KEY = 'lybsLoginLockout';
  // Persisted (not just the in-memory `attempts` counter below) so reloading
  // the page can't reset progress toward MAX_ATTEMPTS -- without this, the
  // 5-attempt lockout only ever triggered within a single page load, and
  // was trivially bypassed by refreshing after every 4 wrong guesses.
  const ATTEMPTS_KEY = 'lybsLoginAttempts';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 30000;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // No caller in this codebase uses window.sha256Hex -- every real check
  // below calls the local function directly. Exposed anyway as a devtools
  // console convenience: `await sha256Hex('newcode')` to generate the hash
  // for a new TEAM_REGISTRY.codeHashes entry by hand.
  window.sha256Hex = sha256Hex;

  const screenEl = document.getElementById('loginScreen');
  const contentEl = document.querySelector('.loginContent');
  const inputEl = document.getElementById('loginCode');
  const btnEl = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');
  const identityScreenEl = document.getElementById('identityScreen');
  const identityNameEl = document.getElementById('identityName');
  const identityBtnEl = document.getElementById('identityBtn');
  const identityErrorEl = document.getElementById('identityError');

  function getAttempts() {
    try { return parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function setAttempts(n) {
    try { localStorage.setItem(ATTEMPTS_KEY, String(n)); } catch (e) {}
  }

  let attempts = getAttempts(); // seeded from any attempts already made before this page load
  let lockTimer = null;
  let pendingTeamRole = null; // {teamId, role} between code accept and identity submit

  function getLockRemaining() {
    try { return Math.max(0, parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10) - Date.now()); }
    catch (e) { return 0; }
  }
  function setLocked(msRemaining) {
    inputEl.disabled = true; btnEl.disabled = true;
    errorEl.textContent = `Too many attempts — try again in ${Math.ceil(msRemaining / 1000)}s.`;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      const left = getLockRemaining();
      if (left > 0) setLocked(left); else clearLock();
    }, 1000);
  }
  function clearLock() {
    inputEl.disabled = false; btnEl.disabled = false;
    errorEl.textContent = ''; attempts = 0;
    try { localStorage.removeItem(LOCKOUT_KEY); localStorage.removeItem(ATTEMPTS_KEY); } catch (e) {}
  }
  (function checkExistingLock() {
    const left = getLockRemaining();
    if (left > 0) setLocked(left);
  })();

  async function enterApp(teamId, role) {
    await window.TeamConfig.load(teamId);
    // access-control.js's Google-resume path can win the race while the
    // await above was in flight -- bail out before touching either screen
    // (showing the "Who's this?" identity screen over an app shell that's
    // already rendered would be a visible glitch, not just a state bug).
    // See index.html's window.__identityResolved for the full picture.
    if (window.__identityResolved) return;
    const identity = window.Identity.getSession(teamId, role);
    screenEl.classList.add('hide');
    if (identity) {
      identityScreenEl.classList.add('hide');
      window.onIdentityReady && window.onIdentityReady(teamId, role, identity);
    } else {
      pendingTeamRole = { teamId, role };
      identityScreenEl.classList.remove('hide');
      identityNameEl.focus();
    }
  }

  // Resume a remembered session without re-typing the code.
  (async function tryResume() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.teamId && window.hasGateSession && window.hasGateSession()) {
        await enterApp(saved.teamId, saved.role);
      }
    } catch (e) {}
  })();

  async function attemptLogin() {
    if (inputEl.disabled) return;
    if (!window.crypto || !window.crypto.subtle) {
      errorEl.textContent = "This browser can't verify the code securely — try a modern browser over https.";
      return;
    }
    const hash = await sha256Hex(inputEl.value);
    const match = window.TEAM_REGISTRY.codeHashes[hash];
    if (match) {
      try {
        await window.signInWithGate(match.teamId, match.role, hash);
      } catch (gateErr) {
        console.error('Gate sign-in failed:', gateErr);
        errorEl.textContent = "Couldn't verify that code right now — check your connection and try again.";
        inputEl.value = ''; inputEl.focus();
        return;
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(match)); } catch (e) {}
      attempts = 0; setAttempts(0); // a correct code clears any prior failed-guess count
      inputEl.value = '';
      await enterApp(match.teamId, match.role);
    } else {
      attempts++;
      setAttempts(attempts);
      inputEl.value = '';
      if (attempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MS;
        try { localStorage.setItem(LOCKOUT_KEY, String(until)); } catch (e) {}
        setLocked(LOCKOUT_MS);
      } else {
        errorEl.textContent = 'Incorrect code — try again.';
        inputEl.focus();
      }
      contentEl.classList.remove('shake');
      void contentEl.offsetWidth;
      contentEl.classList.add('shake');
    }
  }
  btnEl.addEventListener('click', attemptLogin);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

  function submitIdentity() {
    const name = identityNameEl.value.trim();
    if (!name) { identityErrorEl.textContent = 'Enter your name.'; return; }
    const { teamId, role } = pendingTeamRole;
    const identity = window.Identity.setSession(teamId, role, name);
    identityScreenEl.classList.add('hide');
    window.onIdentityReady && window.onIdentityReady(teamId, role, identity);
  }
  identityBtnEl.addEventListener('click', submitIdentity);
  identityNameEl.addEventListener('keydown', e => { if (e.key === 'Enter') submitIdentity(); });

  // Wired to a tap on #whoamiLabel (see index.html's onIdentityReady) --
  // clears this device's remembered identity/session for the team and
  // reloads back to the login screen, so a coach/parent handing off a
  // shared device (or a player moving up a team) can start clean.
  window.logOutOfApp = function (teamId, role) {
    if (window.Identity && teamId) window.Identity.clear(teamId, role);
    if (window.signOutOfGate) window.signOutOfGate();
    if (window.__activeAuthMode === 'google' && window.googleAuth) window.googleAuth.signOut();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    location.reload();
  };
})();
