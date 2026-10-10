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
  // Disables btn and swaps its label for busyLabel while fn() is in flight,
  // restoring both after -- so a tap on a slow/flaky sideline connection
  // reads as "working" instead of looking like it didn't register (and a
  // second tap can't fire the save/delete twice). Safe to call even when
  // the caller's own completion handler replaces btn's whole container,
  // since the restore in `finally` just runs against an already-discarded
  // node at that point.
  window.withBusyButton = function withBusyButton(btn, busyLabel, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyLabel;
    return Promise.resolve(fn()).finally(() => {
      btn.disabled = false;
      btn.textContent = original;
    });
  };

  window.statTileHtml = function statTileHtml(value, label) {
    return `<div class="pcStatTile"><div class="pcStatValue">${value}</div><div class="pcStatLabel">${label}</div></div>`;
  };

  // withBusyButton above covers a save still in flight; this covers one
  // that came back FAILED -- every dbGet/dbPut in js/backend.js calls this
  // on a network/HTTP error so a tap on a dead sideline connection reads
  // as "didn't save, try again" instead of silently doing nothing. A
  // button's own busy/disabled state already resets itself via
  // withBusyButton's `finally` regardless of outcome -- this is just the
  // one piece neither that nor a bare `await dbPut(...)` was telling
  // anyone: whether it actually worked.
  window.showToast = function showToast(message, kind) {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind === 'info' ? 'toastInfo' : 'toastError'}`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toastShow'));
    setTimeout(() => {
      el.classList.remove('toastShow');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  };

  // RSVP -- shared by schedule.js and practices.js's detail views, since
  // a game and a practice both just need "who's coming" attached the same
  // way: rides along on the item itself (item.rsvps = {name: 'in'|'out'}),
  // no separate collection to keep in sync. viewerName is this device's
  // identity.js name -- without one (shouldn't happen past the identity
  // screen, but defensive) rsvpHtml still shows the headcount, just no
  // buttons of one's own to highlight. canEdit (coach) also gets the actual
  // names, not just the count -- a parent only needs "how many", a coach
  // planning who's at the plate needs "who".
  window.rsvpHtml = function rsvpHtml(item, viewerName, canEdit) {
    const rsvps = item.rsvps || {};
    const names = Object.keys(rsvps);
    const inNames = names.filter(n => rsvps[n] === 'in');
    const outNames = names.filter(n => rsvps[n] === 'out');
    const mine = viewerName ? rsvps[viewerName] : null;
    return `
      <div class="sectionLabel" style="margin-top:16px;">RSVP</div>
      ${viewerName ? `
        <div class="rsvpRow">
          <button class="btn btnSmall ${mine === 'in' ? '' : 'btnGhost'}" data-rsvp="in">I'm in</button>
          <button class="btn btnSmall ${mine === 'out' ? '' : 'btnGhost'}" data-rsvp="out">Can't make it</button>
        </div>` : ''}
      ${canEdit ? `
        <div class="helpText" style="margin-top:6px;">
          <b>${inNames.length} in:</b> ${inNames.map(escapeHtml).join(', ') || '&mdash;'}<br>
          <b>${outNames.length} out:</b> ${outNames.map(escapeHtml).join(', ') || '&mdash;'}
        </div>` : `
        <div class="helpText" style="margin-top:6px;">${inNames.length} in &middot; ${outNames.length} out</div>`}`;
  };
  // saveFn(item) persists it (window.Schedule.saveGame/Practices.saveItem,
  // already bound to teamId by the caller); onDone re-renders the detail
  // view so the new highlight/headcount show immediately.
  window.wireRsvp = function wireRsvp(containerEl, item, viewerName, saveFn, onDone) {
    if (!viewerName) return;
    containerEl.querySelectorAll('[data-rsvp]').forEach(btn => {
      btn.addEventListener('click', async () => {
        item.rsvps = item.rsvps || {};
        item.rsvps[viewerName] = btn.dataset.rsvp;
        await saveFn(item);
        if (onDone) onDone();
      });
    });
  };

  // Carpool -- schedule.js only, away games only (see there): rides along
  // on the game itself (item.driving = {name: seatsOpenForTeammates}), same
  // "attached to the item, no separate collection" shape as rsvps above.
  // Only offered to someone who's already RSVP'd in -- can't offer a ride
  // to a game you're not going to. No address/phone exchanged here or
  // anywhere else in this app; this just says who to go coordinate with,
  // the same boundary the opponent's MAC League page link already draws.
  window.carpoolHtml = function carpoolHtml(item, viewerName) {
    const driving = item.driving || {};
    const names = Object.keys(driving);
    const mine = viewerName ? driving[viewerName] : null;
    const amIIn = !!(viewerName && item.rsvps && item.rsvps[viewerName] === 'in');
    return `
      <div class="sectionLabel" style="margin-top:16px;">Carpool</div>
      ${amIIn ? `
        <div class="helpText" style="margin:0 0 6px;">Can you drive? Open seats for teammates:</div>
        <div class="rsvpRow" style="flex-wrap:wrap;">
          <button class="btn btnTiny ${!mine ? '' : 'btnGhost'}" data-drive="0">Not driving</button>
          <button class="btn btnTiny ${mine === 1 ? '' : 'btnGhost'}" data-drive="1">1 seat</button>
          <button class="btn btnTiny ${mine === 2 ? '' : 'btnGhost'}" data-drive="2">2 seats</button>
          <button class="btn btnTiny ${mine === 3 ? '' : 'btnGhost'}" data-drive="3">3 seats</button>
          <button class="btn btnTiny ${mine >= 4 ? '' : 'btnGhost'}" data-drive="4">4+ seats</button>
        </div>` : ''}
      <div class="helpText" style="margin-top:6px;">
        ${names.length ? `&#128663; ${names.map(n => `${escapeHtml(n)} (${driving[n]} seat${driving[n] === 1 ? '' : 's'})`).join(' &middot; ')}` : "No one's offered to drive yet."}
      </div>`;
  };
  window.wireCarpool = function wireCarpool(containerEl, item, viewerName, saveFn, onDone) {
    if (!viewerName) return;
    containerEl.querySelectorAll('[data-drive]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const seats = Number(btn.dataset.drive);
        item.driving = item.driving || {};
        if (seats > 0) item.driving[viewerName] = seats; else delete item.driving[viewerName];
        await saveFn(item);
        if (onDone) onDone();
      });
    });
  };

  // A horizontally-scrolling tab row (index.html's navCatBar/tabBarEl,
  // league-info.js's section switcher, public-view.js's panel nav) rebuilds
  // its whole innerHTML on every click, which silently resets scrollLeft to
  // 0 -- without this, picking a tab further right than the visible edge
  // (e.g. "Resources", last of five) re-renders the row scrolled back to
  // the far left, hiding the very tab just chosen. Called once after
  // innerHTML is set, same call site every time: find whichever button is
  // .active now, scroll it fully into view. selector defaults to the
  // .tabBtn convention most of these rows use; index.html's category bar
  // uses .navCatBtn instead, passed explicitly.
  window.scrollActiveTabIntoView = function scrollActiveTabIntoView(containerEl, selector) {
    const active = containerEl.querySelector(selector || '.tabBtn.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
})();
