// Run: node tests/field-schedule.test.js
// Loads the real js/field-schedule.js and functions/field-alerts.js and
// checks the booking logic: which blocks a date has, the practice limit,
// that a taken block can't be booked, and that saying yes to a swap moves
// both blocks (and refuses once either block has changed). Made-up teams.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// values made inside the vm are a different realm's arrays and objects
const deq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);

const win = { escapeHtml: s => String(s), uid: p => p + Math.random().toString(36).slice(2), todayIso: () => '2099-04-01' };
win.window = win;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/field-schedule.js'), 'utf8'), vm.createContext(Object.assign(win, { console, Date, Promise })));
const FS = win.FieldSchedule, T = FS._test;

// dates
assert.strictEqual(T.mondayOf('2099-04-09'), '2099-04-06', 'Thursday rolls back to Monday');
assert.strictEqual(T.mondayOf('2099-04-12'), '2099-04-06', 'Sunday belongs to the week before');
assert.strictEqual(T.mondayOf('2099-04-06'), '2099-04-06');
deq(T.weekDates('2099-04-06').slice(0, 2), ['2099-04-06', '2099-04-07']);
assert.strictEqual(T.addDays('2099-02-28', 1), '2099-03-01');
assert.strictEqual(T.fmtTime('1730'), '5:30 PM');
assert.strictEqual(T.fmtTime('0900'), '9:00 AM');
assert.strictEqual(T.fmtTime('1200'), '12:00 PM');
assert.strictEqual(T.toHHMM('17:30'), '1730');
assert.strictEqual(T.slug(' 10U Blue! '), '10u-blue');

// blocks: season, blackouts, weekday
const settings = T.mergeSettings({ seasonStart: '2099-04-06', seasonEnd: '2099-06-20', practicesPerWeek: 2, blackouts: ['2099-05-29'], blocks: { 1: [{ start: '1900', end: '2030' }, { start: '1730', end: '1900' }], 6: [{ start: '0900', end: '1030' }] } });
deq(T.blocksFor(settings, '2099-04-06').map(b => b.start), ['1730', '1900'], 'Monday blocks, earliest first');
deq(T.blocksFor(settings, '2099-04-07'), [], 'a saved settings with no Tuesday blocks has none (not the starter ones)');
deq(T.blocksFor(settings, '2099-04-05'), [], 'before the season');
deq(T.blocksFor(settings, '2099-06-22'), [], 'after the season');
deq(T.blocksFor(settings, '2099-05-29'), [], 'blacked out');
assert.strictEqual(T.blocksFor(settings, '2099-05-29', true).length, 0, 'blackout Friday has no blocks anyway');
assert.ok(FS.DEFAULT_SETTINGS.placeholder, 'the starter settings say they are placeholders');
assert.strictEqual(settings.placeholder, false, 'settings the board saved are not placeholders');
assert.strictEqual(T.mergeSettings(null).placeholder, true, 'no saved settings means placeholders');
assert.ok(FS.DEFAULT_FIELDS['fitz-softball'].live, 'Fitzgerald Softball ships on');
assert.strictEqual(Object.values(FS.DEFAULT_FIELDS).filter(f => f.live).length, 1, 'every other field ships off');

// booking checks
const teams = { a: { name: 'Team A' }, b: { name: 'Team B' } };
const state = {
  settings, teams,
  slots: { '2099-04-06': { 1730: { team: 'a', kind: 'practice' } }, '2099-04-13': { 1730: { team: 'a', kind: 'practice' }, 1900: { team: 'a', kind: 'practice' } } },
  requests: {}, log: {},
};
assert.strictEqual(T.canBook(state, 'b', '2099-04-06/1730', 'practice', '2099-04-01').ok, false, 'a taken block is refused');
assert.match(T.canBook(state, 'b', '2099-04-06/1730', 'practice', '2099-04-01').why, /Team A already has it/);
assert.strictEqual(T.canBook(state, 'b', '2099-04-06/1900', 'practice', '2099-04-01').ok, true);
assert.strictEqual(T.canBook(state, 'b', '2099-04-06/1800', 'practice', '2099-04-01').ok, false, 'not a block time');
assert.strictEqual(T.canBook(state, 'b', '2099-04-06/1900', 'practice', '2099-04-07').ok, false, 'in the past');
assert.strictEqual(T.canBook(state, 'zz', '2099-04-06/1900', 'practice', '2099-04-01').ok, false, 'team not on the field');
assert.strictEqual(T.practiceCount(state.slots, 'a', '2099-04-13'), 2);
assert.strictEqual(T.canBook(state, 'a', '2099-04-18/0900', 'practice', '2099-04-01').ok, false, 'third practice that week is over the limit');
assert.strictEqual(T.canBook(state, 'a', '2099-04-18/0900', 'game', '2099-04-01').ok, true, 'a game does not count toward the limit');

