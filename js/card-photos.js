/* ============================================================
   Card photos -- the Roster tab's "Card photo" button. A coach, or
   the parent of that one player, picks a photo for the player's
   Steele Cards card, and it goes to the league board for approval.

   Who sees the button
     - a coach (gate code or a coach invite), on every player's row
     - a parent, only on the row of a player whose parent email on the
       roster matches the Google account they signed in with. That
       email is the one link this app already keeps between a family
       and a player (js/roster.js), so it decides "their own kid".
       A player with no parent email on file shows the button to
       coaches only.

   Where the photo goes
     1. Picked on the phone, then redrawn on a canvas at no more than
        1600px (SocialSubmit.shrink). A canvas never carries EXIF, so
        the GPS location and camera details are gone before anything
        leaves the phone.
     2. Sent to the league's photo review queue (the same Apps Script
        endpoint Share to Social uses, see js/social-submit.js) with
        kind 'card', this team's id and the player's roster id. The
        queue lives in the league's private Drive.
     3. A board reviewer approves it on the Dashboard's Post Review
        screen. Approval writes the photo to cardPhotos/{teamId}/{pid}
        in this app's database, which only this team's signed-in
        coaches and parents and the board can read (database.rules.json),
        and a small status to teams/{teamId}/cardPhotoStatus/{pid} so
        this button can say "Approved". Nothing here is public and no
        photo is ever committed to this repo.

   This file never writes to the database itself.
   ============================================================ */
