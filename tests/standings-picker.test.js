// Run: NODE_PATH=<node_modules with jsdom> node tests/standings-picker.test.js
// The Standings tab shows the team's own division first, with one button per
// mirrored division so a coach can see the whole league. Loads the real
// js/standings.js into jsdom with the repo's own standings seed (public
// macleague.org standings, no kids).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/standings-seed.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(__dirname, '../js/standings.js'), 'utf8');
const NAMES = { '33694': 'Rookies', '33695': 'Minors', '33696': 'Majors' };

function page(data) {
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  w.stripAgePrefix = s => String(s || '').replace(/^\d{1,2}u\s+/i, '');
  w.TonightGames = {
    ensureLoaded: async () => data,
    availableDivisions: () => ['33694', '33695', '33696'].filter(id => data.divisions[id]).map(id => ({ id, name: NAMES[id] })),
    gameRowHtml: () => '',
  };
  w.ClubLogos = { ensureLoaded: async () => {}, badgeHtml: () => '' };
  w.LeagueInfo = { ensureLoaded: async () => {}, currentSeasonLabel: () => 'Fall 2026' };
  w.openInfoModal = () => {};
  w.eval(SRC);
  return w;
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  let pass = 0;
  const w = page(SEED);
  const c = w.document.getElementById('c');
  await w.Standings.render(c, '33696');
  let btns = [...c.querySelectorAll('[data-standings-div]')];
  assert.deepStrictEqual(btns.map(b => b.textContent.trim()), ['Majors (ours)', 'Rookies', 'Minors']);
  assert.strictEqual(btns[0].getAttribute('aria-pressed'), 'true');
  assert.ok(c.textContent.includes('Majors Standings'));
  assert.strictEqual(c.querySelectorAll('.standingsTable tbody tr').length, SEED.divisions['33696'].rows.length);
  pass++; console.log('  ok  own division first and shown by default');

  btns[2].click();
  await tick(); await tick();
  btns = [...c.querySelectorAll('[data-standings-div]')];
  assert.ok(c.textContent.includes('Minors Standings'));
  assert.strictEqual(c.querySelectorAll('.standingsTable tbody tr').length, SEED.divisions['33695'].rows.length);
  assert.strictEqual(btns[0].textContent.trim(), 'Majors (ours)');
  assert.strictEqual(btns[2].getAttribute('aria-pressed'), 'true');
  pass++; console.log('  ok  another division is one tap away, and "ours" stays first');

  btns[0].click();
  await tick(); await tick();
  assert.ok(c.textContent.includes('Majors Standings'));
  pass++; console.log('  ok  back to our own division');

  const one = page({ divisions: { '33696': SEED.divisions['33696'] } });
  const c1 = one.document.getElementById('c');
  await one.Standings.render(c1, '33696');
  assert.strictEqual(c1.querySelectorAll('[data-standings-div]').length, 0);
  pass++; console.log('  ok  no buttons when the mirror has one division');

  const missing = page({ divisions: { '33694': SEED.divisions['33694'], '33695': SEED.divisions['33695'] } });
  const c2 = missing.document.getElementById('c');
  await missing.Standings.render(c2, '33696');
  assert.ok(c2.textContent.includes('No standings mirrored yet'));
  assert.strictEqual(c2.querySelectorAll('[data-standings-div]').length, 2);
  pass++; console.log('  ok  own division not mirrored yet: the other divisions are still reachable');

  console.log(pass + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
