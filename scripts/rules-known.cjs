// Run: node scripts/rules-known.cjs <live-rules.json> [--only-current]
// Used by .github/workflows/database-rules.yml. Exits 0 if the live rules
// (as the database returned them) are the same as database.rules.json now,
// or, without --only-current, the same as any earlier version of it in git
// history. Compared as parsed JSON with keys sorted, so key order and
// whitespace don't count. Anything else means someone changed the live
// rules outside this repo (say, in the Firebase console), so it exits 1.
const fs = require('fs');
const { execFileSync } = require('child_process');

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const key = text => JSON.stringify(canon(JSON.parse(text)));

const [livePath, flag] = process.argv.slice(2);
if (!livePath) { console.error('usage: rules-known.cjs <live-rules.json> [--only-current]'); process.exit(2); }
const live = key(fs.readFileSync(livePath, 'utf8'));

if (live === key(fs.readFileSync('database.rules.json', 'utf8'))) {
  console.log('Live rules match database.rules.json');
  process.exit(0);
}
if (flag === '--only-current') {
  console.error('Live rules do not match database.rules.json');
  process.exit(1);
}
const shas = execFileSync('git', ['log', '--format=%H', '--', 'database.rules.json'], { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const sha of shas) {
  let text;
  try { text = execFileSync('git', ['show', `${sha}:database.rules.json`], { encoding: 'utf8' }); } catch (e) { continue; }
  try { if (key(text) === live) { console.log(`Live rules match database.rules.json as of ${sha.slice(0, 7)}`); process.exit(0); } } catch (e) { /* an old version that wasn't valid JSON */ }
}
console.error(`Live rules match no version of database.rules.json (checked ${shas.length}). Someone may have changed them in the Firebase console.`);
console.error('Nothing was changed. Copy any console edits into database.rules.json, or run this workflow by hand with "overwrite" ticked (the live rules are saved in the rules-before artifact).');
process.exit(1);
