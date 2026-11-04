#!/usr/bin/env node
/* Set new login codes for one team, without the codes ever touching GitHub.
 *
 *   node scripts/set-team-codes.mjs select
 *
 * Asks for a new player code and a new coach code (typing is hidden, each
 * asked twice), then swaps that team's two hashes in js/team-registry.js.
 * Only the hashes are printed or written. Commit js/team-registry.js and
 * hand the codes to the board yourself.
 *
 * If the team's gate accounts already exist in Firebase, run
 * scripts/rotate-gate-passwords.mjs --apply right after (with the NEW
 * codes), or that team can't sign in.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import readline from 'node:readline';

const FILE = new URL('../js/team-registry.js', import.meta.url);
const teamId = process.argv[2];
if (!teamId) { console.error('Usage: node scripts/set-team-codes.mjs <teamId>'); process.exit(1); }
const sha256 = s => createHash('sha256').update(s).digest('hex');

let muted = false;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
rl._writeToOutput = s => { if (!muted) process.stdout.write(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt) {
  process.stdout.write(prompt);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  if (done) { console.error('No more input.'); process.exit(1); }
  return value.trim();
}

let src = readFileSync(FILE, 'utf8');
const existing = new Set([...src.matchAll(/'([0-9a-f]{64})'/g)].map(m => m[1]));
const newHashes = {};
for (const role of ['player', 'coach']) {
  const re = new RegExp(`'[0-9a-f]{64}'(: \\{ teamId: '${teamId}', role: '${role}' \\})`);
  if (!re.test(src)) { console.error(`No ${role} entry for team "${teamId}" in js/team-registry.js.`); process.exit(1); }
  for (;;) {
    const code = await ask(`New ${teamId} ${role} code: `);
    if (code.length < 8) { console.log('  Use at least 8 characters.'); continue; }
    const hash = sha256(code);
    if (existing.has(hash) || Object.values(newHashes).includes(hash)) { console.log('  That code is already in use. Pick another.'); continue; }
    if ((await ask('Type it again: ')) !== code) { console.log("  Didn't match. Start this one again."); continue; }
    newHashes[role] = hash;
    src = src.replace(re, `'${hash}'$1`);
    break;
  }
}
writeFileSync(FILE, src);
rl.close();
console.log(`Updated js/team-registry.js for ${teamId}:`);
for (const [role, hash] of Object.entries(newHashes)) console.log(`  ${role}: ${hash}`);
console.log('The old codes no longer open this team. Commit js/team-registry.js, then run rotate-gate-passwords.mjs --apply if its gate accounts exist.');
