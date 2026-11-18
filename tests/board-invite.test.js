// Run: node tests/board-invite.test.js
// Loads the real js/board-invite.js into a fake page and checks the coach
// link from the Dashboard: a board member who opens it gets one question,
// and on yes the same coach invite the board can already write lands at
// both invite paths; anyone else, a bad link or an unknown team writes
// nothing; the hash is always cleared. Made-up emails and teams only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../js/board-invite.js'), 'utf8');
const TEAMS = {
  select: { name: 'Lunenburg Select (Majors A)', shortName: 'Select', sport: 'Baseball' },
  'majors-black': { name: 'Lunenburg Majors Black', shortName: 'Majors Black', sport: 'Baseball' },
  'rookies-white': { name: 'Lunenburg Rookies White', shortName: 'Rookies White', sport: 'Baseball' },
};

function page(hash, { board = true, answer = true, updateFails = false } = {}) {
  const ctx = { writes: [], toasts: [], asked: [], cleared: false };
  const win = {
    TEAM_REGISTRY: { teams: TEAMS },
    location: { hash, pathname: '/lybs-ballclub/', search: '' },
    history: { replaceState: () => { ctx.cleared = true; win.location.hash = ''; } },
    showToast: t => ctx.toasts.push(t),
    confirmModal: async t => { ctx.asked.push(t); return answer; },
    boardMemberPath: uid => `boardMembers/${uid}`,
    invitePath: (k, t) => `invites/${k}/${t}`,
    inviteByTeamPath: (t, k) => `invitesByTeam/${t}/${k}`,
    dbGet: async (p, token) => { assert.strictEqual(token, 'tok'); return p === 'boardMembers/u1' && board ? true : null; },
    dbUpdate: async (u, token) => { assert.strictEqual(token, 'tok'); if (updateFails) throw new Error('offline'); ctx.writes.push(JSON.parse(JSON.stringify(u))); },
    URLSearchParams,
    console: { log() {}, error() {} },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  ctx.win = win;
  ctx.run = () => win.BoardInvite.handle({ uid: 'u1', email: 'boardie@example.com', name: 'Board Person' }, 'tok');
  return ctx;
}
const link = p => '#coach-invite&' + new URLSearchParams(p).toString();
let n = 0; const t = async (name, f) => { await f(); n++; console.log('ok -', name); };

(async () => {
  const B = page('').win.BoardInvite;
  await t('team names match registry ids', () => {
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Majors Black (B)', division: 'Majors', sport: 'Baseball' }), 'majors-black');
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Black', division: 'Majors', sport: 'Baseball' }), 'majors-black');
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Select', division: 'Majors A', sport: 'Baseball' }), 'select');
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Rookies White', division: 'Rookies', sport: '' }), 'rookies-white');
  });
  await t('a softball team never matches a baseball one', () => {
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Majors Black', division: 'Majors', sport: 'Softball' }), '');
    assert.strictEqual(B.matchTeam(TEAMS, { team: 'Owls', division: 'Minors', sport: 'Baseball' }), '');
  });
  await t('no link, nothing happens', async () => {
    const c = page('#walkup-songs');
    assert.strictEqual(await c.run(), null);
    assert.ok(!c.cleared && !c.writes.length && !c.toasts.length);
  });
  await t('a board member says yes: coach invite at both paths', async () => {
    const c = page(link({ email: 'New.Coach@example.com', team: 'Majors Black (B)', division: 'Majors', sport: 'Baseball' }));
    assert.strictEqual(await c.run(), 'invited');
    assert.ok(c.cleared, 'hash cleared');
    assert.strictEqual(c.asked.length, 1);
    assert.match(c.asked[0], /New\.Coach@example\.com coach access to Majors Black/);
    assert.strictEqual(c.writes.length, 1);
    const w = c.writes[0];
    assert.deepStrictEqual(Object.keys(w).sort(), ['invites/new,coach@example,com/majors-black', 'invitesByTeam/majors-black/new,coach@example,com']);
    for (const v of Object.values(w)) {
      assert.strictEqual(v.role, 'coach'); assert.strictEqual(v.teamId, 'majors-black');
      assert.strictEqual(v.email, 'New.Coach@example.com'); assert.strictEqual(v.invitedByName, 'Board Person');
      assert.strictEqual(typeof v.createdAt, 'number');
    }
  });
  await t('a board member says no: nothing written', async () => {
    const c = page(link({ email: 'x@example.com', team: 'Select' }), { answer: false });
    assert.strictEqual(await c.run(), 'cancelled');
    assert.ok(c.cleared && !c.writes.length);
  });
  await t('not a board member: not asked, nothing written', async () => {
    const c = page(link({ email: 'x@example.com', team: 'Select' }), { board: false });
    assert.strictEqual(await c.run(), 'not-board');
    assert.ok(c.cleared && !c.asked.length && !c.writes.length);
    assert.match(c.toasts[0], /Only a Ballclub board member/);
  });
  await t('unknown team or bad email: nothing written', async () => {
    let c = page(link({ email: 'x@example.com', team: 'Owls', division: 'Minors' }));
    assert.strictEqual(await c.run(), 'no-team'); assert.ok(c.cleared && !c.writes.length && !c.asked.length);
    c = page(link({ email: 'not-an-email', team: 'Select' }));
    assert.strictEqual(await c.run(), 'bad-link'); assert.ok(c.cleared && !c.writes.length);
    c = page('#coach-invite&team=Select');
    assert.strictEqual(await c.run(), 'bad-link');
  });
  await t('a failed save is reported, never thrown', async () => {
    const c = page(link({ email: 'x@example.com', team: 'Select' }), { updateFails: true });
    assert.strictEqual(await c.run(), 'failed');
    assert.match(c.toasts[0], /Couldn't save/);
  });
  await t('access-control.js runs it after entering, and the page loads it first', () => {
    const ac = fs.readFileSync(path.join(__dirname, '../js/access-control.js'), 'utf8');
    assert.ok(/await enter\(user, token\);\s*\n(?:\s*\/\/.*\n)*\s*if \(window\.BoardInvite\) await window\.BoardInvite\.handle\(user, token\);/.test(ac));
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.ok(html.indexOf('js/board-invite.js') > 0 && html.indexOf('js/board-invite.js') < html.indexOf('js/access-control.js?'));
    assert.ok(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8').includes("'./js/board-invite.js'"), 'cached for offline');
  });
  console.log(`\n${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
