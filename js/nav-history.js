/* ============================================================
   Nav History -- makes the browser/hardware Back button close
   js/team-page.js's Team Page and js/game-preview.js's Game Preview
   instead of leaving the app entirely. Neither is a real nav tab
   (both are reached only by tapping a card, see index.html's two
   delegated [data-team-nav]/[data-game-nav] handlers), so switching
   to either one never touches the browser's own history by itself --
   without this, pressing Back while looking at one closed the whole
   PWA/tab instead of just that screen, same installed-app trap as
   any single-page app that never calls history.pushState.

   push(onPop) -- call when opening a screen that should close on
     Back. onPop is invoked once, either by a later real Back press
     (via popstate) or by that screen's own in-app Back button
     calling consumeTop() below -- a caller's close logic should be
     the SAME function either way (see index.html's own call sites),
     not two different closers that could drift apart.
   consumeTop() -- call from a screen's own in-app Back button,
     right where it already runs its own close logic directly. Pops
     the matching history entry so a later real Back press doesn't
     try to close something that's already gone.

   Depth-based, not a timing flag: consumeTop() pops the JS-side
   stack BEFORE calling history.back(), so by the time THAT call's
   own popstate event fires (asynchronously, on a later task), the
   depth check below already finds nothing left to close and no-ops
   -- no setTimeout/mutex guessing about event ordering.
   ============================================================ */
(function () {
  const stack = []; // [{onPop}]

  window.addEventListener('popstate', e => {
    const depth = (e.state && e.state.navDepth) || 0;
    // Normally just one entry (a single Back press) -- the loop also
    // recovers correctly if the browser ever jumps back more than one
    // step at once (e.g. a long-press-and-hold back gesture).
    while (stack.length > depth) {
      const top = stack.pop();
      if (top && top.onPop) top.onPop();
    }
  });

  window.NavHistory = {
    push(onPop) {
      stack.push({ onPop });
      history.pushState({ navDepth: stack.length }, '', location.href);
    },
    consumeTop() {
      if (!stack.length) return;
      stack.pop();
      history.back();
    },
  };
})();
