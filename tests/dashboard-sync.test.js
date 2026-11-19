// Run: node tests/dashboard-sync.test.js
// One sign-in for coaches: functions/dashboard-sync.js brings a coach's
// LYBS Dashboard teams into Ballclub as coach grants. Runs the real handler
// against a fake Dashboard and a fake Ballclub database, with the app's
// real team registry and the coach link's real matchTeam. Made-up emails
// and uids only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../functions/dashboard-sync.js');

const NOW = Date.UTC(2026, 10, 18, 15);
let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; }
}

// A Dashboard with three made-up staff accounts, and an empty Ballclub.
function world(over = {}) {
  const db = Object.assign({}, over.db || {});
  const approved = over.approved !== undefined ? over.approved : {
    uids: {
      'dash-coach': {
        role: 'coach',
        teams: [
          { year: 2027, sport: 'Baseball', division: 'Majors', team: 'Black', role: 'head' },
          { year: 2027, sport: 'Softball', division: '12U', team: 'Black', role: 'head' },  // no softball teams in Ballclub yet
          { year: 2024, sport: 'Baseball', division: 'Rookies', team: 'Blue', role: 'head' }, // too old
        ],
      },
      'dash-two': { role: 'coach', teams: [
        { year: 2026, division: 'Minors', team: 'Minors Blue', role: 'assistant' },
        { year: 2027, sport: 'Baseball', division: 'Rookies', team: 'White', role: 'head' },
      ] },
      'dash-pending': { role: 'nobody', teams: [{ year: 2027, sport: 'Baseball', division: 'Majors', team: 'Blue' }] },
    },
  };
  const dashUsers = Object.assign({
    'coach.one@example.test': { uid: 'dash-coach', emailVerified: true },
    'coach.two@example.test': { uid: 'dash-two', emailVerified: true },
    'unverified@example.test': { uid: 'dash-coach', emailVerified: false },
    'pending@example.test': { uid: 'dash-pending', emailVerified: true },
  }, over.dashUsers || {});
  const tokens = Object.assign({
    'tok-one': { uid: 'bc-one', email: 'Coach.One@example.test', email_verified: true },
    'tok-two': { uid: 'bc-two', email: 'coach.two@example.test', email_verified: true },
    'tok-unverified-here': { uid: 'bc-x', email: 'coach.one@example.test', email_verified: false },
    'tok-unverified-there': { uid: 'bc-u', email: 'unverified@example.test', email_verified: true },
    'tok-pending': { uid: 'bc-p', email: 'pending@example.test', email_verified: true },
    'tok-stranger': { uid: 'bc-s', email: 'stranger@example.test', email_verified: true },
  }, over.tokens || {});
  const w = { db, updates: [] };
  w.handler = S.makeHandler({
    now: () => over.now || NOW,
    verifyToken: async tok => { if (!tokens[tok]) throw new Error('bad'); return tokens[tok]; },
    dashUserByEmail: async email => {
      if (over.dashDown) throw new Error('down');
      return dashUsers[email] || null;
    },
    readApproved: async () => approved,
    dbGet: async p => {
      const parts = p.split('/');
      let v = db;
      for (const k of parts) { v = v && typeof v === 'object' ? v[k] : undefined; }
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    },
    dbUpdate: async u => {
      w.updates.push(u);
      for (const [p, val] of Object.entries(u)) {
        const parts = p.split('/');
        let o = db;
        for (const k of parts.slice(0, -1)) { o[k] = o[k] || {}; o = o[k]; }
        if (val === null) delete o[parts[parts.length - 1]];
        else o[parts[parts.length - 1]] = val;
      }
    },
  });
  w.call = async (token, method = 'POST') => {
    const out = {};
    await w.handler(
      { method, get: h => (h === 'Authorization' && token ? 'Bearer ' + token : '') },
      { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } },
    );
    return out;
  };
  w.access = (team, uid) => (db.access && db.access[team] && db.access[team][uid]) || null;
  return w;
}

