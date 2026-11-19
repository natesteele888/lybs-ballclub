/* ============================================================
   One sign-in for coaches: the LYBS Dashboard decides who coaches
   which team, and Ballclub follows it.

   The Dashboard (Firebase project lybs-dashboard) keeps each staff
   account's teams in Firestore, lybs_bins/lybs-approved:
     uids[<dashboard uid>] = { role, teams: [{year, sport, division, team, role}] }
   Only the league admin can write that document, so it is the real list.
   Ballclub (this project) keeps its own grants at access/{teamId}/{uid}.
   Before this, a board member had to open one link per coach to copy a
   team across (js/board-invite.js). Now a coach just signs in to Ballclub
   with Google and the app asks this function to bring their Dashboard
   teams across.

   How it decides, step by step:
     1. The caller's Ballclub ID token gives their uid and a Google-verified
        email. No verified email, nothing happens.
     2. That email is looked up in the Dashboard's own sign-in accounts
        (not lybs-directory, which anyone signed in can write). The match
        has to be verified there too.
     3. That Dashboard account's teams in lybs-approved, for this year or
        next, are matched to Ballclub teams with the same matchTeam the
        coach link uses (js/board-invite.js), so a team is only ever
        matched by its name, division and sport.
     4. Each match becomes access/{teamId}/{uid} = 'coach'. A Ballclub
        'coach' grant someone already made is left alone. A 'parent' grant
        on that team is raised to coach and put back if the Dashboard later
        drops the team.
     5. What this function granted is remembered at dashboardGrants/{uid}
        (no client can read or write it: the database rules deny anything
        they don't name). A team the Dashboard drops loses only the grant
        this function made. Grants a board member made by hand never move, and
        a grant the board takes away in Ballclub stays away until the
        Dashboard drops that team.
   If any Dashboard read fails, nothing is written, so a hiccup can't take
   access away.

   The Dashboard is a separate project, so this needs read access there.
   No key: give this project's functions service account two read-only
   roles on lybs-dashboard (see the deploy steps in index.js).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// js/team-registry.js and js/board-invite.js are the app's own files.
// firebase.json's predeploy copies them into functions/shared/ (gitignored),
// since only the functions folder is uploaded; locally and in the tests they
// are read straight from js/.
function loadAppFile(name) {
  for (const p of [path.join(__dirname, 'shared', name), path.join(__dirname, '..', 'js', name)]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('Missing app file ' + name);
}

let _app = null;
function appParts() {
  if (_app) return _app;
  const win = {};
  const ctx = vm.createContext({ window: win, console, URLSearchParams });
  vm.runInContext(loadAppFile('team-registry.js'), ctx);
  vm.runInContext(loadAppFile('board-invite.js'), ctx);
  _app = { teams: (win.TEAM_REGISTRY && win.TEAM_REGISTRY.teams) || {}, matchTeam: win.BoardInvite.matchTeam };
  return _app;
}

// Same rule as the Dashboard's _normaliseRole: an approved account has a
// role. Anything else (a pending signup, a blocked one) brings nothing.
const DASH_ROLES = ['coach', 'board', 'director', 'admin'];
function dashRole(v) {
  if (v === true) return 'coach';
  const r = String(v && typeof v === 'object' ? v.role || '' : v || '').toLowerCase();
  return DASH_ROLES.includes(r) ? r : null;
}

// This year's and next year's teams count: in November the new season's
// teams are being set while last season's coaches still finish up. A team
// from two years back is never brought across.
function countedYears(now) {
  const y = new Date(now).getUTCFullYear();
  return [y, y + 1];
}

// The Ballclub team ids an approved Dashboard entry coaches, sorted.
function dashboardTeamIds(entry, registryTeams, matchTeam, now) {
  if (!dashRole(entry) || !entry || typeof entry !== 'object' || !Array.isArray(entry.teams)) return [];
  const years = countedYears(now);
  const ids = new Set();
  for (const t of entry.teams) {
    if (!t || !t.team || !years.includes(Number(t.year))) continue;
    const id = matchTeam(registryTeams, {
      team: String(t.team), division: String(t.division || ''), sport: String(t.sport || ''),
    });
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

// The writes that make Ballclub match the Dashboard for one uid.
//   want    team ids the Dashboard says this person coaches
//   access  { teamId: current access/{teamId}/{uid} value or null }
//   ours    dashboardGrants/{uid}: { teamId: { prev, at } } granted by us,
//           or { held: true, at } where Ballclub took our grant away
// Returns { updates: {path: value}, added: [], removed: [] }.
function planSync(uid, want, access, ours, now) {
  const updates = {};
  const added = [];
  const removed = [];
  ours = ours || {};
  for (const teamId of want) {
    const cur = access[teamId] == null ? null : access[teamId];
    if (ours[teamId]) {
      // Ours already. If someone in Ballclub has since taken the coach
      // grant away (or made it a parent one), that was on purpose: hold
      // the team, so it isn't handed straight back on the next sign-in.
      // The hold ends when the Dashboard drops the team.
      if (!ours[teamId].held && cur !== 'coach') {
        updates[`dashboardGrants/${uid}/${teamId}`] = { held: true, at: now };
      }
      continue;
    }
    if (cur === 'coach') continue; // a grant someone made by hand
    updates[`access/${teamId}/${uid}`] = 'coach';
    updates[`dashboardGrants/${uid}/${teamId}`] = { prev: cur === 'parent' ? 'parent' : null, at: now };
    added.push(teamId);
  }
  for (const teamId of Object.keys(ours)) {
    if (want.includes(teamId)) continue;
    const cur = access[teamId] == null ? null : access[teamId];
    if (!ours[teamId].held && cur === 'coach') {
      updates[`access/${teamId}/${uid}`] = ours[teamId] && ours[teamId].prev === 'parent' ? 'parent' : null;
      removed.push(teamId);
    }
    updates[`dashboardGrants/${uid}/${teamId}`] = null;
  }
  return { updates, added, removed };
}

// The request handler, with every outside call passed in so the tests can
// run it with made-up accounts:
//   verifyToken(idToken) -> decoded Ballclub token
//   dashUserByEmail(email) -> { uid, emailVerified } or null (no account)
//   readApproved() -> lybs-approved data, or null if the document is missing
//   dbGet(path) -> value, dbUpdate(updates)
function makeHandler(deps) {
  return async function dashboardCoachSync(req, res) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    const auth = req.get('Authorization') || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!idToken) { res.status(401).json({ error: 'Missing bearer token' }); return; }

    let me;
    try { me = await deps.verifyToken(idToken); } catch (e) { res.status(401).json({ error: 'Invalid token' }); return; }
    const uid = me && me.uid;
    const email = String((me && me.email) || '').trim().toLowerCase();
    if (!uid || !email || me.email_verified !== true) {
      res.status(200).json({ ok: true, teams: [], added: [], removed: [], note: 'no verified email' });
      return;
    }

    const now = deps.now ? deps.now() : Date.now();
    const { teams, matchTeam } = deps.app || appParts();
    let want, access, ours;
    try {
      const dashUser = await deps.dashUserByEmail(email);
      let entry = null;
      if (dashUser && dashUser.emailVerified === true) {
        const approved = await deps.readApproved();
        if (!approved) throw new Error('lybs-approved missing');
        entry = (approved.uids || {})[dashUser.uid] || null;
      }
      want = dashboardTeamIds(entry, teams, matchTeam, now);
      ours = (await deps.dbGet(`dashboardGrants/${uid}`)) || {};
      const ids = [...new Set([...want, ...Object.keys(ours)])];
      const vals = await Promise.all(ids.map(id => deps.dbGet(`access/${id}/${uid}`)));
      access = {};
      ids.forEach((id, i) => { access[id] = vals[i] == null ? null : vals[i]; });
    } catch (e) {
      deps.log && deps.log('dashboard read failed', e && e.message);
      res.status(503).json({ error: 'Could not read the Dashboard right now' });
      return;
    }

    const plan = planSync(uid, want, access, ours, now);
    if (Object.keys(plan.updates).length) {
      try { await deps.dbUpdate(plan.updates); } catch (e) {
        deps.log && deps.log('grant write failed', e && e.message);
        res.status(503).json({ error: 'Could not save the team access' });
        return;
      }
    }
    res.status(200).json({ ok: true, teams: want, added: plan.added, removed: plan.removed });
  };
}

module.exports = { appParts, dashRole, countedYears, dashboardTeamIds, planSync, makeHandler };
