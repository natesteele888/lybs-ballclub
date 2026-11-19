// Run: node tests/league-calendar.test.js
// Loads the real js/league-events.js and js/league-info.js into a fake page
// and checks the LYBS Dashboard's league calendar reaches the Coach app:
// the Dashboard's "everyone" dates show beside this app's own League Events
// (one copy of a date both have), never a board-only date, read-only here,
// and they open Important Dates. A failed fetch leaves only this app's own
// events. Made-up dates only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EVENTS_SRC = fs.readFileSync(path.join(__dirname, '../js/league-events.js'), 'utf8');
const INFO_SRC = fs.readFileSync(path.join(__dirname, '../js/league-info.js'), 'utf8');

const str = v => ({ stringValue: v });
const map = o => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)])) } });
const DOC = {
  name: 'projects/lybs-dashboard/databases/(default)/documents/lybs_league_calendar/everyone',
  fields: {
    events: { arrayValue: { values: [
      map({ id: 'a', title: 'Practice draft night', date: '2099-03-15', where: 'The pavilion', who: 'everyone' }),
      map({ id: 'b', title: 'Coaches meeting', date: '', when: 'January, date to be set', who: 'everyone' }),
      map({ id: 'c', title: 'Sponsor checks due', date: '2099-03-20', who: 'board' }),
      map({ id: 'd', title: 'Old clinic', date: '2000-01-01', who: 'everyone' }),
    ] } },
    updatedAt: str('x'),
  },
};

function page({ own = [], fetchOk = true, urls = [] } = {}) {
  const win = {
    BUILD_V: 1,
    leagueEventsPath: () => 'leagueEvents',
    dbGet: async p => (p === 'leagueEvents' ? own : null),
    escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    ClubLogos: { badgeHtml: () => '' },
    todayStr: () => '2050-01-01',
    uid: p => p + Math.random().toString(36).slice(2),
  };
  win.window = win;
  const fetch = async url => {
    urls.push(url);
    if (String(url).includes('firestore.googleapis.com')) {
      if (!fetchOk) throw new Error('no signal');
      return { ok: true, json: async () => DOC };
    }
    return { ok: true, json: async () => ({ seasons: [{ label: 'MAC Spring', status: 'current', items: ['Opening day: April 26th'] }], facilities: [], facilityRules: [], source: 's', governance: { officials: [] } }) };
  };
  const ctx = vm.createContext(Object.assign(win, { fetch, console, Promise, Date, Set, Object, Array, String, Number, JSON, URLSearchParams }));
  vm.runInContext(EVENTS_SRC, ctx);
  vm.runInContext(INFO_SRC, ctx);
  return win;
}

(async () => {
  let n = 0;
  const t = async (name, fn) => { await fn(); n++; console.log('  ok ' + name); };

  await t("the Dashboard's dates show beside this app's own, upcoming only, never a board-only one", async () => {
    const urls = [];
    const w = page({ own: [{ id: 'le1', title: 'Annual meeting', date: '2099-02-01' }], urls });
    await w.LeagueEvents.ensureLoaded();
    const titles = w.LeagueEvents.getUpcoming().map(e => e.title);
    assert.strictEqual(JSON.stringify(titles), JSON.stringify(['Annual meeting', 'Practice draft night', 'Coaches meeting']));
    assert.ok(urls.some(u => u.endsWith('/lybs_league_calendar/everyone')), 'reads the everyone document');
    assert.ok(!urls.some(u => /lybs_league_calendar\/board/.test(u)), 'never asks for the board document');
  });

  await t('a date both have shows once', async () => {
    const w = page({ own: [{ id: 'le2', title: 'practice draft night ', date: '2099-03-15' }] });
    await w.LeagueEvents.ensureLoaded();
    assert.strictEqual(w.LeagueEvents.getItems().filter(e => /practice draft/i.test(e.title)).length, 1);
  });

  await t('no signal for the Dashboard leaves this app\'s own events', async () => {
    const w = page({ own: [{ id: 'le3', title: 'Annual meeting', date: '2099-02-01' }], fetchOk: false });
    await w.LeagueEvents.ensureLoaded();
    assert.strictEqual(JSON.stringify(w.LeagueEvents.getUpcoming().map(e => e.title)), JSON.stringify(['Annual meeting']));
  });

  await t("the board's League Events tab shows Dashboard dates with no edit buttons", async () => {
    const w = page({ own: [{ id: 'le4', title: 'Annual meeting', date: '2099-02-01' }] });
    await w.LeagueEvents.ensureLoaded();
    const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
    w.LeagueEvents.render(el, { canEdit: true });
    assert.strictEqual((el.innerHTML.match(/data-edit=/g) || []).length, 1, 'only the app\'s own event can be edited');
    assert.ok(el.innerHTML.includes('January, date to be set'));
    assert.ok(el.innerHTML.includes("LYBS Dashboard"));
    assert.ok(!el.innerHTML.includes('Sponsor'));
  });

  await t('Important Dates opens with the Lunenburg dates, then the MAC League\'s', async () => {
    const w = page();
    w.scrollActiveTabIntoView = () => {};
    await w.LeagueInfo.ensureLoaded();
    const handlers = {};
    const el = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: sel => (sel.includes('data-id') ? ['fields', 'dates'].map(id => ({
        dataset: { id }, addEventListener: (_, fn) => { handlers[id] = fn; },
      })) : []),
    };
    w.LeagueInfo.render(el);
    handlers.dates();
    const html = el.innerHTML;
    const lybs = html.indexOf('Lunenburg (LYBS) dates'), mac = html.indexOf('MAC Spring');
    assert.ok(lybs > -1 && mac > lybs, 'the Lunenburg card comes first');
    assert.ok(html.includes('Practice draft night') && html.includes('The pavilion'));
    assert.ok(html.includes('January, date to be set'));
    assert.ok(!html.includes('Sponsor') && !html.includes('Old clinic'), 'no board-only or past dates');
  });

  await t('the parser keeps only everyone\'s dates and copes with an empty document', async () => {
    const w = page();
    assert.strictEqual(JSON.stringify(w.LeagueEvents._parseDashboardDoc({})), JSON.stringify([]));
    assert.strictEqual(JSON.stringify(w.LeagueEvents._parseDashboardDoc(DOC).map(e => e.title)), JSON.stringify(['Practice draft night', 'Coaches meeting', 'Old clinic']));
  });

  console.log(`\n${n} passed`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
