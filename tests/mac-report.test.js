// Run: node tests/mac-report.test.js
// Checks the MAC League pitch count text: one line per pitcher with uniform
// number, first name and last initial, and total pitches; numbers come from
// the roster only on a unique match; missing numbers are counted. Fake names.
const assert = require('assert');
const { build } = require('../js/mac-report.js');

const roster = [
  { name: 'Alex Tester', number: '7' },
  { name: 'Blake Rivers', number: '' },
  { name: 'Sam Tee', number: '3' }, { name: 'Sam Toe', number: '4' },
];
const r = build({
  teamName: 'Lunenburg Majors Black', opponent: 'Sample Town', date: '2027-04-10',
  pitchCounts: [{ name: 'Alex T', pitches: 42 }, { name: 'Blake Rivers', pitches: 17 }, { name: 'Sam T', pitches: 5 }, { name: 'Bad', pitches: 'x' }],
  roster,
});
const lines = r.text.split('\n');
assert.equal(lines[0], 'Pitch counts: Lunenburg Majors Black vs Sample Town, Sat, Apr 10, 2027');
assert.deepEqual(lines.slice(1), ['#7 Alex T: 42 pitches', '# ? Blake R: 17 pitches', '# ? Sam T: 5 pitches']);
assert.equal(r.missingNumbers, 2, 'blank number and an ambiguous name both count as missing');
assert.equal(r.count, 3);
assert.equal(build({ pitchCounts: [] }).count, 0);
console.log('mac-report: all checks passed');
