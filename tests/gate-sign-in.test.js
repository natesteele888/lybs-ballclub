// Run: node tests/gate-sign-in.test.js
// Loads the real js/cloud-auth.js into a fake page that talks to a fake
// Firebase Auth, and checks the gate sign-in: the Firebase password comes
// from the typed code (not the published hash), an account still on the old
// hash password is moved over instead of locking the team out, and a saved
// session Firebase has ended is dropped. Fake codes and a fake server only.
// To see it fail on an old file: node tests/gate-sign-in.test.js path/to/old/cloud-auth.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHash, pbkdf2Sync, webcrypto } = require('crypto');

const SRC = fs.readFileSync(process.argv[2] || path.join(__dirname, '../js/cloud-auth.js'), 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
const T = 'majors-a', R = 'player', CODE = 'fake-test-code-77';
const newPw = (code, t = T, r = R) => pbkdf2Sync(code, `lybs-ballclub-gate-v2|${t}|${r}`, 100000, 32, 'sha256').toString('hex');
const EMAIL = `${R}-${T}-gate@lybsballclub.internal`;

// A tiny Firebase Auth. Changing a password starts a new token generation,
// which ends older refresh tokens (as real Firebase does).
function fakeAuth(accounts, opts = {}) {
  let anon = 0;
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const tokens = e => ({ idToken: 'id|' + e, refreshToken: 'rt|' + e + '|' + accounts[e].epoch, expiresIn: '3600' });
  async function fetch(url, init) {
    const text = (init && init.body) || ''; let b = {}; try { b = JSON.parse(text); } catch (e) {}
    if (/accounts:signUp/.test(url)) {
      if (!b.email) return reply(200, { idToken: 'anon' + (++anon), refreshToken: 'rt-anon', expiresIn: '3600' });
      if (accounts[b.email]) return reply(400, { error: { message: 'EMAIL_EXISTS' } });
      accounts[b.email] = { password: b.password, epoch: 0 }; return reply(200, tokens(b.email));
    }
    if (/signInWithPassword/.test(url)) {
      const a = accounts[b.email];
      return a && a.password === b.password ? reply(200, tokens(b.email)) : reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    }
    if (/accounts:update/.test(url)) {
      if (opts.updateFails) throw new Error('network down');
      const e = String(b.idToken).replace(/^id\|/, ''); if (!accounts[e]) return reply(400, { error: { message: 'INVALID_ID_TOKEN' } });
      accounts[e].password = b.password; accounts[e].epoch++; return reply(200, tokens(e));
    }
    if (/securetoken/.test(url)) {
      if (opts.refreshStatus) return reply(opts.refreshStatus, { error: { message: 'SERVER' } });
      const m = /^rt\|(.+)\|(\d+)$/.exec(decodeURIComponent(/refresh_token=(.+)$/.exec(text)[1]));
      const a = m && accounts[m[1]];
      return a && String(a.epoch) === m[2] ? reply(200, { id_token: 'id|' + m[1], refresh_token: 'rt|' + m[1] + '|' + a.epoch, expires_in: '3600' }) : reply(400, { error: { message: 'TOKEN_EXPIRED' } });
    }
    return reply(404, {});
  }
  return { fetch, accounts };
}
function memStore(init = {}) {
  const s = Object.assign({}, init);
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } };
}
function load(auth, local = memStore()) {
  const sb = { console: { log() {}, error() {}, warn() {} }, Date, Number, JSON, Math, Promise, Array, Uint8Array, String, Object, Error, TextEncoder, encodeURIComponent, crypto: webcrypto, localStorage: local, fetch: auth.fetch };
  sb.window = sb; vm.createContext(sb); vm.runInContext(SRC, sb); return sb;
}
const SESSION_KEY = 'lybsGateSession';
const seed = epoch => memStore({ [SESSION_KEY]: JSON.stringify({ refreshToken: 'rt|' + EMAIL + '|' + epoch, teamId: T, role: R }) });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok - ' + name); }
  catch (e) { failed++; console.log('not ok - ' + name + '\n    ' + String(e && e.message ? e.message : e).slice(0, 300)); }
}

(async () => {
  await test('a brand-new gate account is created with a password derived from the code, not the published hash', async () => {
    const a = fakeAuth({}); const w = load(a);
    await w.signInWithGate(T, R, CODE);
    assert.strictEqual(a.accounts[EMAIL].password, newPw(CODE));
    assert.notStrictEqual(a.accounts[EMAIL].password, sha(CODE));
    assert(w.hasGateSession(), 'no saved session');
  });
  await test('an account already on the new password signs in with the right code', async () => {
    const a = fakeAuth({ [EMAIL]: { password: newPw(CODE), epoch: 0 } }); const w = load(a);
    await w.signInWithGate(T, R, CODE); assert(w.hasGateSession(), 'no saved session');
  });
  await test('an account still on the old hash password signs in and is moved to the new one (no lockout before the script is run)', async () => {
    const a = fakeAuth({ [EMAIL]: { password: sha(CODE), epoch: 0 } }); const w = load(a);
    await w.signInWithGate(T, R, CODE);
    assert.strictEqual(a.accounts[EMAIL].password, newPw(CODE), 'password not moved');
    assert(w.hasGateSession(), 'no saved session');
  });
  await test('after the move, the published hash no longer works as the password', async () => {
    const a = fakeAuth({ [EMAIL]: { password: sha(CODE), epoch: 0 } }); const w = load(a);
    await w.signInWithGate(T, R, CODE);
    const r = await a.fetch('https://x/accounts:signInWithPassword', { body: JSON.stringify({ email: EMAIL, password: sha(CODE) }) });
    assert(!r.ok, 'the hash still signs in');
  });
  await test('a wrong code is refused and changes nothing', async () => {
    const a = fakeAuth({ [EMAIL]: { password: sha(CODE), epoch: 0 } }); const w = load(a);
    await assert.rejects(w.signInWithGate(T, R, 'some-other-code'));
    assert.strictEqual(a.accounts[EMAIL].password, sha(CODE)); assert(!w.hasGateSession());
  });
  await test('someone who only has the published hash cannot sign in through the app once the account has moved', async () => {
    const a = fakeAuth({ [EMAIL]: { password: newPw(CODE), epoch: 0 } }); const w = load(a);
    await assert.rejects(w.signInWithGate(T, R, sha(CODE)));
    assert(!w.hasGateSession());
  });
  await test('if moving the password fails, the person is still signed in and the account is untouched', async () => {
    const a = fakeAuth({ [EMAIL]: { password: sha(CODE), epoch: 0 } }, { updateFails: true }); const w = load(a);
    await w.signInWithGate(T, R, CODE);
    assert(w.hasGateSession(), 'locked out by a failed move'); assert.strictEqual(a.accounts[EMAIL].password, sha(CODE));
  });
  await test('a saved session that Firebase ended is dropped, so the next load shows the code screen', async () => {
    const a = fakeAuth({ [EMAIL]: { password: newPw(CODE), epoch: 1 } }); const w = load(a, seed(0));
    assert(w.hasGateSession(), 'precondition'); await assert.rejects(w.getFirebaseIdToken()); assert(!w.hasGateSession(), 'dead session kept');
  });
  await test('a server error does not end the saved session', async () => {
    const a = fakeAuth({ [EMAIL]: { password: newPw(CODE), epoch: 0 } }, { refreshStatus: 503 }); const w = load(a, seed(0));
    await assert.rejects(w.getFirebaseIdToken()); assert(w.hasGateSession(), 'session dropped on a blip');
  });
  console.log(passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  if (failed) process.exit(1);
})();
