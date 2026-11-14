// Run: node tests/pitch-count-import.test.js
// Checks js/pitch-count-import.js against data saved the way Walk-Up's
// walkup/pitch-core.js saves it: pitches, an undo, a pitcher known only from
// an "on the mound" event, older days already added up by name, and a
// different day that must not count. Uses the real walkup/pitch-core.js when
// a copy of natesteele888/apps sits next to this repo, so a change to its
// saved shape fails here. Fake names only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dayTotals } = require('../js/pitch-count-import.js');

const at = (day, h) => new Date(day + 'T' + String(h).padStart(2, '0') + ':00:00').getTime();
const store = data => k => (k in data ? data[k] : null);

// 1. Hand-built log in Walk-Up's shape.
const log = {
  v: 1, division: 'Majors', max: 0, setupAt: 1,
  pitchers: [{ id: 'pAAAA1', name: 'Alex T' }, { id: 'pBBBB2', name: 'Blake R' }],
  events: [
    { i: 'e00001', k: 's', p: 'pAAAA1', n: 'Alex T', t: at('2027-04-10', 10) },
    { i: 'e00002', k: 'p', p: 'pAAAA1', t: at('2027-04-10', 10) },
    { i: 'e00003', k: 'p', p: 'pAAAA1', t: at('2027-04-10', 10) },
    { i: 'e00004', k: 'p', p: 'pAAAA1', t: at('2027-04-10', 11) },
    { i: 'e00005', k: 'u', x: 'e00004', t: at('2027-04-10', 11) },
    { i: 'e00006', k: 's', p: 'pCCCC3', n: 'Casey M', t: at('2027-04-10', 12) },
    { i: 'e00007', k: 'p', p: 'pCCCC3', t: at('2027-04-10', 12) },
    { i: 'e00008', k: 'p', p: 'pBBBB2', t: at('2027-04-11', 10) },
  ],
};
const hist = { '2027-04-07': { 'Blake R': 40 }, '2027-04-10': { 'Dana K': 12 } };
const get = store({ 'walkup.pitch': JSON.stringify(log), 'walkup.pitchHist': JSON.stringify(hist) });

assert.deepStrictEqual(dayTotals(get, '2027-04-10'), [
  { name: 'Alex T', pitches: 2 },
  { name: 'Casey M', pitches: 1 },
  { name: 'Dana K', pitches: 12 },
]);
assert.deepStrictEqual(dayTotals(get, '2027-04-11'), [{ name: 'Blake R', pitches: 1 }]);
assert.deepStrictEqual(dayTotals(get, '2027-04-07'), [{ name: 'Blake R', pitches: 40 }]);
assert.deepStrictEqual(dayTotals(get, '2027-04-12'), []);

// 2. Nothing saved, broken data, or a bad date: no rows, no crash.
assert.deepStrictEqual(dayTotals(store({}), '2027-04-10'), []);
assert.deepStrictEqual(dayTotals(store({ 'walkup.pitch': '{oops', 'walkup.pitchHist': 'null' }), '2027-04-10'), []);
assert.deepStrictEqual(dayTotals(get, 'April 10'), []);
assert.deepStrictEqual(dayTotals(() => { throw new Error('blocked'); }, '2027-04-10'), []);

// 3. The real Walk-Up math, when natesteele888/apps is checked out beside this repo.
const corePath = path.join(__dirname, '../../apps/walkup/pitch-core.js');
if (fs.existsSync(corePath)) {
  const P = require(corePath);
  const real = P.emptyLog();
  real.pitchers = [{ id: 'pEEEE5', name: 'Evan S', limit: 0, club: false }];
  const t0 = at('2027-04-10', 9);
  P.setCurrent(real, 'pEEEE5', 'Evan S', t0);
  for (let n = 0; n < 23; n++) P.addPitch(real, 'pEEEE5', t0 + n);
  P.undo(real, 'pEEEE5', '2027-04-10', t0 + 100);
  const realGet = store({ 'walkup.pitch': JSON.stringify(P.sanitize(real)) });
  const want = P.totals(P.sanitize(real), '2027-04-10');
  assert.deepStrictEqual(want, { 'Evan S': 22 });
  assert.deepStrictEqual(dayTotals(realGet, '2027-04-10'), [{ name: 'Evan S', pitches: 22 }]);
  console.log('checked against the real walkup/pitch-core.js');
}
console.log('pitch-count-import: all checks passed');