(async () => {
  console.log('dashboard-sync');

  await t('a Dashboard coach gets their Ballclub team as coach, and only that one', async () => {
    const w = world();
    const r = await w.call('tok-one');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.teams, ['majors-black']);
    assert.deepStrictEqual(r.body.added, ['majors-black']);
    assert.strictEqual(w.access('majors-black', 'bc-one'), 'coach');
    assert.deepStrictEqual(Object.keys(w.db.access), ['majors-black']);
    assert.deepStrictEqual(w.db.dashboardGrants['bc-one']['majors-black'], { prev: null, at: NOW });
  });

  await t('a team named with its division and no sport still matches; old years never do', async () => {
    const w = world();
    const r = await w.call('tok-two');
    assert.deepStrictEqual(r.body.teams, ['minors-blue', 'rookies-white']);
    assert.strictEqual(w.access('minors-blue', 'bc-two'), 'coach');
    assert.strictEqual(w.access('rookies-white', 'bc-two'), 'coach');
  });

  await t('signing in again changes nothing', async () => {
    const w = world();
    await w.call('tok-one');
    const n = w.updates.length;
    const r = await w.call('tok-one');
    assert.deepStrictEqual(r.body.added, []);
    assert.strictEqual(w.updates.length, n);
  });

  await t('nothing for an unverified email, a stranger, a pending Dashboard account or one unverified there', async () => {
    for (const tok of ['tok-unverified-here', 'tok-stranger', 'tok-pending', 'tok-unverified-there']) {
      const w = world();
      const r = await w.call(tok);
      assert.strictEqual(r.status, 200, tok);
      assert.deepStrictEqual(r.body.teams, [], tok);
      assert.strictEqual(w.updates.length, 0, tok);
    }
  });

  await t('a grant a board member made by hand is never touched', async () => {
    const w = world({ db: { access: { 'majors-black': { 'bc-one': 'coach' } } } });
    const r = await w.call('tok-one');
    assert.deepStrictEqual(r.body.added, []);
    assert.strictEqual(w.updates.length, 0);
    // The Dashboard drops the team: the hand-made grant stays.
    const w2 = world({ db: { access: { 'majors-black': { 'bc-one': 'coach' } } }, approved: { uids: {} } });
    await w2.call('tok-one');
    assert.strictEqual(w2.access('majors-black', 'bc-one'), 'coach');
  });

  await t('a parent on the team is raised to coach, and put back when the Dashboard drops it', async () => {
    const w = world({ db: { access: { 'majors-black': { 'bc-one': 'parent' } } } });
    await w.call('tok-one');
    assert.strictEqual(w.access('majors-black', 'bc-one'), 'coach');
    assert.strictEqual(w.db.dashboardGrants['bc-one']['majors-black'].prev, 'parent');
    const w2 = world({ db: w.db, approved: { uids: {} } });
    const r = await w2.call('tok-one');
    assert.deepStrictEqual(r.body.removed, ['majors-black']);
    assert.strictEqual(w2.access('majors-black', 'bc-one'), 'parent');
    assert.ok(!w2.db.dashboardGrants['bc-one'] || !w2.db.dashboardGrants['bc-one']['majors-black']);
  });

  await t('when the Dashboard drops a team, only the grant this made goes', async () => {
    const w = world();
    await w.call('tok-one');
    const later = world({
      db: w.db,
      approved: { uids: { 'dash-coach': { role: 'coach', teams: [{ year: 2027, sport: 'Baseball', division: 'Majors', team: 'Blue' }] } } },
    });
    const r = await later.call('tok-one');
    assert.deepStrictEqual(r.body.added, ['majors-blue']);
    assert.deepStrictEqual(r.body.removed, ['majors-black']);
    assert.strictEqual(later.access('majors-black', 'bc-one'), null);
    assert.strictEqual(later.access('majors-blue', 'bc-one'), 'coach');
  });

  await t('a grant the board takes away in Ballclub is not handed straight back', async () => {
    const w = world();
    await w.call('tok-one');
    delete w.db.access['majors-black']['bc-one']; // the board removes the coach in Ballclub
    const again = world({ db: w.db });
    let r = await again.call('tok-one');
    assert.deepStrictEqual(r.body.added, []);
    assert.strictEqual(again.access('majors-black', 'bc-one'), null);
    assert.strictEqual(again.db.dashboardGrants['bc-one']['majors-black'].held, true);
    r = await world({ db: again.db }).call('tok-one');
    assert.strictEqual(again.access('majors-black', 'bc-one'), null);
    // Once the Dashboard drops the team the hold ends, and a later
    // assignment grants it again.
    await world({ db: again.db, approved: { uids: {} } }).call('tok-one');
    assert.deepStrictEqual(Object.keys(again.db.dashboardGrants['bc-one'] || {}), []);
    const back = world({ db: again.db });
    r = await back.call('tok-one');
    assert.deepStrictEqual(r.body.added, ['majors-black']);
  });

  await t('a Dashboard that cannot be read writes nothing and takes nothing away', async () => {
    const w = world();
    await w.call('tok-one');
    const n = w.updates.length;
    const down = world({ db: w.db, dashDown: true });
    const r = await down.call('tok-one');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(down.updates.length, 0);
    assert.strictEqual(down.access('majors-black', 'bc-one'), 'coach');
    const missing = world({ db: w.db, approved: null });
    assert.strictEqual((await missing.call('tok-one')).status, 503);
    assert.strictEqual(missing.access('majors-black', 'bc-one'), 'coach');
    assert.strictEqual(w.updates.length, n);
  });

  await t('GET, no token and a bad token are refused', async () => {
    const w = world();
    assert.strictEqual((await w.call('tok-one', 'GET')).status, 405);
    assert.strictEqual((await w.call('')).status, 401);
    assert.strictEqual((await w.call('forged')).status, 401);
    assert.strictEqual(w.updates.length, 0);
  });

  await t('next year counts in November, two years back never does', async () => {
    assert.deepStrictEqual(S.countedYears(NOW), [2026, 2027]);
    const { teams, matchTeam } = S.appParts();
    const entry = { role: 'coach', teams: [{ year: 2025, sport: 'Baseball', division: 'Majors', team: 'Black' }] };
    assert.deepStrictEqual(S.dashboardTeamIds(entry, teams, matchTeam, NOW), []);
    assert.deepStrictEqual(S.dashboardTeamIds(true, teams, matchTeam, NOW), []);
  });

  // The app side: js/access-control.js asks the function on sign-in.
  const AC = fs.readFileSync(path.join(__dirname, '../js/access-control.js'), 'utf8');
  function acPage(store, fetchImpl) {
    const win = {
      localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
      googleAuth: { onReady() {}, currentUser: () => null },
    };
    const ctx = vm.createContext({
      window: win, localStorage: win.localStorage, fetch: fetchImpl, AbortController, setTimeout, clearTimeout,
      navigator: { onLine: true }, document: { getElementById: () => null }, console,
    });
    vm.runInContext(AC, ctx);
    return win.AccessControl;
  }

  await t('the app asks on a first sign-in, then not again for 30 minutes once it has a team', async () => {
    const store = {};
    const calls = [];
    const ac = acPage(store, async (url, opts) => {
      calls.push([url, opts.headers.Authorization]);
      return { ok: true, json: async () => ({ ok: true, teams: ['majors-black'] }) };
    });
    const r = await ac.syncFromDashboard('bc-one', 'tok-one');
    assert.deepStrictEqual(r.teams, ['majors-black']);
    assert.strictEqual(calls[0][0], 'https://us-central1-lybs-ballclub.cloudfunctions.net/dashboardCoachSync');
    assert.strictEqual(calls[0][1], 'Bearer tok-one');
    // No team on this phone yet: asks again.
    await ac.syncFromDashboard('bc-one', 'tok-one');
    assert.strictEqual(calls.length, 2);
    store.lybsGoogleLastEntry = JSON.stringify({ uid: 'bc-one', teamId: 'majors-black', role: 'coach', teams: [{ teamId: 'majors-black', role: 'coach' }] });
    await ac.syncFromDashboard('bc-one', 'tok-one');
    assert.strictEqual(calls.length, 2);
    // Another account on the same phone is asked for.
    await ac.syncFromDashboard('bc-two', 'tok-two');
    assert.strictEqual(calls.length, 3);
  });

  await t('a failed or missing function never stops sign-in', async () => {
    const ac = acPage({}, async () => { throw new TypeError('Failed to fetch'); });
    assert.strictEqual(await ac.syncFromDashboard('bc-one', 'tok-one'), null);
    const ac2 = acPage({}, async () => ({ ok: false, status: 404, json: async () => ({}) }));
    assert.strictEqual(await ac2.syncFromDashboard('bc-one', 'tok-one'), null);
  });

  await t('sign-in asks the Dashboard before redeeming invites and entering', async () => {
    const i = AC.indexOf('await syncFromDashboard(user.uid, token);');
    assert.ok(i > 0 && i < AC.indexOf('await redeemInvites(user.uid, user.email, token);'));
  });

  await t('the deployed function gets the app files, and the copy is never committed', async () => {
    const fb = JSON.parse(fs.readFileSync(path.join(__dirname, '../firebase.json'), 'utf8'));
    const pre = fb.functions[0].predeploy.join(' ');
    assert.ok(pre.includes('js/team-registry.js') && pre.includes('js/board-invite.js') && pre.includes('shared'));
    assert.ok(/^functions\/shared\/$/m.test(fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8')));
    const idx = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
    assert.ok(idx.includes("exports.dashboardCoachSync"));
    assert.ok(!/private_key|BEGIN .*KEY/.test(idx));
  });

  console.log(pass + ' passed');
})();
