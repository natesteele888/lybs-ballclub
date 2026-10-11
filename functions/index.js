/* ============================================================
   Cloud Functions for lybs-ballclub. Currently just one:
   triggerStandingsSync, a secure proxy that lets a signed-in board
   member trigger the standings/scores GitHub Action
   (.github/workflows/standings.yml) sooner than its own 30-minute
   schedule, from a real button inside the app itself.

   Why this has to be a server-side function and not a button that
   calls GitHub directly from the browser: kicking off that workflow
   needs a token with write access to this repo's Actions -- not
   something a static, client-side PWA can hold without exposing it
   to anyone who opens devtools. This function holds that token (a
   Secret Manager secret, never in source control or in the client
   bundle) and only ever uses it after confirming the caller is a
   real board member -- the same boardMembers/{uid} == true check
   database.rules.json already enforces everywhere else a board-only
   write happens in this app, so this endpoint draws the same line
   the rest of the app already draws, not a new one.

   An earlier version of this feature just linked out to GitHub's own
   "Run workflow" button -- zero new infrastructure, but only usable
   by whoever is signed into GitHub with write access to this repo,
   which isn't every board member. This function is what makes it a
   real one-tap button for all of them, at the cost of needing the
   Blaze (pay-as-you-go) plan -- Cloud Functions can't deploy on the
   free Spark plan at all. Real-world cost for a function that only
   ever runs when a board member taps one button: at or near $0/month,
   comfortably inside Blaze's own free invocation tier.

   Deploy (one-time setup, then `firebase deploy --only functions` for
   any future change to this file):
     1. firebase projects:list -- confirm you're pointed at lybs-ballclub
     2. Upgrade the project to the Blaze plan in the Firebase console
        (Project settings -> Usage and billing) if it isn't already.
     3. Create a fine-grained GitHub personal access token scoped to
        ONLY this repo (natesteele888/lybs-ballclub), permission
        "Actions: Read and write", nothing else.
     4. firebase functions:secrets:set GITHUB_DISPATCH_TOKEN
        (paste that token when prompted)
     5. firebase deploy --only functions
   The deployed URL is predictable (no need to paste it back into the
   app afterward): https://us-central1-lybs-ballclub.cloudfunctions.net/triggerStandingsSync
   -- js/data-admin.js already points at exactly that.
   ============================================================ */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const GITHUB_DISPATCH_TOKEN = defineSecret('GITHUB_DISPATCH_TOKEN');

exports.triggerStandingsSync = onRequest(
  {
    secrets: [GITHUB_DISPATCH_TOKEN],
    region: 'us-central1',
    // Only the real, deployed app -- this endpoint performs a privileged
    // action (kicks off a workflow run), so it should never be callable
    // from anywhere else just because a page happened to get someone's
    // Firebase ID token some other way.
    cors: ['https://natesteele888.github.io'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    let uid;
    try {
      uid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch (e) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const snap = await admin.database().ref(`boardMembers/${uid}`).get();
    if (snap.val() !== true) {
      res.status(403).json({ error: 'Not a board member' });
      return;
    }

    let ghRes;
    try {
      ghRes = await fetch(
        'https://api.github.com/repos/natesteele888/lybs-ballclub/actions/workflows/standings.yml/dispatches',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN.value()}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );
    } catch (e) {
      logger.error('GitHub dispatch request failed', e);
      res.status(502).json({ error: 'Could not reach GitHub' });
      return;
    }

    if (!ghRes.ok) {
      const body = await ghRes.text().catch(() => '');
      logger.error('GitHub dispatch rejected', ghRes.status, body);
      res.status(502).json({ error: `GitHub rejected the request: HTTP ${ghRes.status}` });
      return;
    }

    res.status(200).json({ ok: true });
  }
);
