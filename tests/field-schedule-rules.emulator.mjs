// Emulator check for the Field Time rules (fieldSched/ in database.rules.json).
// Needs firebase-tools and @firebase/rules-unit-testing on NODE_PATH, plus Java:
//   NODE_PATH=<node_modules> firebase emulators:exec --only database "node tests/field-schedule-rules.emulator.mjs"
// Proves the promise the scheduler makes: one booking per block, nobody
// takes another team's block without that team's yes, and a request
// can't be replayed. Made-up teams and accounts only.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(process.env.NODE_PATH.split(':')[0] + '/');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, remove } = require('firebase/database');

const env = await initializeTestEnvironment({
  projectId: 'demo-ballclub',
  database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 },
});
const F = 'fitz-softball', A = 'team-a', B = 'team-b', OUT = 'team-out';
const R = 'fieldSched';
const slot = (key) => `${R}/slots/${F}/${key}`;
const D1 = '2099-04-06/1730', D2 = '2099-04-08/1900', D3 = '2099-04-09/1730';
const at = 1;
await env.withSecurityRulesDisabled(async c => {
  const db = c.database();
  await set(ref(db, `${R}/teams/${F}`), { [A]: { name: 'Team A' }, [B]: { name: 'Team B' } });
  await set(ref(db, `access/${A}/coachA`), 'coach');
  await set(ref(db, `access/${A}/parentA`), 'parent');
  await set(ref(db, `access/${B}/coachB`), 'coach');
  await set(ref(db, `access/${OUT}/coachOut`), 'coach');
  await set(ref(db, `boardMembers/boardU`), true);
});
const as = (uid, token) => env.authenticatedContext(uid, token).database();
const coachA = as('coachA'), coachB = as('coachB'), parentA = as('parentA'), outsider = as('coachOut'), board = as('boardU');
const gateA = as('gateA', { email: `coach-${A}-gate@lybsballclub.internal` });
const playerGateA = as('gatePA', { email: `player-${A}-gate@lybsballclub.internal` });
const anon = env.unauthenticatedContext().database();
let n = 0; const ok = async (name, p) => { await p; n++; console.log('PASS ', name); };

// reading
await ok('a coach reads the field', assertSucceeds(get(ref(coachA, `${R}/slots/${F}`))));
await ok('a parent reads the field', assertSucceeds(get(ref(parentA, `${R}/slots/${F}`))));
await ok('signed-out cannot read the field', assertFails(get(ref(anon, `${R}/slots/${F}`))));
await ok('coaches cannot change settings', assertFails(set(ref(coachA, `${R}/settings/${F}`), { seasonStart: '2099-01-01' })));
await ok('coaches cannot add teams', assertFails(set(ref(coachA, `${R}/teams/${F}/${OUT}`), { name: 'Sneaky' })));
await ok('the board changes settings', assertSucceeds(set(ref(board, `${R}/settings/${F}/practicesPerWeek`), 2)));

// booking
await ok('coach A books an open block', assertSucceeds(set(ref(coachA, slot(D1)), { team: A, kind: 'practice', at })));
await ok('coach B cannot book the same block (one booking per block)', assertFails(set(ref(coachB, slot(D1)), { team: B, kind: 'practice', at })));
await ok('coach B cannot book in A\'s name', assertFails(set(ref(coachB, slot(D3)), { team: A, kind: 'practice', at })));
await ok('a parent cannot book', assertFails(set(ref(parentA, slot(D3)), { team: A, kind: 'practice', at })));
await ok('the shared player code cannot book', assertFails(set(ref(playerGateA, slot(D3)), { team: A, kind: 'practice', at })));
await ok('a team not on this field cannot book it', assertFails(set(ref(outsider, slot(D3)), { team: OUT, kind: 'practice', at })));
await ok('a coach cannot lock their own block', assertFails(set(ref(coachB, slot(D2)), { team: B, kind: 'game', locked: true, at })));
await ok('coach B books another block', assertSucceeds(set(ref(coachB, slot(D2)), { team: B, kind: 'game', opp: 'Townsend', at })));
await ok('the coach gate code books too', assertSucceeds(set(ref(gateA, slot(D3)), { team: A, kind: 'practice', at })));
await ok('a practice can carry its length', assertSucceeds(set(ref(coachA, slot('2099-04-12/1730')), { team: A, kind: 'practice', mins: 90, at })));
await ok('a silly practice length is refused', assertFails(set(ref(coachA, slot('2099-04-13/1730')), { team: A, kind: 'practice', mins: 500, at })));
await ok('a bad kind is refused', assertFails(set(ref(coachA, slot('2099-04-10/1730')), { team: A, kind: 'party', at })));
await ok('a bad time key is refused', assertFails(set(ref(coachA, slot('2099-04-10/2575')), { team: A, kind: 'practice', at })));

// changing your own
await ok('coach A changes their block to a game', assertSucceeds(set(ref(coachA, slot(D3)), { team: A, kind: 'game', opp: 'Ayer', at })));
await ok('coach A cannot hand their block to B directly', assertFails(set(ref(coachA, slot(D3)), { team: B, kind: 'game', at })));
await ok('coach B cannot drop A\'s block', assertFails(remove(ref(coachB, slot(D3)))));
await ok('coach A drops their own block', assertSucceeds(remove(ref(coachA, slot(D3)))));

