/* ============================================================
   GameChanger integration -- two independent pieces living in one
   tab since they're both "this team's GameChanger data":

   1. Widget embed -- ported directly from lybs-reporting/schedules.js's
      pattern (same validation, same sandboxed-iframe render), adapted
      to this app's per-team RTDB path instead of a Firestore doc
      holding every league team. A coach pastes the snippet from
      web.gc.com -> Tools -> Create Scoreboard Widget; it shows live
      scores/upcoming games and links through to a livestream when one
      is running. The snippet is third-party JS from gc.com executing
      inside our page for every signed-in user, so it renders inside a
      sandboxed iframe via srcdoc with allow-scripts but deliberately
      NOT allow-same-origin -- it can draw its scoreboard and talk to
      its own servers, but it cannot reach this page's session/storage.

   2. Live schedule mirror -- teams/{teamId}/gcTeamId (board-settable
      below) plus scripts/scrape-gamechanger-schedule.mjs (a scheduled
      GitHub Action, see .github/workflows/gamechanger-schedule.yml)
      together pull this team's real schedule/scores into
      teams/{teamId}/gameChangerSchedule for display here, instead of
      relying solely on the pasted widget above. This CORRECTS an
      earlier assumption in this file (and elsewhere in this repo) that
      GameChanger has no public API at all -- it does, confirmed live
      2026-10-15/17: api.team-manager.gc.com serves real, unauthenticated
      JSON behind GameChanger's own public team pages. It's just not
      reachable from a browser (CORS-blocked, confirmed live, see that
      script's own header) -- hence the scheduled-job-plus-mirror shape,
      not a client-side fetch, same as every other external mirror in
      this app (macleague.org standings/team-details).
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

  // Accepts either the bare id (what scripts/scrape-gamechanger-schedule.mjs
  // and database.rules.json both call gcTeamId) or a pasted
  // web.gc.com/teams/{id} URL -- the URL is what a board member actually
  // sees and copies from their browser's address bar, so requiring them to
  // hand-extract the id themselves would be real, avoidable friction. Real
  // ids seen so far (data/season-archive.json) are short mixed-case
  // alphanumeric tokens, e.g. "gtKEQZgp28Vd" -- NOT numeric, despite how
  // GameChanger team ids might sound; don't add numeric-only validation.
  function extractGcTeamId(input) {
    const s = (input || '').trim();
    if (!s) return null;
    const urlMatch = s.match(/web\.gc\.com\/teams\/([A-Za-z0-9]+)/i);
    if (urlMatch) return urlMatch[1];
    if (/^[A-Za-z0-9]{6,24}$/.test(s)) return s;
    return null;
  }

  function fmtGameTime(iso, timezone) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: timezone || 'America/New_York',
    });
  }

  // Same badge/badgeW/badgeL/badgeT/badgeTbd convention js/team-page.js,
  // js/calendar-view.js, js/homepage.js and js/public-view.js all already
  // use for a played-vs-upcoming game result.
  function scheduleRowHtml(g) {
    const played = g.status === 'completed' && g.ourScore != null && g.theirScore != null;
    const resultBadge = played
      ? `<span class="badge ${g.ourScore > g.theirScore ? 'badgeW' : g.ourScore < g.theirScore ? 'badgeL' : 'badgeT'}">${g.ourScore}-${g.theirScore}</span>`
      : '<span class="badge badgeTbd">Upcoming</span>';
    return `
      <div class="listRow" style="cursor:default;">
        <div class="listRowMain">
          <div class="listRowTitle">${g.homeAway === 'away' ? '@ ' : 'vs '}${escapeHtml(g.opponent || 'TBD')}</div>
          <div class="listRowSub">${escapeHtml(fmtGameTime(g.startTs, g.timezone))}</div>
        </div>
        ${resultBadge}
      </div>`;
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

    async loadTeamId(teamId) {
      return window.dbGet(window.teamPath(teamId, 'gcTeamId'));
    },
    async saveTeamId(teamId, input) {
      const id = extractGcTeamId(input);
      if (!id) throw new Error('Paste the team’s GameChanger id, or the team’s web.gc.com page URL.');
      await window.dbPut(window.teamPath(teamId, 'gcTeamId'), id);
      return id;
    },
    async removeTeamId(teamId) {
      await window.dbPut(window.teamPath(teamId, 'gcTeamId'), null);
    },
    // {games: [...], fetchedAt} | null -- written by
    // scripts/scrape-gamechanger-schedule.mjs, never by this app.
    async loadSchedule(teamId) {
      return window.dbGet(window.teamPath(teamId, 'gameChangerSchedule'));
    },

    async render(teamId, containerEl, opts) {
      opts = opts || {};
      if (!containerEl.innerHTML) containerEl.innerHTML = '<div class="emptyState">Loading&hellip;</div>';
      const [record, gcTeamId, schedule] = await Promise.all([
        window.GameChanger.load(teamId),
        window.GameChanger.loadTeamId(teamId),
        window.GameChanger.loadSchedule(teamId),
      ]);
      // The iframe itself is built as a real DOM node below, not this
      // string -- a coach-pasted snippet almost always contains a quoted
      // attribute (<script src="...">), and escapeHtml() only escapes
      // & < > (see util.js), not " or '. Serializing that into a
      // srcdoc="..." HTML attribute string let a quoted snippet break out
      // of the attribute and inject live attributes (e.g. onload="...")
      // onto the real <iframe> element in the PARENT page -- completely
      // outside the sandbox, arbitrary JS in this app's real origin with
      // the signed-in session. Assigning .srcdoc as a JS property instead
      // never goes through HTML-attribute parsing at all, so this can't
      // happen regardless of what characters the snippet contains.
      const widgetHtml = record && record.snippet
        ? '<div id="gcFrameSlot"></div>'
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

      // Live schedule mirror -- see this file's header for the
      // gcTeamId/scrape-gamechanger-schedule.mjs pipeline this reads from.
      // Three states: no gcTeamId set yet (nothing to show, board form
      // below explains how); gcTeamId set but the scheduled job hasn't
      // run against it yet (honest wait message, not a blank gap); real
      // games to list.
      let scheduleSection = '';
      if (gcTeamId) {
        if (schedule && schedule.games && schedule.games.length) {
          scheduleSection = `
            <div class="sectionLabel">Live GameChanger schedule</div>
            <div class="listBody">${schedule.games.map(scheduleRowHtml).join('')}</div>`;
        } else {
          scheduleSection = `<div class="emptyState">GameChanger id is set -- schedule syncs within the next 30 minutes.</div>`;
        }
      }

      // Board-only -- sets teams/{teamId}/gcTeamId, which
      // scripts/scrape-gamechanger-schedule.mjs (a scheduled GitHub
      // Action) reads to know which team to pull from GameChanger's own
      // API. Separate from the coach-gated widget-paste form below: a
      // one-time per-team setup step, not something every coach needs to
      // touch each season.
      const boardIdForm = !opts.isBoard ? '' : `
        <div class="gcAddForm">
          <div class="sectionLabel">${gcTeamId ? 'GameChanger team id' : 'Connect this team’s live schedule'}</div>
          ${gcTeamId
            ? `<div class="helpText">Currently: <code>${escapeHtml(gcTeamId)}</code></div>
               <div class="detailActions"><button class="btn btnGhost btnSmall" id="gcIdRemoveBtn">Disconnect</button></div>`
            : `<div class="helpText">Paste this team's <b>web.gc.com</b> page URL (or just its id) to pull in a live schedule, instead of relying only on the pasted widget above. One-time, board-only setup.</div>
               <input class="drillFreeInput" id="gcIdInput" placeholder="web.gc.com/teams/... or the id itself">
               <div class="detailActions"><button class="btn btnSmall" id="gcIdSaveBtn">Connect</button></div>`}
          <div class="errorText" id="gcIdError"></div>
        </div>`;

      containerEl.innerHTML = `
        <div class="helpText">Live schedule and scores from GameChanger &mdash; display-only.
          <button class="btn btnGhost btnTiny" id="gcInfoBtn" style="margin-left:4px;">&#9432;</button>
        </div>
        ${scheduleSection}
        ${widgetHtml}
        ${mirrorForm}
        ${addForm}
        ${boardIdForm}`;
      const frameSlot = containerEl.querySelector('#gcFrameSlot');
      if (frameSlot && record && record.snippet) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
        frame.referrerPolicy = 'no-referrer';
        frame.className = 'gcFrame';
        frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}</style></head><body>' + record.snippet + '</body></html>';
        frameSlot.replaceWith(frame);
      }
      const gcInfoBtn = containerEl.querySelector('#gcInfoBtn');
      if (gcInfoBtn) {
        gcInfoBtn.addEventListener('click', () => {
          window.openInfoModal('About GameChanger', '<div class="helpText">Our own Schedule tab stays the source of truth for calendar sync, since GameChanger has no feed to sync from.</div>');
        });
      }

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
          if (!(await confirmModal('Remove the GameChanger widget?'))) return;
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

      if (opts.isBoard) {
        const idSaveBtn = containerEl.querySelector('#gcIdSaveBtn');
        if (idSaveBtn) idSaveBtn.addEventListener('click', async () => {
          const val = containerEl.querySelector('#gcIdInput').value;
          try {
            await window.GameChanger.saveTeamId(teamId, val);
            window.GameChanger.render(teamId, containerEl, opts);
          } catch (e) {
            containerEl.querySelector('#gcIdError').textContent = e.message;
          }
        });
        const idRemoveBtn = containerEl.querySelector('#gcIdRemoveBtn');
        if (idRemoveBtn) idRemoveBtn.addEventListener('click', async () => {
          if (!(await confirmModal('Disconnect this team’s live GameChanger schedule? The pasted widget above (if any) keeps working.'))) return;
          await window.GameChanger.removeTeamId(teamId);
          window.GameChanger.render(teamId, containerEl, opts);
        });
      }
    },
  };
})();
