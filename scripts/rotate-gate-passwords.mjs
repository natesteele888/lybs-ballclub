#!/usr/bin/env node
/* One-time: move the team gate accounts onto the new password recipe.
 *
 * Why: the old Firebase password for each gate account WAS the SHA-256
 * hash published in js/team-registry.js, so anyone could copy a hash from
 * GitHub and sign in without the code. js/cloud-auth.js now derives the
 * password from the typed code (PBKDF2, separate salt). This script sets
 * each existing gate account to that new password and ends its saved
 * sessions, so a copied hash stops working.
 *
 * It asks for each team's codes (typing is hidden). A code is checked
 * against the published hash first, so a typo is caught before anything
 * changes. Press Enter on a blank line to skip a code. The codes are
 * never printed, saved or sent anywhere but the password update itself.
 *
 * Run (on your own computer, never in GitHub Actions):
 *   npm --prefix functions install
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   # never commit this file
 *   node scripts/rotate-gate-passwords.mjs            # dry run: checks codes, changes nothing
 *   node scripts/rotate-gate-passwords.mjs --apply    # changes the passwords
 *
 * Test against the Auth emulator instead of the live project:
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/rotate-gate-passwords.mjs --apply
 *
 * Every device signed in with a team code has to type it once more
 * afterwards (Google sign-in is not affected).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, pbkdf2Sync } from 'node:crypto';
import vm from 'node:vm';
import readline from 'node:readline';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'lybs-ballclub';

// Must match js/cloud-auth.js exactly.
const GATE_PW_SALT_PREFIX = 'lybs-ballclub-gate-v2';
const GATE_PW_ITERATIONS = 100000;
export function gatePassword(code, teamId, role) {
  return pbkdf2Sync(code, `${GATE_PW_SALT_PREFIX}|${teamId}|${role}`, GATE_PW_ITERATIONS, 32, 'sha256').toString('hex');
}
const gateEmail = (teamId, role) => `${role}-${teamId}-gate@lybsballclub.internal`;
const sha256 = s => createHash('sha256').update(s).digest('hex');

function loadRegistry() {
  const src = readFileSync(new URL('../js/team-registry.js', import.meta.url), 'utf8');
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  return ctx.window.TEAM_REGISTRY.codeHashes;
}

// One shared line reader, so codes can be typed (hidden) or piped in.
let muted = false;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
rl._writeToOutput = s => { if (!muted) process.stdout.write(s); };
const lines = rl[Symbol.asyncIterator]();
async function askHidden(prompt) {
  process.stdout.write(prompt);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  return done ? '' : value.trim();
}

async function main() {
  const entries = Object.entries(loadRegistry()); // [hash, {teamId, role}]
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: PROJECT_ID });
  const auth = admin.auth();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (add --apply to change passwords)'} -- project ${PROJECT_ID}` +
    (process.env.FIREBASE_AUTH_EMULATOR_HOST ? ` via emulator ${process.env.FIREBASE_AUTH_EMULATOR_HOST}` : ''));

  const summary = [];
  for (const [hash, { teamId, role }] of entries) {
    const email = gateEmail(teamId, role);
    let user = null;
    try { user = await auth.getUserByEmail(email); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (!user) { summary.push(`${teamId} ${role}: no account yet -- will be created with the new password on first sign-in`); continue; }

    let code;
    for (;;) {
      code = await askHidden(`${teamId} ${role} code (blank to skip): `);
      if (!code || sha256(code) === hash) break;
      console.log('  That does not match the published hash for this team and role. Try again.');
    }
    if (!code) { summary.push(`${teamId} ${role}: SKIPPED -- old hash still works as its password`); continue; }
    if (APPLY) {
      await auth.updateUser(user.uid, { password: gatePassword(code, teamId, role) });
      await auth.revokeRefreshTokens(user.uid);
      summary.push(`${teamId} ${role}: changed; its devices must type the code once more`);
    } else {
      summary.push(`${teamId} ${role}: code OK, would change`);
    }
  }
  console.log('\n' + summary.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(() => process.exit(0), e => { console.error(e.message || e); process.exit(1); });
}
