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
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 30000;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  window.sha256Hex = sha256Hex;

  const screenEl = document.getElementById('loginScreen');
  const contentEl = document.querySelector('.loginContent');
  const inputEl = document.getElementById('loginCode');
  const btnEl = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');
  const identityScreenEl = document.getElementById('identityScreen');
  const identityNameEl = document.getElementById('identityName');
  const identityPinEl = document.getElementById('identityPin');
  const identityBtnEl = document.getElementById('identityBtn');
  const identityErrorEl = document.getElementById('identityError');

  let attempts = 0;
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
    try { localStorage.removeItem(LOCKOUT_KEY); } catch (e) {}
  }
  (function checkExistingLock() {
    const left = getLockRemaining();
    if (left > 0) setLocked(left);
  })();

  async function enterApp(teamId, role) {
    await window.TeamConfig.load(teamId);
    const identity = window.Identity.getSession(teamId);
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
      inputEl.value = '';
      await enterApp(match.teamId, match.role);
    } else {
      attempts++;
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
    const pin = identityPinEl.value.trim();
    if (!name) { identityErrorEl.textContent = 'Enter your name.'; return; }
    if (!/^\d{4}$/.test(pin)) { identityErrorEl.textContent = 'PIN must be exactly 4 digits.'; return; }
    const { teamId, role } = pendingTeamRole;
    const identity = window.Identity.setSession(teamId, role, name, pin);
    identityScreenEl.classList.add('hide');
    window.onIdentityReady && window.onIdentityReady(teamId, role, identity);
  }
  identityBtnEl.addEventListener('click', submitIdentity);
  identityPinEl.addEventListener('keydown', e => { if (e.key === 'Enter') submitIdentity(); });

  // Wired to a tap on #whoamiLabel (see index.html's onIdentityReady) --
  // clears this device's remembered identity/session for the team and
  // reloads back to the login screen, so a coach/parent handing off a
  // shared device (or a player moving up a team) can start clean.
  window.logOutOfApp = function (teamId) {
    if (window.Identity && teamId) window.Identity.clear(teamId);
    if (window.signOutOfGate) window.signOutOfGate();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    location.reload();
  };
})();
