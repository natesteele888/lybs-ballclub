/* ============================================================
   Google Sign-In -- a second, additive way to authenticate,
   alongside the existing shared-code gate (js/cloud-auth.js). A
   real per-person identity is what makes board/coach/parent
   invites possible at all: the gate's shared per-team accounts
   have no way to tell two parents on the same team apart, let
   alone grant one of them something the other doesn't have.

   Uses Firebase's own compat SDK (loaded via <script> tags in
   index.html, before this file) rather than hand-rolled REST calls
   -- unlike cloud-auth.js's gate flow, a real OAuth round-trip
   with Google isn't something to get subtly wrong by hand, and the
   compat build keeps this a classic script, matching the rest of
   the app. The SDK also means session persistence/refresh is
   handled internally -- no refresh-token REST plumbing to write,
   unlike cloud-auth.js's gate sessions.

   window.googleAuth.signIn()        -- prompts Google sign-in, returns
     the signed-in user, or null if the flow left the page (redirect
     fallback below -- the real result arrives via onReady() on the
     page it lands back on, not as this call's return value).
   window.googleAuth.signOut()
   window.googleAuth.hasSession()    -- sync
   window.googleAuth.currentUser()   -- sync, {uid, email, emailVerified, name} or null
   window.googleAuth.getIdToken()    -- async, auto-refreshed by the SDK
   window.googleAuth.onReady(fn)     -- fires once with the initial user (or
     null) as soon as Firebase has checked for a persisted session -- this
     is what drives resuming a Google session on page reload, the same
     role auth.js's tryResume() plays for the gate flow.
   ============================================================ */
(function () {
  let auth = null;
  let readyCallbacks = [];
  let initialUser; // undefined = not yet known, null = known-signed-out

  function ensureInit() {
    if (auth) return;
    firebase.initializeApp({
      apiKey: window.FIREBASE_API_KEY,
      authDomain: window.FIREBASE_AUTH_DOMAIN,
    });
    auth = firebase.auth();
    auth.onAuthStateChanged(user => {
      if (initialUser === undefined) {
        initialUser = user || null;
        const toRun = readyCallbacks;
        readyCallbacks = [];
        toRun.forEach(fn => fn(initialUser));
      }
    });
    // A redirect-flow sign-in (see the popup-failure fallback in signIn()
    // below) finishes here, on whichever page load it lands back on.
    auth.getRedirectResult().catch(err => {
      console.error('Google redirect sign-in failed:', err);
    });
  }

  function toUser(fbUser) {
    if (!fbUser) return null;
    return { uid: fbUser.uid, email: fbUser.email, emailVerified: fbUser.emailVerified, name: fbUser.displayName || fbUser.email };
  }

  window.googleAuth = {
    onReady(fn) {
      ensureInit();
      if (initialUser !== undefined) fn(toUser(initialUser));
      else readyCallbacks.push(user => fn(toUser(user)));
    },
    hasSession() {
      ensureInit();
      return !!auth.currentUser;
    },
    currentUser() {
      ensureInit();
      return toUser(auth.currentUser);
    },
    async getIdToken() {
      ensureInit();
      if (!auth.currentUser) throw new Error('No Google session');
      return auth.currentUser.getIdToken();
    },
    async signIn() {
      ensureInit();
      const provider = new firebase.auth.GoogleAuthProvider();
      try {
        const result = await auth.signInWithPopup(provider);
        return toUser(result.user);
      } catch (err) {
        // A popup that never opened or got torn down by the OS -- known to
        // happen specifically inside an installed, standalone-mode PWA on
        // iOS Safari. Fall back to a full-page redirect instead; the result
        // comes back through getRedirectResult() above on the next load.
        // auth/popup-closed-by-user is deliberately NOT included here --
        // that means they chose to cancel, not that the popup failed, and
        // forcing a full-page redirect after a deliberate cancel would be
        // the more surprising behavior of the two.
        const popupFailures = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'];
        if (popupFailures.includes(err.code)) {
          await auth.signInWithRedirect(provider);
          return null;
        }
        throw err;
      }
    },
    async signOut() {
      ensureInit();
      await auth.signOut();
    },
  };
})();
