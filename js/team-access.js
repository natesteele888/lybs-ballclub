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

      function refresh() {
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
            <div class="drillAddRow" style="margin-top:14px;">
              <input class="drillFreeInput" id="taEmailInput" type="email" placeholder="parent@example.com" autofocus>
              <button class="btn btnSmall" id="taInviteSave">Send</button>
            </div>
            <div class="helpText" id="taInviteError" style="color:#ff8a8a;"></div>
          ` : `<button class="btn" id="taInviteBtn" style="width:100%;margin-top:14px;">+ Invite a parent</button>`}`;

        const inviteBtn = containerEl.querySelector('#taInviteBtn');
        if (inviteBtn) inviteBtn.addEventListener('click', () => { inviting = true; refresh(); });

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
              await window.dbPut(window.invitePath(key, teamId), invite);
              await window.dbPut(window.inviteByTeamPath(teamId, key), invite);
            });
            inviting = false;
            pending = await loadPendingInvites(teamId);
            refresh();
          });
        }

        containerEl.querySelectorAll('[data-revoke]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this person’s access to the team?')) return;
            await window.dbPut(window.accessPath(teamId, btn.dataset.revoke), null);
            granted = await loadAccessList(teamId);
            refresh();
          });
        });
        containerEl.querySelectorAll('[data-uninvite]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const key = btn.dataset.uninvite;
            await window.dbPut(window.invitePath(key, teamId), null);
            await window.dbPut(window.inviteByTeamPath(teamId, key), null);
            pending = await loadPendingInvites(teamId);
            refresh();
          });
        });
      }
      refresh();
    },
  };
})();
