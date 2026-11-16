// Run: node tests/field-kiosk-rules.test.js
// Checks database.rules.json for the field tablet (walk-up kiosk) grants:
// an approved tablet may READ only the game-day paths, never write team data,
// never read coach-only or access records; only the board lets a tablet in;
// coaches (not players) set walk-up songs. Also run by
// .github/workflows/database-rules.yml before the rules go live.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8')).rules;

const KIOSK = "auth != null && root.child('fieldKiosks').child(auth.uid).child('ok').val() == true";
const BOARD = "auth != null && root.child('boardMembers').child(auth.uid).val() == true";
const team = rules.teams.$teamId;
const GAME_DAY = ['roster', 'lineups', 'schedule', 'gcTeamId', 'gameChangerSchedule', 'walkupSongs'];

// every place the kiosk grant appears, by path
const hits = [];
(function walk(node, at) {
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === 'string' && v.includes("child('fieldKiosks')")) hits.push(at.concat(k).join('/'));
    else walk(v, at.concat(k));
  }
})(rules, []);
const want = GAME_DAY.map(k => `teams/$teamId/${k}/.read`).sort();
assert.deepStrictEqual(hits.sort(), want, 'field tablets read exactly the game-day paths, nothing else');
for (const k of GAME_DAY) assert.strictEqual(team[k]['.read'], KIOSK, `${k} kiosk read is the approved-tablet check`);

// the team-wide read is unchanged and does not mention tablets
assert.ok(!team['.read'].includes('fieldKiosks'));
assert.ok(!JSON.stringify(rules.coachPrivate).includes('fieldKiosks'));
assert.ok(!JSON.stringify(rules.access || {}).includes('fieldKiosks'));

// walk-up songs: coaches write (same rule as lineups), players don't
assert.strictEqual(team.walkupSongs['.write'], team.lineups['.write']);
assert.ok(!team.walkupSongs['.write'].includes("'player-'"));
const ws = team.walkupSongs.$playerId;
assert.ok(ws.song && ws.start && ws.at && ws.$other && ws.$other['.validate'] === false, 'walk-up song keeps only song, start, at');

// letting a tablet in is board-only; a tablet can only ask for itself
assert.strictEqual(rules.fieldKiosks['.read'], BOARD);
assert.strictEqual(rules.fieldKiosks.$uid['.write'], BOARD);
assert.strictEqual(rules.fieldKiosks.$uid['.read'], 'auth != null && auth.uid == $uid');
assert.ok(rules.fieldKiosks.$uid.ok['.validate'].includes('isBoolean'));
assert.strictEqual(rules.fieldKioskRequests['.read'], BOARD);
assert.ok(rules.fieldKioskRequests.$uid['.write'].includes('auth.uid == $uid'));
assert.strictEqual(rules.fieldKioskRequests.$uid.$other['.validate'], false);

// nothing else at the root opened up
assert.strictEqual(rules['.read'], false);
assert.strictEqual(rules['.write'], false);
console.log('field kiosk rules: ok');