// accepting a swap
const swap = { from: 'b', to: 'a', want: '2099-04-06/1730', give: '2099-04-13/1900', st: 'pending' };
const s2 = JSON.parse(JSON.stringify(state));
s2.slots['2099-04-13']['1900'] = { team: 'b', kind: 'game', opp: 'Townsend' };
const res = T.acceptUpdates(s2, 'fitz-softball', 'r1', swap, 'Coach A', 5, ['n1', 'l1']);
assert.ok(res.updates, res.error);
const u = res.updates;
deq(u['fieldSched/slots/fitz-softball/2099-04-06/1730'], { team: 'b', kind: 'practice', req: 'r1', at: 5, by: 'Coach A' });
deq(u['fieldSched/slots/fitz-softball/2099-04-13/1900'], { team: 'a', kind: 'game', opp: 'Townsend', req: 'r1', at: 5, by: 'Coach A' });
assert.strictEqual(u['fieldSched/requests/fitz-softball/r1/st'], 'accepted');
assert.strictEqual(u['fieldSched/inbox/b/n1'].from, 'a', 'the message is signed by the team that answered');
assert.match(u['fieldSched/log/fitz-softball/l1'].text, /Team A swapped Mon Apr 6, 5:30 PM.7:00 PM for Mon Apr 13, 7:00 PM.8:30 PM with Team B/);
// a block that changed since the request
const s3 = JSON.parse(JSON.stringify(s2));
s3.slots['2099-04-13']['1900'].team = 'a';
assert.ok(T.acceptUpdates(s3, 'fitz-softball', 'r1', swap, '', 5, ['n', 'l']).error, 'offered block no longer theirs');
const s4 = JSON.parse(JSON.stringify(s2));
delete s4.slots['2099-04-06']['1730'];
assert.ok(T.acceptUpdates(s4, 'fitz-softball', 'r1', swap, '', 5, ['n', 'l']).error, 'wanted block gone');
// a plain "can we have it" moves only one block
const give = T.acceptUpdates(state, 'fitz-softball', 'r2', { from: 'b', to: 'a', want: '2099-04-06/1730', st: 'pending' }, '', 5, ['n', 'l']);
assert.strictEqual(Object.keys(give.updates).filter(k => k.includes('/slots/')).length, 1);

// RTDB hands back a saved block list as an object sometimes
const m = T.mergeSettings({ blocks: { 1: { 0: { start: '1730', end: '1900' } } } });
deq(m.blocks[1], [{ start: '1730', end: '1900' }]);

// alert wording
const A = require(path.join(__dirname, '../functions/field-alerts.js'));
const field = { name: 'Fitzgerald Softball' };
assert.strictEqual(A.when('2099-04-06/1730'), 'Mon Apr 6, 5:30 PM');
assert.strictEqual(A.requestAlert(swap, teams, field).to, 'a');
assert.match(A.requestAlert(swap, teams, field).payload.body, /^Team B wants to swap their Mon Apr 13, 7:00 PM for your Mon Apr 6, 5:30 PM at Fitzgerald Softball/);
assert.strictEqual(A.requestAlert(Object.assign({}, swap, { st: 'accepted' }), teams, field), null);
assert.strictEqual(A.answerAlert(swap, Object.assign({}, swap, { st: 'accepted' }), teams, field).to, 'b');
assert.strictEqual(A.answerAlert(swap, Object.assign({}, swap, { st: 'cancelled' }), teams, field), null, 'a withdrawn request sends nothing');
deq(A.openedAlert('2099-04-06/1730', { team: 'a' }, teams, field, '2099-04-01').to, ['b'], 'everyone but the team that gave it up');
assert.strictEqual(A.openedAlert('2099-04-06/1730', { team: 'a' }, teams, field, '2099-04-07'), null, 'nothing for a date that passed');

console.log('field-schedule: all checks passed');
