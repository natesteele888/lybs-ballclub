/* ============================================================
   MAC League pitch count report -- the text a coach copies from a
   played game and enters on the MAC League site.

   MAC League's Spring rule (data/rules-seed.json, general-games-12):
   both teams report every pitcher's first name, last initial, uniform
   number and total pitches, within 24 hours of the game or before
   their next game, whichever comes first. This builds exactly that,
   one line per pitcher, from the game's logged pitch counts and the
   team roster (for uniform numbers). Nothing is sent anywhere: the
   coach still signs in to macleague.org and enters it there.

   window.MacReport.build({ teamName, opponent, date, pitchCounts,
   roster, toFirstLastInitial }) -> { text, missingNumbers }
   ============================================================ */
(function (root) {
  function firstLastInitial(name, fn) {
    if (typeof fn === 'function') return fn(name);
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || '';
    return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase();
  }

  function niceDate(ymd) {
    const d = new Date(String(ymd || '') + 'T12:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function build(o) {
    const fn = o.toFirstLastInitial;
    const key = n => firstLastInitial(n, fn).toLowerCase();
    const roster = Array.isArray(o.roster) ? o.roster : [];
    let missingNumbers = 0;
    const lines = (o.pitchCounts || [])
      .filter(pc => pc && pc.name && Number.isFinite(Number(pc.pitches)))
      .map(pc => {
        const matches = roster.filter(p => p && p.name && key(p.name) === key(pc.name));
        const num = matches.length === 1 && String(matches[0].number || '').trim() ? String(matches[0].number).trim() : '';
        if (!num) missingNumbers++;
        return `${num ? '#' + num : '# ?'} ${firstLastInitial(pc.name, fn)}: ${Number(pc.pitches)} pitches`;
      });
    const head = `Pitch counts: ${o.teamName || 'Our team'}${o.opponent ? ' vs ' + o.opponent : ''}${o.date ? ', ' + niceDate(o.date) : ''}`;
    const text = [head, ...lines].join('\n');
    return { text, missingNumbers, count: lines.length };
  }

  const api = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MacReport = api;
})(typeof window !== 'undefined' ? window : null);
