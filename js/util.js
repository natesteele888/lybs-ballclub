/* ============================================================
   Shared helpers every other module was redefining on its own --
   escapeHtml alone was byte-identical in 22 files. Loaded first, as
   plain globals (window.escapeHtml etc.), not a window.Util object:
   every call site across the app already calls these as bare
   escapeHtml(...)/uid(...)/etc. from inside its own IIFE, and an
   unqualified identifier falls through to the global of the same
   name as long as nothing local shadows it -- so dropping each
   file's own `function escapeHtml(s) {...}` leaves every existing
   call site working unchanged, nothing to rewrite at the call site.
   ============================================================ */
(function () {
  window.escapeHtml = function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  };

  // Each caller passes its own short prefix (the id's first chars, e.g.
  // 'g' for a game, 'p' for a practice) so ids stay distinguishable at a
  // glance in storage/devtools -- same scheme every module already used
  // individually, just no longer reimplemented five times.
  window.uid = function uid(prefix) {
    return (prefix || '') + Date.now() + Math.random().toString(36).slice(2, 7);
  };

  // macleague.org's own team names repeat the division's age bracket on
  // every row ("12u Groton Dunstable") -- redundant once the division is
  // named once wherever that list is headed, and the main reason team
  // names were crowding out other columns on narrow screens.
  window.stripAgePrefix = function stripAgePrefix(name) {
    return (name || '').replace(/^\d{1,2}u\s+/i, '');
  };

  window.mapLink = function mapLink(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
  };
  // schedule.js called this mapLink, league-info.js called the identical
  // thing mapUrl -- both names kept so neither file's call sites need
  // touching, just the duplicate function bodies removed.
  window.mapUrl = window.mapLink;

  window.todayIso = function todayIso() { return new Date().toISOString().slice(0, 10); };
  window.todayStr = window.todayIso; // homepage.js's name for the same thing

  // practices.js's three item types, labeled -- shared so a practice
  // reads the same whether it's listed from practices.js, the Schedule
  // tab's calendar view, the homepage, or a family's combined .ics export.
  window.TYPE_LABEL = { practice: 'Practice', cage: 'Batting Cage', film: 'Film / Walkthrough' };

  // The small value/label tile (.pcStatRow > .pcStatTile) team-page.js and
  // homepage.js each build by hand, repeated 4 and 3 times respectively.
  // Callers still escape their own value/label before passing them in --
  // same as before, just no longer retyping the two wrapping divs each time.
  window.statTileHtml = function statTileHtml(value, label) {
    return `<div class="pcStatTile"><div class="pcStatValue">${value}</div><div class="pcStatLabel">${label}</div></div>`;
  };
})();
