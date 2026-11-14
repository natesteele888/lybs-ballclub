// Run: node tests/roster-sync.test.mjs
// Checks the all-teams roster pull: names match across "first + last
// initial" and full names, a coach's number/position survive a merge,
// nobody is dropped unless starting over, every registry team is asked for,
// a team with nothing published is skipped (not emptied), and the log never
// prints a player name. Fake names and fake servers only.
import assert from 'node:assert';
import { createServer } from 'node:http';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nameKey, mergeRoster, registryTeamIds } from '../scripts/sync-roster-from-dashboard.mjs';

assert.equal(nameKey('Jordan Tester'), 'jordan t');
assert.equal(nameKey('jordan t.'), 'jordan t');
assert.equal(nameKey('  Avery  Q  '), 'avery q');
assert.equal(nameKey('Sky'), 'sky');

const existing = [
  { id: 'a', name: 'Jordan Tester', number: '7', position: 'SS', batsThrows: 'R/R' },
  { id: 'b', name: 'Casey Sample', number: '12', position: 'C', batsThrows: '' },
];
const dash = [{ first: 'Jordan', last: 'T' }, { first: 'Riley', last: 'Q' }];
let m = mergeRoster(existing, dash);
assert.deepEqual([m.kept, m.added, m.extra], [1, 1, 1]);
assert.deepEqual(m.roster[0], existing[0], 'matched player keeps number, position and full name');
assert.equal(m.roster[1].name, 'Riley Q');
assert.equal(m.roster[2].id, 'b', 'player not on the Dashboard is kept by default');
m = mergeRoster(existing, dash, { replace: true });
assert.deepEqual(m.roster.map(p => p.name), ['Jordan Tester', 'Riley Q'], 'replace drops the extra but keeps matched details');
m = mergeRoster([{ id: 'x', name: 'Sam T' }, { id: 'y', name: 'Sam Tee' }], [{ first: 'Sam', last: 'T' }]);
assert.equal(m.added, 1, 'an ambiguous name is added fresh, not guessed');
m = mergeRoster(null, dash);
assert.deepEqual([m.kept, m.added, m.extra], [0, 2, 0]);

const ids = await registryTeamIds();
assert.deepEqual(ids, ['select', 'majors-black', 'majors-blue', 'minors-black', 'minors-blue', 'rookies-black', 'rookies-blue', 'rookies-white']);

// End to end against a fake Apps Script and a fake Firebase.
const published = { select: dash, 'minors-blue': [{ first: 'Drew', last: 'P' }] };
const db = { 'teams/select/roster': existing };
const asked = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/exec') {
      const b = JSON.parse(body); asked.push(b.teamId);
      assert.equal(b.key, 'fake-key');
      const players = published[b.teamId];
      return res.end(JSON.stringify(players ? { ok: true, players } : { ok: false, error: 'No roster published yet for that team.' }));
    }
    assert.equal(url.searchParams.get('auth'), 'fake-secret');
    const path = url.pathname.slice(1).replace(/\.json$/, '');
    if (req.method === 'PUT') db[path] = JSON.parse(body);
    res.end(JSON.stringify(req.method === 'PUT' ? db[path] : (db[path] ?? null)));
  });
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const script = fileURLToPath(new URL('../scripts/sync-roster-from-dashboard.mjs', import.meta.url));
const run = (...a) => new Promise(resolve => {
  const p = nodeSpawn(process.execPath, [script, ...a], { env: { ...process.env, LYBS_APPS_SCRIPT_URL: base + '/exec', LYBS_REVIEW_KEY: 'fake-key', FIREBASE_DB_URL: base, FIREBASE_DB_SECRET: 'fake-secret' } });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ code, out }));
});

let r = await run('--all');
assert.equal(r.code, 0, r.out);
assert.equal(asked.length, 8, 'asks for every team');
assert.deepEqual(db['teams/select/roster'], existing, 'without --apply nothing changes');
r = await run('--all', '--apply');
assert.equal(r.code, 0, r.out);
assert.equal(db['teams/select/roster'].length, 3);
assert.equal(db['teams/select/roster'][0].number, '7');
assert.equal(db['teams/minors-blue/roster'][0].name, 'Drew P');
assert.ok(!('teams/majors-black/roster' in db), 'team with nothing published is left alone');
for (const n of ['Jordan', 'Riley', 'Casey', 'Drew', 'Tester']) assert.ok(!r.out.includes(n), `log must not show the name ${n}`);
assert.match(r.out, /select: 2 on the Dashboard -> 1 matched, 1 added, 1 not on the Dashboard kept/);
r = await run('--all', '--apply', '--replace');
assert.equal(db['teams/select/roster'].length, 2);
server.close();
console.log('roster-sync: all checks passed');
