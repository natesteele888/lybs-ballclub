// Emulator check for the card photo rules. Needs firebase-tools and
// @firebase/rules-unit-testing installed somewhere on NODE_PATH, plus Java:
//   NODE_PATH=<node_modules> firebase emulators:exec --only database "node tests/card-photo-rules.emulator.mjs"
// Made-up team, players and accounts only.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(process.env.NODE_PATH.split(':')[0] + '/');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, remove } = require('firebase/database');

const env = await initializeTestEnvironment({
  projectId: 'demo-ballclub',
  database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 },
});
const T = 'team-sample', OTHER = 'team-other';
const photo = { type: 'image/jpeg', data: 'data:image/jpeg;base64,AAAA', at: '2026-11-16T12:00:00Z', w: 600, h: 840 };
await env.withSecurityRulesDisabled(async c => {
  const db = c.database();
  await set(ref(db, `access/${T}/coachU`), 'coach');
  await set(ref(db, `access/${T}/parentU`), 'parent');
  await set(ref(db, `access/${OTHER}/strangerU`), 'parent');
  await set(ref(db, `boardMembers/boardU`), true);
  await set(ref(db, `cardPhotos/${T}/p1`), photo);
  await set(ref(db, `teams/${T}/cardPhotoStatus/p1`), { st: 'approved', at: photo.at });
});
const as = (uid, token) => env.authenticatedContext(uid, token).database();
const coach = as('coachU'), parent = as('parentU'), stranger = as('strangerU'), board = as('boardU');
const playerGate = as('gateP', { email: `player-${T}-gate@lybsballclub.internal` });
const coachGate = as('gateC', { email: `coach-${T}-gate@lybsballclub.internal` });
const anon = env.unauthenticatedContext().database();
let n = 0; const ok = async (name, p) => { await p; n++; console.log('PASS ', name); };

await ok('team coach reads an approved card photo', assertSucceeds(get(ref(coach, `cardPhotos/${T}/p1`))));
await ok('team parent reads it', assertSucceeds(get(ref(parent, `cardPhotos/${T}/p1`))));
await ok('coach gate reads it', assertSucceeds(get(ref(coachGate, `cardPhotos/${T}/p1`))));
await ok('board reads it', assertSucceeds(get(ref(board, `cardPhotos/${T}/p1`))));
await ok('another team\'s parent cannot', assertFails(get(ref(stranger, `cardPhotos/${T}/p1`))));
await ok('the shared player code cannot', assertFails(get(ref(playerGate, `cardPhotos/${T}/p1`))));
await ok('signed-out cannot', assertFails(get(ref(anon, `cardPhotos/${T}/p1`))));
await ok('parent cannot write a photo', assertFails(set(ref(parent, `cardPhotos/${T}/p2`), photo)));
await ok('coach cannot write a photo', assertFails(set(ref(coach, `cardPhotos/${T}/p2`), photo)));
await ok('board can write one', assertSucceeds(set(ref(board, `cardPhotos/${T}/p2`), photo)));
await ok('board cannot write a non-image', assertFails(set(ref(board, `cardPhotos/${T}/p3`), { ...photo, type: 'image/svg+xml' })));
await ok('board cannot add extra fields', assertFails(set(ref(board, `cardPhotos/${T}/p3`), { ...photo, name: 'x' })));
await ok('parent cannot remove a photo', assertFails(remove(ref(parent, `cardPhotos/${T}/p2`))));
await ok('coach can take a photo down', assertSucceeds(remove(ref(coach, `cardPhotos/${T}/p2`))));
await ok('team reads card status', assertSucceeds(get(ref(parent, `teams/${T}/cardPhotoStatus/p1`))));
await ok('nobody writes card status from the app', assertFails(set(ref(coach, `teams/${T}/cardPhotoStatus/p1`), { st: 'approved', at: 'x' })));
await ok('board cannot write card status either', assertFails(set(ref(board, `teams/${T}/cardPhotoStatus/p1`), { st: 'approved', at: 'x' })));
await env.cleanup();
console.log(`card photo rules: ${n} passed`);
