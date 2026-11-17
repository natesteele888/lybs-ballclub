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

   Seeing the card
     Once a photo is approved, the row also gets "See card": the real
     Steele Cards card, front and back, drawn on the phone from the
     approved photo and the roster line, with a button to save both as
     pictures. The drawing code is Steele Cards' own Card Maker
     (lybs-cards card-kit/), loaded by path from the same github.io
     site (KIT_BASE), so a card here always matches the Card Maker. If
     those files move, change KIT_BASE. Nothing is uploaded.

   This file never writes to the database itself.
   ============================================================ */
(function () {
  const SENT_KEY = 'lybs-card-photo-sent'; // this device's "sent, waiting" marks
  // Steele Cards' Card Maker, same github.io site as this app (lybs-cards repo, card-kit/).
  const KIT_BASE = '../lybs-cards/card-kit/';
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

  // The card's words, from the roster line and this team. Only what a card
  // shows: SteeleCardKit.cardData drops everything else (the parent email).
  function cardFor(player, cfg, K, year) {
    const p = player || {};
    return K.cardData({ name: p.name, number: p.number, position: p.position, batsThrows: p.batsThrows },
      { name: (cfg && (cfg.name || cfg.shortName)) || '', division: (cfg && cfg.macLeagueDivisionName) || '' },
      { name: 'LYBS', season: String(year || new Date().getFullYear()) });
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
    const see = st === 'approved' ? `<button type="button" class="btn btnSmall" data-card-see="${esc(p.id)}" aria-label="See the card for ${esc(playerLabel(p))}">See card</button>` : '';
    return `${chip}${see}<button type="button" class="btn btnGhost btnSmall" data-card-pid="${esc(p.id)}" aria-label="Send a card photo for ${esc(playerLabel(p))}">${st === 'approved' ? 'New card photo' : 'Card photo'}</button>`;
  }

  function wireCells(teamId, el, players, who, onChange) {
    el.querySelectorAll('[data-card-pid]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const p = players.find(x => x.id === b.dataset.cardPid);
      if (p && canSendFor(p, who)) openForm(teamId, p, who, onChange);
    }));
    el.querySelectorAll('[data-card-see]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const p = players.find(x => x.id === b.dataset.cardSee);
      if (p && canSendFor(p, who)) openCard(teamId, p);
    }));
  }

  /* ---------- seeing the card ---------- */
  let kit = null;
  function loadScript(src) {
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => no(new Error('kit'));
      document.head.appendChild(s);
    });
  }
  // The Card Maker's two files, its template art and its fonts, once per visit.
  function loadKit() {
    if (kit) return kit;
    kit = (async () => {
      if (!window.SteeleCardKit) await loadScript(KIT_BASE + 'card-kit.js');
      if (!window.SteeleCard) await loadScript(KIT_BASE + 'steele-card.js');
      if (!document.getElementById('cpKitFonts')) {
        const l = document.createElement('link');
        l.id = 'cpKitFonts'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Michroma&family=Oswald:wght@400;500;600;700&family=Source+Serif+4:ital,wght@1,400;1,700&display=swap';
        document.head.appendChild(l);
      }
      await window.SteeleCard.loadLayers(KIT_BASE);
      if (document.fonts && document.fonts.load) {
        await Promise.all(['italic 58px Anton', 'italic 24px Michroma', '500 12px Oswald', "italic 12px 'Source Serif 4'"]
          .map(f => document.fonts.load(f).catch(() => null)));
      }
      return { K: window.SteeleCardKit, SC: window.SteeleCard };
    })();
    kit.catch(() => { kit = null; }); // a failed load can be tried again
    return kit;
  }
  function imageFrom(dataUrl) {
    return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = dataUrl; });
  }

  async function openCard(teamId, player) {
    window.openInfoModal(`Card for ${playerLabel(player)}`, `
      <div class="srForm" id="cpCard">
        <canvas id="cpCanvas" width="712" height="1000" style="display:block;width:100%;max-width:340px;margin:0 auto 10px;border-radius:12px;"></canvas>
        <div class="srHint" id="cpCardMsg">Drawing the card...</div>
        <div class="detailActions">
          <button class="btn btnGhost" id="cpFlip" disabled>Back</button>
          <button class="btn" id="cpSave" disabled>Save front and back</button>
        </div>
      </div>`);
    const root = document.getElementById('cpCard');
    const $ = s => root.querySelector(s);
    const say = (t, bad) => { const m = $('#cpCardMsg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--status-red)' : ''; } };
    let parts, photo;
    try { parts = await loadKit(); } catch (e) { return say('Could not load the card design. Check your connection and try again.', true); }
    try {
      const v = await window.dbGet(`cardPhotos/${teamId}/${player.id}`);
      if (!v || typeof v.data !== 'string' || v.data.indexOf('data:image/') !== 0) return say('The approved photo is not here yet. Try again in a little while.', true);
      photo = await imageFrom(v.data);
    } catch (e) {
      return say('The photo is approved, but card photos are not switched on at the league yet, so it cannot be shown here.', true);
    }
    if (!document.body.contains(root)) return; // closed while it loaded
    const { K, SC } = parts;
    const data = cardFor(player, window.TeamConfig.current(), K);
    let side = 'front';
    const draw = () => SC.render($('#cpCanvas'), { side, data, photo, imgScale: 1.3, imgOffsetX: 0, imgOffsetY: 0 });
    draw();
    say('This is the real Steele Cards card. Saving puts two pictures on this phone; nothing is uploaded.');
    $('#cpFlip').disabled = false; $('#cpSave').disabled = false;
    $('#cpFlip').addEventListener('click', () => { side = side === 'front' ? 'back' : 'front'; $('#cpFlip').textContent = side === 'front' ? 'Back' : 'Front'; draw(); });
    $('#cpSave').addEventListener('click', ev => window.withBusyButton(ev.target, 'Saving...', async () => {
      for (const s of ['front', 'back']) {
        const c = document.createElement('canvas');
        SC.render(c, { side: s, data, photo, imgScale: 1.3, imgOffsetX: 0, imgOffsetY: 0 });
        const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92));
        if (!blob) return say('Could not save the card on this phone.', true);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ('steele-card-' + (data.first || 'player') + '-' + (data.last || '') + '-' + s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-') + '.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        await new Promise(ok => setTimeout(ok, 400));
      }
      say('Saved front and back to this phone.');
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
    ensureLoaded, cellHtml, wireCells, openForm, openCard,
    _test: { canSendFor, payload, stateFor, cardFor, KIT_BASE },
  };
})();
