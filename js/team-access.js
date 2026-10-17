/* ============================================================
   Team Access -- coach-facing invite/revoke panel for the new
   per-person access model (js/access-control.js,
   js/google-auth.js). Separate from, and doesn't replace, the
   existing shared team code (js/auth.js) -- a parent can still get
   into this team with just the code, same as always. This panel is
   specifically for inviting a *particular* person by email, which
   the shared code has no way to express.

   Coach-only, same as Depth Chart/Lineups -- gated at the nav
   level (COACH_ONLY_TABS in index.html), no canEdit split needed
   here the way Awards/Equipment have one for their read-only mode.

   Stored at access/{teamId}/{uid} (the granted list) and
   invitesByTeam/{teamId}/{emailKey} (pending, not yet accepted) --
   see js/backend.js's accessPath()/inviteByTeamPath() and
   database.rules.json's matching rules. Resolving a uid to a name
   reads people/{uid}, written once by js/access-control.js at that
   person's first Google sign-in.
   ============================================================ */
(function () {
  function emailKey(email) {
    return (email || '').trim().toLowerCase().replace(/\./g, ',');
  }
  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function loadAccessList(teamId) {
    const access = await window.dbGet(window.accessPath(teamId));
    const uids = Object.keys(access || {});
    const people = await Promise.all(uids.map(uid => window.dbGet(window.personPath(uid))));
    return uids.map((uid, i) => ({
      uid, role: access[uid],
      name: (people[i] && people[i].name) || 'Unknown',
      email: people[i] && people[i].email,
    }));
  }

  async function loadPendingInvites(teamId) {
    const invites = await window.dbGet(window.inviteByTeamPath(teamId));
    return Object.entries(invites || {}).map(([key, invite]) => Object.assign({ emailKey: key }, invite));
  }

  window.TeamAccess = {
    async render(containerEl, teamId, opts) {
      let granted = await loadAccessList(teamId);
      let pending = await loadPendingInvites(teamId);
      let inviting = false;

      function personRowHtml(person) {
        return `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(person.name)}</div>
              <div class="listRowSub">${escapeHtml(person.email || '')} &middot; ${person.role === 'coach' ? 'Coach' : 'Parent'}</div>
            </div>
            <button class="btn btnTiny" data-revoke="${escapeHtml(person.uid)}" title="Remove access">&times;</button>
          </div>`;
      }
      function pendingRowHtml(invite) {
        return `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(invite.email || 'Pending')}</div>
              <div class="listRowSub">Invited as ${invite.role === 'coach' ? 'Coach' : 'Parent'}${invite.invitedByName ? ' by ' + escapeHtml(invite.invitedByName) : ''} &middot; not yet accepted</div>
            </div>
            <button class="btn btnTiny" data-uninvite="${escapeHtml(invite.emailKey)}" title="Cancel invite">&times;</button>
          </div>`;
      }

      // Roster entries with an email already on file (typed by a coach, or
      // pulled from lybs-reporting's Contacts carve-out -- see js/roster.js's
      // header comment) whose parent doesn't already have access or a
      // pending invite. Shown as pick-to-prefill suggestions so a coach
      // doesn't have to retype an email that's already in the roster.
      // Fetched once per render pass, not per keystroke -- this list only
      // changes when granted/pending/the roster itself changes, all of
      // which already trigger a fresh refresh() below.
      async function suggestedContacts() {
        if (!window.Roster) return []; // roster.js not loaded on this page
        await window.Roster.ensureLoaded(teamId);
        const takenEmails = new Set(
          granted.map(p => (p.email || '').toLowerCase())
            .concat(pending.map(p => (p.email || '').toLowerCase())));
        return window.Roster.getPlayers(teamId)
          .filter(p => p.email && !takenEmails.has(p.email.toLowerCase()));
      }

      function suggestedRowHtml(p) {
        return `
          <button type="button" class="btn btnGhost btnSmall" data-suggest="${escapeHtml(p.email)}"
            style="margin:0 6px 6px 0;">${escapeHtml(p.name || 'Unnamed')}</button>`;
      }

      async function refresh() {
        const suggestions = inviting ? await suggestedContacts() : [];
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">Team Access</div>
            <div class="drillHeroSub">Invite a specific parent by email.</div>
          </div>
          <div class="sectionLabel">Has access</div>
          <div class="listBody">${granted.length ? granted.map(personRowHtml).join('') : '<div class="emptyState">Nobody has been individually invited yet.</div>'}</div>
          <div class="sectionLabel" style="margin-top:16px;">Pending invites</div>
          <div class="listBody">${pending.length ? pending.map(pendingRowHtml).join('') : '<div class="emptyState">No pending invites.</div>'}</div>
          ${inviting ? `
            ${suggestions.length ? `
              <div class="helpText" style="margin-top:14px;">From the roster -- tap to fill in their email:</div>
              <div style="margin-top:4px;">${suggestions.map(suggestedRowHtml).join('')}</div>
            ` : ''}
            <div class="drillAddRow" style="margin-top:${suggestions.length ? 4 : 14}px;">
              <input class="drillFreeInput" id="taEmailInput" type="email" placeholder="parent@example.com" autofocus>
              <button class="btn btnSmall" id="taInviteSave">Send</button>
            </div>
            <div class="helpText" id="taInviteError" style="color:var(--status-red);"></div>
          ` : `<button class="btn" id="taInviteBtn" style="width:100%;margin-top:14px;">+ Invite a parent</button>`}`;

        const inviteBtn = containerEl.querySelector('#taInviteBtn');
        if (inviteBtn) inviteBtn.addEventListener('click', () => { inviting = true; refresh(); });

        containerEl.querySelectorAll('[data-suggest]').forEach(btn => {
          btn.addEventListener('click', () => {
            const input = containerEl.querySelector('#taEmailInput');
            if (input) { input.value = btn.dataset.suggest; input.focus(); }
          });
        });

        const saveBtn = containerEl.querySelector('#taInviteSave');
        if (saveBtn) {
          saveBtn.addEventListener('click', async () => {
            const input = containerEl.querySelector('#taEmailInput');
            const email = input.value.trim();
            const errEl = containerEl.querySelector('#taInviteError');
            if (!validEmail(email)) { errEl.textContent = 'Enter a valid email address.'; return; }
            const key = emailKey(email);
            const invite = {
              teamId, role: 'parent', email,
              invitedByName: opts.inviterName,
              createdAt: Date.now(),
            };
            await withBusyButton(saveBtn, 'Sending...', async () => {
              await window.dbUpdate({
                [window.invitePath(key, teamId)]: invite,
                [window.inviteByTeamPath(teamId, key)]: invite,
              });
            });
            inviting = false;
            pending = await loadPendingInvites(teamId);
            refresh();
          });
        }

        containerEl.querySelectorAll('[data-revoke]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await confirmModal('Remove this person’s access to the team?'))) return;
            await window.dbPut(window.accessPath(teamId, btn.dataset.revoke), null);
            granted = await loadAccessList(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-uninvite]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const key = btn.dataset.uninvite;
            await window.dbUpdate({
              [window.invitePath(key, teamId)]: null,
              [window.inviteByTeamPath(teamId, key)]: null,
            });
            pending = await loadPendingInvites(teamId);
            refresh();
          });
        });
      }
      refresh();
    },
  };
})();
