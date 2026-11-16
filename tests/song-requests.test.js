// Run: node tests/song-requests.test.js
// Loads the real js/song-requests.js into a bare fake page and checks the
// pieces that decide what a family and a coach see: the start time a family
// types, which links are accepted, where each player stands, the coach's
// queue, what an approval writes, and that the new database paths have rules
// (a path with no rule fails only once it's live -- see js/backend.js).
// Fake players and songs only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../js/song-requests.js'), 'utf8');
const win = {
  escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  teamPath: (t, k) => `teams/${t}/${k}`,
  FIREBASE_DB_URL: 'MOCK',
};
const store = {};
win.dbGet = async p => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), store) ?? null;
const ctx = { window: win, URL, location: { origin: 'https://example.test', pathname: '/lybs-ballclub/index.html' }, navigator: { userAgent: 'node' }, console };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const SR = win.SongRequests, T = SR._test;
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('PASS ', name); };

(async () => {
  await test('start times: 1:05, 65 and blank work; anything else is refused', () => {
    assert.strictEqual(T.parseClock('1:05'), 65);
    assert.strictEqual(T.parseClock('0:15'), 15);
    assert.strictEqual(T.parseClock('65'), 65);
    assert.strictEqual(T.parseClock(''), 0);
    assert.strictEqual(T.parseClock('1:75'), null);
    assert.strictEqual(T.parseClock('abc'), null);
    assert.strictEqual(T.fmtClock(65), '1:05');
    assert.strictEqual(T.fmtClock(-3), '0:00');
  });

  await test('links: only web links, and not too long', () => {
    assert.ok(T.cleanLink('https://music.example.test/track/1'));
    assert.strictEqual(T.cleanLink('javascript:alert(1)'), null);
    assert.strictEqual(T.cleanLink('not a link'), null);
    assert.strictEqual(T.cleanLink('https://x.test/' + 'a'.repeat(600)), null);
    assert.strictEqual(T.cleanTitle('  Artist   -  Song  '), 'Artist - Song');
  });

  const reqs = {
    a: { pid: 'p1', title: 'Old', st: 'approved', at: '2026-11-01T00:00:00Z' },
    b: { pid: 'p1', title: 'New', st: 'pending', at: '2026-11-10T00:00:00Z' },
    c: { pid: 'p2', title: 'Nope', st: 'declined', note: 'Clean version please', at: '2026-11-09T00:00:00Z', decidedAt: '2026-11-09T01:00:00Z' },
    d: { pid: 'p3', title: 'First', st: 'pending', at: '2026-11-08T00:00:00Z' },
  };
  await test('each player shows their newest request; the queue is pending only, oldest first', () => {
    const l = T.latestByPlayer(reqs);
    assert.strictEqual(l.p1.rid, 'b');
    assert.strictEqual(l.p2.st, 'declined');
    assert.strictEqual(T.pendingList(reqs).map(r => r.rid).join(), 'd,b');
  });

  await test('an approval becomes the player\'s song, from the right source only', () => {
    const s = T.approvedSong({ rid: 'b', kind: 'library', lib: 'lib1', link: 'https://x.test', title: 'New', start: 12 });
    assert.strictEqual(s.lib, 'lib1'); assert.strictEqual(s.link, undefined); assert.strictEqual(s.start, 12); assert.strictEqual(s.rid, 'b');
    assert.strictEqual(T.approvedSong({ kind: 'upload', file: 'sf1', title: 'X' }).file, 'sf1');
    assert.strictEqual(T.playerLabel({ name: 'Sam T', number: '12' }), '#12 Sam');
    assert.strictEqual(T.playerLabel({ name: '' }), 'A player');
  });

  await test('the roster: waiting, not approved with the note, or the approved song; always a request button', async () => {
    store.teams = { t1: { songRequests: reqs, walkupSongs: { p1: { title: 'Old', at: '2026-11-01T00:00:00Z' } } } };
    await SR.ensureLoaded('t1');
    assert.match(SR.cellHtml('t1', { id: 'p1', name: 'Sam T', number: '12' }), /Waiting on coach/);
    assert.match(SR.cellHtml('t1', { id: 'p2', name: 'Lee R' }), /Not approved: Clean version please/);
    const none = SR.cellHtml('t1', { id: 'p9', name: 'Pat <b>' });
    assert.match(none, /Request walk-up song/);
    assert.doesNotMatch(none, /<b>/, 'names are escaped');
    store.teams.t1.songRequests = { a: reqs.a };
    await SR.reload('t1');
    assert.match(SR.cellHtml('t1', { id: 'p1', name: 'Sam T' }), /srChip ok">Old/);
  });

  await test('the coach\'s queue: a count, each request with Approve and Decline, and the share link', async () => {
    store.teams.t1.songRequests = reqs; await SR.reload('t1');
    const players = [{ id: 'p1', name: 'Sam T', number: '12' }, { id: 'p3', name: 'Ari K', number: '3' }];
    const h = SR.panelHtml('t1', players, { isBoard: false });
    assert.match(h, /srBadge">2</);
    assert.strictEqual((h.match(/data-sr-do="ok"/g) || []).length, 2);
    assert.match(h, /#3 Ari<\/b>: First/);
    assert.match(h, /data-link="https:\/\/example\.test\/lybs-ballclub\/#walkup-songs"/);
    assert.doesNotMatch(h, /League song library/, 'library button is for board members');
    assert.match(SR.panelHtml('t1', players, { isBoard: true }), /League song library/);
  });

  await test('every new path has a rule, and the public view can\'t read songs', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8')).rules;
    const team = rules.teams.$teamId;
    assert.ok(team.songRequests.$rid['.write'].includes("newData.child('st').val() == 'pending'"), 'a family can only add a pending request');
    assert.ok(!team.walkupSongs['.write'].includes('player-'), 'only a coach sets the song');
    assert.ok(rules.songFiles.$teamId['.read'].startsWith('auth != null'));
    assert.ok(rules.walkupLibrary['.read'].includes("auth.provider != 'anonymous'"));
    assert.ok(rules.walkupLibraryFiles['.read'].includes("auth.provider != 'anonymous'"));
    assert.ok(rules.walkupLibrary.$id['.write'].includes('boardMembers'));
    assert.strictEqual(rules.pushSubs['.read'], undefined, 'alert subscriptions are never readable by the app');
    assert.ok(Number(/<= (\d+)/.exec(rules.songFiles.$teamId.$fid.size['.validate'])[1]) >= SR.MAX_FILE, 'the size rule allows the app\'s own cap');
    const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
    assert.ok(sw.includes("'./js/song-requests.js'"), 'the new file works offline');
    assert.ok(/addEventListener\('push'/.test(sw) && /notificationclick/.test(sw), 'the service worker shows alerts');
  });

  console.log(`${n}/${n} passed`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
