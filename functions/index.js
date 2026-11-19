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

   Walk-up song request alerts (added 2026-11-16, see js/song-requests.js):
     pushKey          -- hands the app the public half of the Web Push
                         key so a phone can turn alerts on. Public by
                         design (it's what every browser is given).
     onSongRequest    -- a family adds a request -> every coach phone that
                         turned alerts on gets "#12 Sam asked for a song".
     onSongDecision   -- a coach approves or declines -> the phone that
                         asked (if it turned alerts on) gets the answer.
   Both read pushSubs/{teamId}/... (written by the app, readable by
   nothing but this file) and drop a subscription the push service says
   is gone. One-time setup for these, on top of the steps above:
     1. npx web-push generate-vapid-keys --json
     2. firebase functions:secrets:set WEBPUSH_PUBLIC_KEY   (the publicKey)
     3. firebase functions:secrets:set WEBPUSH_PRIVATE_KEY  (the privateKey)
     4. firebase deploy --only database,functions

   One sign-in for coaches (added 2026-11-18, see functions/dashboard-sync.js):
     dashboardCoachSync -- a coach signs in to Ballclub with Google and gets
                         the teams the LYBS Dashboard gives them, as coach.
   It reads the Dashboard's own project (lybs-dashboard), read only, with
   no key. One-time setup, on top of the steps above:
     1. Google Cloud console, project lybs-ballclub -> IAM: copy the email
        of the "Default compute service account"
        (<number>-compute@developer.gserviceaccount.com).
     2. Project lybs-dashboard -> IAM -> Grant access: paste that email and
        give it two roles, "Cloud Datastore Viewer" and
        "Firebase Authentication Viewer". Nothing else.
     3. firebase deploy --only functions:dashboardCoachSync
   Until it is deployed the app's call just fails quietly, and coach links
   from the Dashboard (js/board-invite.js) keep working as before.
   ============================================================ */
const { onRequest } = require('firebase-functions/v2/https');
const { onValueCreated, onValueUpdated, onValueDeleted } = require('firebase-functions/v2/database');
const webpush = require('web-push');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const GITHUB_DISPATCH_TOKEN = defineSecret('GITHUB_DISPATCH_TOKEN');
const WEBPUSH_PUBLIC_KEY = defineSecret('WEBPUSH_PUBLIC_KEY');
const WEBPUSH_PRIVATE_KEY = defineSecret('WEBPUSH_PRIVATE_KEY');

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

    let snap;
    try {
      snap = await admin.database().ref(`boardMembers/${uid}`).get();
    } catch (e) {
      logger.error('boardMembers lookup failed', e);
      res.status(503).json({ error: 'Could not verify authorization' });
      return;
    }
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

/* ---------- walk-up song request alerts ---------- */
const DB_TRIGGER = { instance: 'lybs-ballclub-default-rtdb', region: 'us-central1', secrets: [WEBPUSH_PUBLIC_KEY, WEBPUSH_PRIVATE_KEY] };

exports.pushKey = onRequest(
  { secrets: [WEBPUSH_PUBLIC_KEY], region: 'us-central1', cors: ['https://natesteele888.github.io'] },
  (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(WEBPUSH_PUBLIC_KEY.value().trim());
  }
);

function playerLabel(p) {
  if (!p) return 'A player';
  const first = String(p.name || '').trim().split(/\s+/)[0] || '';
  return ((p.number ? '#' + p.number + ' ' : '') + first).trim() || 'A player';
}
async function rosterPlayer(teamId, pid) {
  const roster = (await admin.database().ref(`teams/${teamId}/roster`).get()).val();
  const list = Array.isArray(roster) ? roster : Object.values(roster || {});
  return list.find(p => p && p.id === pid) || null;
}
// Sends one alert to every subscription under ref; drops the ones the push service says are gone.
async function sendAll(ref, payload) {
  const subs = (await ref.get()).val() || {};
  webpush.setVapidDetails('https://natesteele888.github.io/lybs-ballclub/', WEBPUSH_PUBLIC_KEY.value().trim(), WEBPUSH_PRIVATE_KEY.value().trim());
  const body = JSON.stringify(payload);
  await Promise.all(Object.keys(subs).map(async key => {
    const rec = subs[key];
    if (!rec || !rec.sub || !rec.sub.endpoint) return;
    try {
      await webpush.sendNotification(rec.sub, body, { TTL: 24 * 3600, urgency: 'normal' });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await ref.child(key).remove();
      else logger.warn('push failed', e && e.statusCode);
    }
  }));
}

exports.onSongRequest = onValueCreated(Object.assign({ ref: '/teams/{teamId}/songRequests/{rid}' }, DB_TRIGGER), async event => {
  const r = event.data.val();
  if (!r || r.st !== 'pending') return; // a coach setting a song directly needs no alert
  const { teamId } = event.params;
  const p = await rosterPlayer(teamId, r.pid);
  await sendAll(admin.database().ref(`pushSubs/${teamId}/coach`), {
    title: 'Walk-up song request',
    body: `${playerLabel(p)} asked for "${String(r.title || 'a song').slice(0, 80)}". Tap to approve or decline.`,
    tag: 'walkup-requests',
  });
});

exports.onSongDecision = onValueUpdated(Object.assign({ ref: '/teams/{teamId}/songRequests/{rid}' }, DB_TRIGGER), async event => {
  const before = event.data.before.val() || {}, r = event.data.after.val() || {};
  if (before.st !== 'pending' || (r.st !== 'approved' && r.st !== 'declined')) return;
  const { teamId, rid } = event.params;
  const p = await rosterPlayer(teamId, r.pid);
  const title = String(r.title || 'the song').slice(0, 80);
  const ref = admin.database().ref(`pushSubs/${teamId}/req/${rid}`);
  await sendAll(ref, r.st === 'approved'
    ? { title: 'Walk-up song approved', body: `"${title}" is now ${playerLabel(p)}'s walk-up song.`, tag: 'walkup-' + rid }
    : { title: 'Walk-up song not approved', body: `The coach passed on "${title}"${r.note ? ': ' + String(r.note).slice(0, 120) : '.'}`, tag: 'walkup-' + rid });
  await ref.remove(); // one answer per request, so the subscription for it is done
});

/* ---------- Field Time alerts (js/field-schedule.js) ----------
   Same coach subscriptions as the walk-up alerts (pushSubs/{teamId}/coach),
   so a coach who turned alerts on once gets both. Words in field-alerts.js. */
const FieldAlerts = require('./field-alerts');
async function fieldInfo(fieldId) {
  const [teams, field] = await Promise.all([
    admin.database().ref(`fieldSched/teams/${fieldId}`).get(),
    admin.database().ref(`fieldSched/fields/${fieldId}`).get(),
  ]);
  return { teams: teams.val() || {}, field: field.val() || {} };
}
async function sendField(alert) {
  if (!alert) return;
  const to = Array.isArray(alert.to) ? alert.to : [alert.to];
  await Promise.all(to.map(t => sendAll(admin.database().ref(`pushSubs/${t}/coach`), alert.payload)));
}
exports.onFieldRequest = onValueCreated(Object.assign({ ref: '/fieldSched/requests/{fieldId}/{rid}' }, DB_TRIGGER), async event => {
  const { teams, field } = await fieldInfo(event.params.fieldId);
  await sendField(FieldAlerts.requestAlert(event.data.val(), teams, field));
});
exports.onFieldAnswer = onValueUpdated(Object.assign({ ref: '/fieldSched/requests/{fieldId}/{rid}' }, DB_TRIGGER), async event => {
  const { teams, field } = await fieldInfo(event.params.fieldId);
  await sendField(FieldAlerts.answerAlert(event.data.before.val(), event.data.after.val(), teams, field));
});
exports.onFieldOpened = onValueDeleted(Object.assign({ ref: '/fieldSched/slots/{fieldId}/{date}/{time}' }, DB_TRIGGER), async event => {
  const { fieldId, date, time } = event.params;
  const { teams, field } = await fieldInfo(fieldId);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  await sendField(FieldAlerts.openedAlert(`${date}/${time}`, event.data.val(), teams, field, today));
});

/* ---------- one sign-in for coaches: Dashboard teams -> Ballclub access ---------- */
const DashboardSync = require('./dashboard-sync');
const DASHBOARD_PROJECT = 'lybs-dashboard';
let _dashApp = null;
function dashApp() {
  if (!_dashApp) {
    _dashApp = admin.initializeApp({
      projectId: DASHBOARD_PROJECT,
      credential: admin.credential.applicationDefault(),
    }, 'dashboard');
  }
  return _dashApp;
}

exports.dashboardCoachSync = onRequest(
  { region: 'us-central1', cors: ['https://natesteele888.github.io'] },
  DashboardSync.makeHandler({
    verifyToken: t => admin.auth().verifyIdToken(t),
    dashUserByEmail: async email => {
      try {
        const u = await admin.auth(dashApp()).getUserByEmail(email);
        return { uid: u.uid, emailVerified: u.emailVerified === true };
      } catch (e) {
        if (e && e.code === 'auth/user-not-found') return null;
        throw e;
      }
    },
    readApproved: async () => {
      const snap = await admin.firestore(dashApp()).collection('lybs_bins').doc('lybs-approved').get();
      return snap.exists ? snap.data() : null;
    },
    dbGet: async p => (await admin.database().ref(p).get()).val(),
    dbUpdate: updates => admin.database().ref().update(updates),
    log: (...a) => logger.error(...a),
  })
);