// a swap request
const r1 = `${R}/requests/${F}/r1`;
await ok('coach B cannot send a request in A\'s name', assertFails(set(ref(coachB, r1), { from: A, to: B, want: D2, st: 'pending', at })));
await ok('a request must name the team that really holds the block', assertFails(set(ref(coachB, r1), { from: B, to: A, want: D2, st: 'pending', at })));
await ok('coach B asks A to swap D1 for D2', assertSucceeds(set(ref(coachB, r1), { from: B, to: A, want: D1, give: D2, st: 'pending', at })));
await ok('coach B cannot accept their own request', assertFails(update(ref(coachB), { [`${r1}/st`]: 'accepted' })));
await ok('coach B cannot take the block before a yes, even naming the request', assertFails(set(ref(coachB, slot(D1)), { team: B, kind: 'practice', req: 'r1', at })));
await ok('coach A accepts: both blocks move in one update', assertSucceeds(update(ref(coachA), {
  [slot(D1)]: { team: B, kind: 'practice', req: 'r1', at },
  [slot(D2)]: { team: A, kind: 'game', opp: 'Townsend', req: 'r1', at },
  [`${r1}/st`]: 'accepted', [`${r1}/answeredAt`]: 2,
  [`${R}/inbox/${B}/n1`]: { text: 'Yes: swapped', from: A, field: F, kind: 'answer', at },
  [`${R}/log/${F}/l1`]: { text: 'A swapped with B', team: A, at },
})));
let after;
await env.withSecurityRulesDisabled(async c => { after = (await get(ref(c.database(), `${R}/slots/${F}`))).val(); });
if (after['2099-04-06']['1730'].team !== B || after['2099-04-08']['1900'].team !== A) throw new Error('swap did not land');
await ok('a used request cannot move a block again', assertFails(set(ref(coachA, slot(D1)), { team: A, kind: 'practice', req: 'r1', at })));
await ok('an answered request cannot be reopened', assertFails(update(ref(coachB), { [`${r1}/st`]: 'pending' })));

// asking without a trade, then saying no / withdrawing
const r2 = `${R}/requests/${F}/r2`, r3 = `${R}/requests/${F}/r3`;
await ok('coach A asks for D1 with no trade', assertSucceeds(set(ref(coachA, r2), { from: A, to: B, want: D1, note: 'makeup game', st: 'pending', at })));
await ok('coach A cannot accept it for B', assertFails(update(ref(coachA), { [`${r2}/st`]: 'accepted' })));
await ok('coach B says no thanks', assertSucceeds(update(ref(coachB), { [`${r2}/st`]: 'declined', [`${r2}/answeredAt`]: 3 })));
await ok('coach A asks again', assertSucceeds(set(ref(coachA, r3), { from: A, to: B, want: D1, st: 'pending', at })));
await ok('coach B cannot withdraw A\'s request', assertFails(update(ref(coachB), { [`${r3}/st`]: 'cancelled' })));
await ok('coach A withdraws it', assertSucceeds(update(ref(coachA), { [`${r3}/st`]: 'cancelled' })));
await ok('a request cannot be rewritten to another block on answer', assertFails(update(ref(coachB), { [`${r3}/want`]: D2 })));

// messages and the change log
await ok('coach A reads their own messages', assertSucceeds(get(ref(coachA, `${R}/inbox/${A}`))));
await ok('coach B cannot read A\'s messages', assertFails(get(ref(coachB, `${R}/inbox/${A}`))));
await ok('a parent cannot read the coaches\' messages', assertFails(get(ref(parentA, `${R}/inbox/${A}`))));
await ok('coach B can leave A a message', assertSucceeds(set(ref(coachB, `${R}/inbox/${A}/n2`), { text: 'asked for your block', from: B, field: F, kind: 'request', at })));
await ok('coach B cannot sign a message as A', assertFails(set(ref(coachB, `${R}/inbox/${A}/n3`), { text: 'x', from: A, field: F, at })));
await ok('coach B cannot overwrite a message', assertFails(set(ref(coachB, `${R}/inbox/${A}/n2`), { text: 'changed', from: B, field: F, at })));
await ok('an outside team cannot leave messages', assertFails(set(ref(outsider, `${R}/inbox/${A}/n4`), { text: 'x', from: OUT, field: F, at })));
await ok('coach A marks a message read', assertSucceeds(set(ref(coachA, `${R}/inbox/${A}/n2/read`), true)));
await ok('a log line cannot be edited', assertFails(set(ref(coachA, `${R}/log/${F}/l1`), { text: 'rewritten', team: A, at })));
await ok('a coach cannot log in another team\'s name', assertFails(set(ref(coachA, `${R}/log/${F}/l2`), { text: 'x', team: B, at })));

// the board
await ok('the board books for any team and locks it', assertSucceeds(set(ref(board, slot('2099-04-11/0900')), { team: A, kind: 'game', opp: 'Groton', locked: true, at })));
await ok('the team cannot move a locked league game', assertFails(remove(ref(coachA, slot('2099-04-11/0900')))));
await ok('the board moves a locked game', assertSucceeds(remove(ref(board, slot('2099-04-11/0900')))));

console.log(`\n${n} checks passed`);
await env.cleanup();
process.exit(0);
