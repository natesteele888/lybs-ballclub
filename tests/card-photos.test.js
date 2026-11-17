// Run: node tests/card-photos.test.js
// Loads the real js/card-photos.js into a bare fake page and checks who gets
// the Card photo button, what goes to the review queue (and what never does),
// how the row reads after sending, and that the database rules keep approved
// card photos to the team and the board. Also run by
// .github/workflows/database-rules.yml before the rules go live.
// The full read/write behaviour is checked against the real emulator by
// tests/card-photo-rules.emulator.mjs. Made-up players only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../js/card-photos.js'), 'utf8');
const win = {
  escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  teamPath: (t, k) => `teams/${t}/${k}`,
  dbGet: async () => ({ p2: { st: 'approved', at: '2026-11-16T10:00:00Z' } }),
};
const ls = {};
const ctx = { window: win, localStorage: { getItem: k => ls[k] || null, setItem: (k, v) => { ls[k] = v; } }, console };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const CP = win.CardPhotos, T = CP._test;
const kid = { id: 'p1', name: 'Sam P', number: '7', email: 'Family@Example.com' };
const other = { id: 'p2', name: 'Alex R', number: '12', email: 'someone@example.com' };
const noEmail = { id: 'p3', name: 'Jo K', number: '3' };

(async () => {
  // who sees the button
  assert.ok(T.canSendFor(kid, { isCoach: true }), 'coach: every row');
  assert.ok(T.canSendFor(noEmail, { isCoach: true }), 'coach: even with no parent email');
  assert.ok(T.canSendFor(kid, { email: ' family@example.com' }), 'parent: own kid, any case');
  assert.ok(!T.canSendFor(other, { email: 'family@example.com' }), 'parent: not another kid');
  assert.ok(!T.canSendFor(noEmail, { email: 'family@example.com' }), 'parent: not a kid with no email on file');
  assert.ok(!T.canSendFor(kid, { email: '' }), 'no email (shared player code): no button');
  assert.ok(!T.canSendFor(kid, null));
  assert.ok(!T.canSendFor({ name: 'new' }, { isCoach: true }), 'unsaved player has no id yet');

  // what is sent
  const body = T.payload({ token: 'tok', photo: 'data:image/jpeg;base64,AA', teamId: 'team-x', player: kid, team: 'Sample Team', division: 'Minors', byName: 'Coach Pat' });
  assert.strictEqual(body.kind, 'card');
  assert.strictEqual(body.teamId, 'team-x');
  assert.strictEqual(body.playerId, 'p1');
  assert.strictEqual(body.player, 'Sam P');
  assert.strictEqual(body.token, 'tok');
  assert.strictEqual(body.teamName, 'Sample Team');
  assert.ok(!('team' in body), 'no team field, so an older queue refuses it instead of filing it as a social photo');
  assert.ok(!JSON.stringify(body).toLowerCase().includes('example.com'), 'the parent email never leaves the phone');
  assert.ok(!('email' in body));

  // the row after sending
  assert.strictEqual(T.stateFor(null, null), '');
  assert.strictEqual(T.stateFor(null, '2026-11-16T09:00:00Z'), 'sent');
  assert.strictEqual(T.stateFor({ st: 'approved', at: '2026-11-16T10:00:00Z' }, '2026-11-16T09:00:00Z'), 'approved');
  assert.strictEqual(T.stateFor({ st: 'approved', at: '2026-11-16T08:00:00Z' }, '2026-11-16T09:00:00Z'), 'sent', 'a newer photo is waiting');
  assert.strictEqual(T.stateFor({ st: 'declined', at: '2026-11-16T10:00:00Z' }, '2026-11-16T09:00:00Z'), 'declined');
  await CP.ensureLoaded('team-x');
  assert.ok(CP.cellHtml('team-x', other, { isCoach: true }).includes('Card photo approved'));
  assert.strictEqual(CP.cellHtml('team-x', other, { email: 'family@example.com' }), '', 'no button on another kid');
  assert.ok(!CP.cellHtml('team-x', kid, { isCoach: true }).includes('example.com'), 'cell never shows the email');

  // seeing the card: only once approved, and the card's words carry no email
  assert.ok(CP.cellHtml('team-x', other, { isCoach: true }).includes('data-card-see="p2"'), 'See card once approved');
  assert.ok(!CP.cellHtml('team-x', kid, { isCoach: true }).includes('data-card-see'), 'no See card before approval');
  const fakeKit = { cardData: (pl, tm, st) => ({ pl, tm, st }) };
  const cd = T.cardFor(Object.assign({ position: 'SS', batsThrows: 'R/R' }, kid), { name: 'Sample Team', macLeagueDivisionName: 'Majors' }, fakeKit, 2027);
  assert.ok(!JSON.stringify(cd).includes('xample.com'), 'parent email never reaches the card');
  assert.strictEqual(JSON.stringify(cd.pl), JSON.stringify({ name: 'Sam P', number: '7', position: 'SS', batsThrows: 'R/R' }));
  assert.strictEqual(JSON.stringify(cd.tm), JSON.stringify({ name: 'Sample Team', division: 'Majors' }));
  assert.strictEqual(cd.st.season, '2027');
  // the Card Maker sits next to this app on the same github.io site
  assert.strictEqual(new URL(T.KIT_BASE, 'https://example.github.io/lybs-ballclub/index.html').pathname, '/lybs-cards/card-kit/');
  const kitDir = path.join(__dirname, '../../lybs-cards/card-kit');
  if (fs.existsSync(kitDir)) {
    ['card-kit.js', 'steele-card.js', 'layers'].forEach(f => assert.ok(fs.existsSync(path.join(kitDir, f)), 'lybs-cards has card-kit/' + f));
  }

  // rules: team + board read, only the board (or the queue's own key) writes
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8')).rules;
  const cp = rules.cardPhotos.$teamId;
  assert.ok(cp['.read'].includes("child('access').child($teamId).child(auth.uid).exists()"));
  assert.ok(cp['.read'].includes("boardMembers"));
  assert.ok(!cp['.read'].includes("'player-'"), 'not the shared player code');
  assert.ok(!cp['.read'].includes('fieldKiosks'), 'not field tablets');
  assert.ok(cp.$pid['.write'].startsWith('auth != null && (root.child(\'boardMembers\')'), 'board writes');
  assert.ok(cp.$pid['.write'].includes('!newData.exists()'), 'coaches may only take one down');
  assert.strictEqual(cp.$pid.$other['.validate'], false);
  assert.ok(cp.$pid.type['.validate'].includes('jpeg|png|webp'));
  assert.deepStrictEqual(rules.teams.$teamId.cardPhotoStatus, { '.write': false });
  console.log('card photos: ok');
})().catch(e => { console.error(e); process.exit(1); });