(function () {
  const SENT_KEY = 'lybs-card-photo-sent'; // this device's "sent, waiting" marks
  const cache = {}; // teamId -> { pid: {st, at} }
  const pending = {};

  const esc = s => window.escapeHtml(s == null ? '' : String(s));
  const norm = e => String(e || '').trim().toLowerCase();
  const playerLabel = p => (p && p.name ? p.name : 'this player') + (p && p.number ? ' #' + p.number : '');

  /* ---------- small pure pieces (also used by tests/card-photos.test.js) ---------- */
  // Coach: every row. Parent: only a player whose parent email is theirs.
  function canSendFor(player, who) {
    if (!player || !player.id || !who) return false;
    if (who.isCoach) return true;
    const mine = norm(who.email);
    return !!mine && norm(player.email) === mine;
  }

  // What goes to the review queue. First name + last initial is all the
  // roster holds; the parent email never leaves the phone.
  function payload(opts) {
    const p = opts.player || {};
    return {
      token: opts.token,
      kind: 'card',
      photo: opts.photo,
      filename: 'card-photo.jpg',
      teamId: String(opts.teamId || ''),
      playerId: String(p.id || ''),
      player: String(p.name || '').slice(0, 60),
      number: String(p.number || '').slice(0, 4),
      // teamName, not team: an older queue that doesn't know card photos
      // then refuses it ("Which team is this for?") instead of filing it as
      // a social photo. See lybs-reporting apps-script/card-photos.gs.
      teamName: String(opts.team || ''),
      division: String(opts.division || ''),
      location: '',
      description: `Card photo for ${playerLabel(p)}`,
      submitter: String(opts.byName || '').slice(0, 60),
    };
  }

  // Server status (approved/declined) wins once it is newer than this
  // device's own "sent" mark.
  function stateFor(server, sentAt) {
    if (server && (!sentAt || String(server.at || '') >= String(sentAt))) return server.st === 'approved' ? 'approved' : server.st === 'declined' ? 'declined' : '';
    return sentAt ? 'sent' : (server && server.st === 'approved' ? 'approved' : '');
  }

  function readSent() { try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function markSent(teamId, pid) {
    const all = readSent();
    all[teamId + '/' + pid] = new Date().toISOString();
    try { localStorage.setItem(SENT_KEY, JSON.stringify(all)); } catch (e) { /* private window: the toast still says it went */ }
  }

  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const v = await window.dbGet(window.teamPath(teamId, 'cardPhotoStatus'));
        cache[teamId] = v && typeof v === 'object' ? v : {};
      } catch (e) { cache[teamId] = {}; }
      finally { delete pending[teamId]; }
      return cache[teamId];
    })();
    return pending[teamId];
  }

  /* ---------- the roster ---------- */
  function cellHtml(teamId, p, who) {
    if (!canSendFor(p, who)) return '';
    const st = stateFor((cache[teamId] || {})[p.id], readSent()[teamId + '/' + p.id]);
    const chip = st === 'approved' ? '<span class="srChip ok">Card photo approved</span>'
      : st === 'sent' ? '<span class="srChip warn">Waiting on the board</span>'
      : st === 'declined' ? '<span class="srChip">Not approved, send another</span>' : '';
    return `${chip}<button type="button" class="btn btnGhost btnSmall" data-card-pid="${esc(p.id)}" aria-label="Send a card photo for ${esc(playerLabel(p))}">${st === 'approved' ? 'New card photo' : 'Card photo'}</button>`;
  }

  function wireCells(teamId, el, players, who, onChange) {
    el.querySelectorAll('[data-card-pid]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const p = players.find(x => x.id === b.dataset.cardPid);
      if (p && canSendFor(p, who)) openForm(teamId, p, who, onChange);
    }));
  }

  function openForm(teamId, player, who, onChange) {
    const SS = window.SocialSubmit;
    window.openInfoModal(`Card photo for ${playerLabel(player)}`, `
      <div class="srForm" id="cpForm">
        <p class="srHint">A clear photo of just ${esc(player.name || 'this player')}, in uniform if you have one. It goes to the league board first, and once approved only this team and the board can see it.</p>
        <label>Photo<input type="file" id="cpFile" accept="image/*"></label>
        <img id="cpShot" alt="" style="display:none;width:100%;max-width:320px;border-radius:10px;margin:4px 0 10px;">
        <div class="srHint" id="cpMsg"></div>
        <div class="detailActions"><button class="btn" id="cpSend" disabled>Send to the board</button></div>
      </div>`);
    const el = document.getElementById('cpForm');
    const $ = s => el.querySelector(s);
    let photo = null;
    const say = (t, good) => { const m = $('#cpMsg'); m.textContent = t; m.style.color = good ? 'var(--status-green)' : good === false ? 'var(--status-red)' : ''; };

    $('#cpFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      say('Getting the photo ready...');
      SS.shrink(f, 1600, 0.85).then(({ dataUrl }) => {
        photo = dataUrl;
        const shot = $('#cpShot'); shot.src = dataUrl; shot.style.display = 'block';
        $('#cpSend').disabled = false;
        say('Photo ready. Location and camera details were removed.', true);
      }).catch(() => say('Could not read that photo. Try another one.', false));
    });

    $('#cpSend').addEventListener('click', ev => window.withBusyButton(ev.target, 'Sending...', async () => {
      if (!photo) return say('Pick a photo first.', false);
      const cfg = window.TeamConfig.current();
      const res = await SS.send(payload({
        token: SS.FORM_TOKEN, photo, teamId, player,
        team: cfg.name || cfg.shortName || '', division: cfg.macLeagueDivisionName || '',
        byName: who.name,
      }));
      if (!res.ok) return say(/which team/i.test(res.message || '') ? 'Card photos are not switched on at the league yet. Nothing was sent.' : res.message, false);
      if (res.message === null) return say('Could not confirm it arrived. Check your connection and try again.', false);
      markSent(teamId, player.id);
      const x = document.getElementById('infoModalClose'); if (x) x.click();
      window.showToast('Sent. The board approves the card photo before it is used.');
      if (onChange) onChange();
    }));
  }

  window.CardPhotos = {
    ensureLoaded, cellHtml, wireCells, openForm,
    _test: { canSendFor, payload, stateFor },
  };
})();
