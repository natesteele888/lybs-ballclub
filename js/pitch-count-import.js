/* ============================================================
   Pitch Count import -- reads the day's pitch totals that Walk-Up's
   Pitch Count saved on this same phone, so a coach can bring them
   into a played game with one tap instead of retyping them.

   Walk-Up (natesteele888/apps, walkup/) lives on the same site as
   this app (natesteele888.github.io), so its saved data is readable
   here with no server and no sign-in. Nothing is fetched and nothing
   is written back to Walk-Up. Two keys, both written by
   walkup/pitch.js using the math in walkup/pitch-core.js:

     walkup.pitch      {pitchers: [{id, name}], events: [
                          {i, k: 'p', p: pitcherId, t}   one pitch
                          {i, k: 'u', x: eventId, t}     undo of one pitch
                          {i, k: 's', p: pitcherId, n: name, t}  on the mound
                        ]}
     walkup.pitchHist  {'YYYY-MM-DD': {name: pitches}}  days older than
                        Walk-Up's last few, already added up by name

   Counts are per calendar day on this phone (event time in local
   time), the same way Walk-Up counts them against the daily max, so
   a doubleheader's two games come back as one total for the day.
   If walkup/pitch-core.js changes that shape, change this file too.

   Exposes:
     window.PitchCountImport.dayTotals(getItem, day) ->
       [{name, pitches}] sorted by name; [] when there's nothing
   ============================================================ */
(function (root) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function cleanName(s) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) : ''; }
  function readJson(getItem, key) {
    try { const v = JSON.parse(getItem(key) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }

  function dayTotals(getItem, day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return [];
    const byName = {};
    const add = (name, n) => {
      const nm = cleanName(name);
      if (!nm || !(n > 0)) return;
      byName[nm] = (byName[nm] || 0) + n;
    };

    const log = readJson(getItem, 'walkup.pitch');
    if (log && Array.isArray(log.events)) {
      const events = log.events.filter(e => e && typeof e === 'object' && typeof e.i === 'string' && isFinite(Number(e.t)));
      const undone = {};
      events.forEach(e => { if (e.k === 'u' && typeof e.x === 'string') undone[e.x] = true; });
      const names = {};
      (Array.isArray(log.pitchers) ? log.pitchers : []).forEach(p => { if (p && typeof p.id === 'string' && cleanName(p.name)) names[p.id] = p.name; });
      events.forEach(e => { if (e.k === 's' && typeof e.p === 'string' && !names[e.p] && cleanName(e.n)) names[e.p] = e.n; });
      const seen = {}, perId = {};
      events.forEach(e => {
        if (e.k !== 'p' || typeof e.p !== 'string' || undone[e.i] || seen[e.i]) return;
        seen[e.i] = true;
        if (ymd(Number(e.t)) !== day) return;
        perId[e.p] = (perId[e.p] || 0) + 1;
      });
      Object.keys(perId).forEach(id => add(names[id] || 'Pitcher', perId[id]));
    }

    const hist = readJson(getItem, 'walkup.pitchHist');
    const dayHist = hist && hist[day] && typeof hist[day] === 'object' ? hist[day] : null;
    if (dayHist) Object.keys(dayHist).forEach(nm => add(nm, Math.round(Number(dayHist[nm]))));

    return Object.keys(byName).sort((a, b) => a.localeCompare(b)).map(name => ({ name, pitches: byName[name] }));
  }

  const API = { dayTotals };
  if (typeof module === 'object' && module.exports) module.exports = API; else root.PitchCountImport = API;
})(typeof self !== 'undefined' ? self : this);
