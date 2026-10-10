/* ============================================================
   GameChanger widget embed -- ported directly from
   lybs-reporting/schedules.js's pattern (same validation, same
   sandboxed-iframe render), adapted to this app's per-team RTDB
   path instead of a Firestore doc holding every league team.

   GameChanger has no public API: no keys, no webhooks, no
   developer docs, none has ever been offered. The only sanctioned
   integration is their own Scoreboard Widget -- web.gc.com ->
   Tools -> Create Scoreboard Widget -- a snippet a coach copies
   out and pastes in here. It shows live scores/upcoming games and
   links through to the livestream when one is running, but it is
   NOT a data source for anything else in this app: there's no feed
   to read a schedule or roster back out of it, which is why the
   combined calendar (calendar-family.js) is built from games we
   enter ourselves, not from this widget.

   The snippet is third-party JS from gc.com executing inside our
   page for every signed-in user, so it renders inside a sandboxed
   iframe via srcdoc with allow-scripts but deliberately NOT
   allow-same-origin -- it can draw its scoreboard and talk to its
   own servers, but it cannot reach this page's session/storage.
   ============================================================ */
(function () {
  function validateSnippet(html) {
    const s = (html || '').trim();
    if (!s) return 'Paste the widget code from GameChanger first.';
    if (!/<script/i.test(s) && !/<iframe/i.test(s)) {
      return 'That does not look like the GameChanger snippet — it should contain a <script> or <iframe> tag.';
    }
    if (!/gc\.com|gamechanger/i.test(s)) {
      return 'That snippet does not reference gc.com. Copy it from web.gc.com → Tools → Create Scoreboard Widget.';
    }
    if (s.length > 20000) return 'That snippet is unexpectedly large — check you copied only the widget code.';
    return null;
  }

  window.GameChanger = {
    async load(teamId) {
      return window.dbGet(window.teamPath(teamId, 'gameChangerSnippet'));
    },
    async save(teamId, snippet, addedBy) {
      const bad = validateSnippet(snippet);
      if (bad) throw new Error(bad);
      const record = { snippet, addedBy: addedBy || '', addedAt: new Date().toISOString() };
      await window.dbPut(window.teamPath(teamId, 'gameChangerSnippet'), record);
      return record;
    },
    async remove(teamId) {
      await window.dbPut(window.teamPath(teamId, 'gameChangerSnippet'), null);
    },

    async render(teamId, containerEl, opts) {
      opts = opts || {};
      if (!containerEl.innerHTML) containerEl.innerHTML = '<div class="emptyState">Loading&hellip;</div>';
      const record = await window.GameChanger.load(teamId);
      const widgetHtml = record && record.snippet
        ? `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
             referrerpolicy="no-referrer"
             srcdoc="${escapeHtml('<!DOCTYPE html><html><head><meta charset=\'utf-8\'><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}</style></head><body>' + record.snippet + '</body></html>')}"
             class="gcFrame"></iframe>`
        : '<div class="emptyState">No GameChanger widget added yet.</div>';

      const addForm = !opts.canEdit ? '' : `
        <div class="gcAddForm">
          <div class="sectionLabel">${record ? 'Replace widget' : 'Add the GameChanger widget'}</div>
          <textarea id="gcSnippetInput" rows="5" placeholder="Paste the GameChanger widget code here"></textarea>
          <div class="helpText">In GameChanger: open the team on <b>web.gc.com</b> → <b>Tools</b> → <b>Create Scoreboard Widget</b> → copy the code.</div>
          <div class="detailActions">
            <button class="btn btnSmall" id="gcSaveBtn">Save widget</button>
            ${record ? '<button class="btn btnGhost btnSmall" id="gcRemoveBtn">Remove</button>' : ''}
          </div>
          <div class="errorText" id="gcError"></div>
        </div>`;

      // No automatic sync exists or can exist -- GameChanger has no public
      // API, no webhooks, and "posts" specifically aren't reachable by any
      // means at all, official or not (confirmed both in this file's own
      // header comment and fresh research). This is the realistic
      // alternative: a manual, one-tap mirror into this team's own
      // Announcements feed (js/announcements.js), tagged so parents can see
      // where it came from.
      const mirrorForm = !opts.canEdit ? '' : `
        <div class="gcAddForm">
          <div class="sectionLabel">Mirror a GameChanger update</div>
          <div class="helpText">After you post something in GameChanger, tap this to log the same update to your team's own feed -- GameChanger has no feed this app can read automatically.</div>
          <textarea id="gcMirrorInput" rows="3" placeholder="What did you just post in GameChanger?"></textarea>
          <button class="btn btnSmall" id="gcMirrorBtn">Post to team feed</button>
        </div>`;

      containerEl.innerHTML = `
        <div class="helpText">Live schedule and scores straight from GameChanger. This is display-only — our own Schedule tab stays the source of truth for calendar sync, since GameChanger has no feed to sync from.</div>
        ${widgetHtml}
        ${mirrorForm}
        ${addForm}`;

      if (opts.canEdit) {
        containerEl.querySelector('#gcSaveBtn').addEventListener('click', async () => {
          const val = containerEl.querySelector('#gcSnippetInput').value;
          try {
            await window.GameChanger.save(teamId, val, opts.addedBy);
            window.GameChanger.render(teamId, containerEl, opts);
          } catch (e) {
            containerEl.querySelector('#gcError').textContent = e.message;
          }
        });
        const removeBtn = containerEl.querySelector('#gcRemoveBtn');
        if (removeBtn) removeBtn.addEventListener('click', async () => {
          if (!confirm('Remove the GameChanger widget?')) return;
          await window.GameChanger.remove(teamId);
          window.GameChanger.render(teamId, containerEl, opts);
        });
        const mirrorBtn = containerEl.querySelector('#gcMirrorBtn');
        if (mirrorBtn) mirrorBtn.addEventListener('click', async () => {
          const input = containerEl.querySelector('#gcMirrorInput');
          const text = input.value.trim();
          if (!text) return;
          await withBusyButton(mirrorBtn, 'Posting...', () => window.Announcements.addItem(teamId, text, opts.addedBy, 'gamechanger'));
          input.value = '';
        });
      }
    },
  };
})();
