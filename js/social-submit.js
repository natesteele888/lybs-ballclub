/* ============================================================
   Share to social -- adapted from lybs-reporting's submit-win.html,
   the league dashboard's public (no-login) photo/caption intake
   form. Two real differences here, both direct results of this app
   already having what that public form can't assume:

   1. Game info (opponent, score, date, location) is picked from
      this team's own real Schedule data, not free-typed -- the
      "tied in with the schedule" half of this feature. Team name
      and division come from TeamConfig, not typed either.
   2. This tool only renders inside the already-authenticated
      Coaching tab, so there's no need for the source form's
      "goes into the same pending queue as a stranger's submission,
      a coach clears it like anything else" caution -- a submission
      from here already came from a signed-in coach.

   Submits to the SAME Apps Script endpoint and FORM_TOKEN as that
   form (see apps-script/Code.gs in lybs-reporting), so once that
   one shared backend is deployed -- a step neither app has done yet,
   ENDPOINT is still a literal placeholder in lybs-reporting's own
   committed submit-win.html -- wins shared from either app land in
   the exact same review queue, not a second parallel one. Until
   then this degrades the same honest way that form does: composing
   and copying a caption always works, filing it in the league
   drive says plainly that it isn't connected yet.
   ============================================================ */
(function () {
  // Must match FORM_TOKEN in lybs-reporting/apps-script/Code.gs. Not a secret
  // -- see that file's header for why (a speed bump against a crawler, not
  // access control; "Anyone" has to be able to post since parents at a field
  // aren't signed into anything -- the review queue is what's actually gated).
  const FORM_TOKEN = 'lybs-field-2027';
  // Paste the deployed Apps Script /exec URL here once that one shared setup
  // step (lybs-reporting's apps-script/Code.gs header, step 4-5) is done.
  const ENDPOINT = 'PASTE_YOUR_APPS_SCRIPT_URL';

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function sid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

  function tags(division) {
    const t = ['#LYBS', '#LunenburgMA'];
    if (division) t.push('#' + division.replace(/[^A-Za-z0-9]/g, ''));
    t.push('#YouthBaseball', '#LunenburgBaseball');
    return t;
  }

  // Adapted from lybs-reporting's compose() -- generalized to not assume a
  // win, since a coach might want to share a tough playoff loss or a big
  // individual effort just as much as a result.
  function compose(opts) {
    const { team, division, opponent, ourScore, oppScore, location, date, description, sponsor } = opts;
    const lines = [];
    let head;
    if (ourScore != null && oppScore != null) {
      if (ourScore > oppScore) head = `🏆 ${team.toUpperCase()} ${ourScore}-${oppScore} OVER ${(opponent || 'THEIR OPPONENT').toUpperCase()}`;
      else if (ourScore < oppScore) head = `⚾ ${team.toUpperCase()} vs ${opponent || 'THEIR OPPONENT'} — ${ourScore}-${oppScore}`;
      else head = `⚾ ${team.toUpperCase()} TIE ${opponent || 'THEIR OPPONENT'} — ${ourScore}-${oppScore}`;
    } else {
      head = `⚾ ${team.toUpperCase()}${opponent ? ' vs ' + opponent.toUpperCase() : ''}`;
    }
    lines.push(head);
    if (description) lines.push('', description);
    const where = [];
    if (location) where.push('📍 ' + location);
    if (date) where.push('🗓 ' + new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
    if (where.length) lines.push('', where.join('   '));
    if (sponsor) lines.push('', `🙌 Thanks to ${sponsor} for sponsoring LYBS — our sponsors are why these kids have fields to play on.`);
    lines.push('', tags(division).join(' '));
    return lines.join('\n');
  }

  function shrink(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => { img.onerror = reject; img.src = reader.result; };
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ dataUrl: c.toDataURL('image/jpeg', quality) });
      };
      reader.readAsDataURL(file);
    });
  }

  async function send(payload) {
    const body = JSON.stringify({ ...payload, sid: sid() });
    const opts = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body };
    try {
      const res = await fetch(ENDPOINT, opts);
      const data = await res.json();
      return data.ok ? { ok: true, message: data.message || 'Sent.' } : { ok: false, message: data.error || 'The league server refused that.' };
    } catch (e) {
      try { await fetch(ENDPOINT, { ...opts, mode: 'no-cors' }); return { ok: true, message: null }; }
      catch (e2) { return { ok: false, message: 'Could not send that -- check your connection and try again.' }; }
    }
  }

  window.SocialSubmit = {
    render(containerEl, teamId) {
      const team = window.TeamConfig.current().name || window.TeamConfig.current().shortName || 'Our team';
      const division = window.TeamConfig.current().macLeagueDivisionName || '';
      const games = window.Schedule.getGames(teamId).filter(g => g.ourScore != null && g.oppScore != null).reverse();
      let photoData = null, photoName = '';
      let selectedGameId = games[0] ? games[0].id : '';

      function currentGame() { return games.find(g => g.id === selectedGameId); }

      function captionText() {
        const g = currentGame();
        return compose({
          team, division,
          opponent: g ? g.opponent : '',
          ourScore: g ? g.ourScore : null,
          oppScore: g ? g.oppScore : null,
          location: g ? g.location : '',
          date: g ? g.date : '',
          description: containerEl.querySelector('#ssDesc')?.value.trim() || '',
          sponsor: containerEl.querySelector('#ssSponsor')?.value.trim() || '',
        });
      }

      function refreshPreview() {
        const text = captionText();
        const capEl = containerEl.querySelector('#ssCaption');
        if (capEl) capEl.textContent = text;
        const countEl = containerEl.querySelector('#ssCount');
        if (countEl) countEl.textContent = `${text.length} characters${text.length > 125 ? ' · first 125 show before "See more"' : ''}${photoData ? '' : ' · no photo attached yet'}`;
      }

      containerEl.innerHTML = `
        <div class="drillHero">
          <div class="drillHeroIcon">📸</div>
          <div class="drillHeroTitle">Share to Social</div>
          <div class="drillHeroSub">Pick a game, add a photo and a note — get a finished caption, and optionally file it for the league's review queue.</div>
        </div>
        <label class="drillFieldLabel">Game
          <select class="lineupSlotSelect" id="ssGame" style="width:100%;">
            ${games.length ? games.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.date)} ${g.homeAway === 'Away' ? '@' : 'vs'} ${escapeHtml(g.opponent || 'TBD')} (${g.ourScore}-${g.oppScore})</option>`).join('') : '<option value="">No completed games yet</option>'}
          </select>
        </label>
        <label class="drillFieldLabel" style="margin-top:12px;">What happened
          <div class="helpText" style="margin:2px 0 6px;">Two or three sentences. First names only, and only what a parent would be glad to read.</div>
          <textarea class="drillFreeInput" id="ssDesc" style="min-height:80px;resize:vertical;" placeholder="Down two in the last inning, the whole lineup put the ball in play and we walked it off."></textarea>
        </label>
        <label class="drillFieldLabel" style="margin-top:12px;">Sponsor to thank <span style="text-transform:none;font-weight:400;">(optional)</span>
          <input class="drillFreeInput" id="ssSponsor" placeholder="Sponsor name">
        </label>
        <label class="drillFieldLabel" style="margin-top:12px;">Photo</label>
        <div class="ssDrop" id="ssDrop">
          <div class="ssDropIcon">🏆</div>
          <div class="ssDropTitle" id="ssDropTitle">Tap to add a photo</div>
          <div class="helpText" id="ssDropHint">A team shot or a moment from the game</div>
        </div>
        <input id="ssPhoto" type="file" accept="image/*" style="display:none;">
        <div class="sectionLabel" style="margin-top:18px;">The post</div>
        <div class="ssPostCard">
          <div class="ssPostWho">
            <div class="ssPostAvatar">${escapeHtml((team || 'LY').slice(0, 2).toUpperCase())}</div>
            <div>
              <div class="ssPostName">${escapeHtml(team)}</div>
              <div class="helpText" style="margin:0;">Draft · Facebook &amp; Instagram</div>
            </div>
          </div>
          <div id="ssCaption" style="white-space:pre-wrap;font-size:14px;line-height:1.5;margin-top:10px;"></div>
          <img id="ssShot" alt="" style="display:none;width:100%;border-radius:10px;margin-top:10px;">
        </div>
        <div class="helpText" id="ssCount"></div>
        <div class="sectionHeader" style="margin-top:12px;">
          <button class="btn btnGhost" id="ssCopy">Copy caption</button>
          <button class="btn btnGhost" id="ssSavePhoto">Save photo</button>
        </div>
        <button class="btn" id="ssSend" style="width:100%;margin-top:10px;">File in the league's review queue</button>
        <div class="helpText" id="ssMsg" style="margin-top:10px;"></div>`;

      const gameSel = containerEl.querySelector('#ssGame');
      gameSel.value = selectedGameId;
      gameSel.addEventListener('change', () => { selectedGameId = gameSel.value; refreshPreview(); });
      containerEl.querySelector('#ssDesc').addEventListener('input', refreshPreview);
      containerEl.querySelector('#ssSponsor').addEventListener('input', refreshPreview);

      const drop = containerEl.querySelector('#ssDrop');
      const fileInput = containerEl.querySelector('#ssPhoto');
      drop.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        photoName = file.name;
        shrink(file, 1600, 0.85).then(({ dataUrl }) => {
          photoData = dataUrl;
          drop.classList.add('ssDropHas');
          containerEl.querySelector('#ssDropTitle').textContent = 'Photo ready';
          containerEl.querySelector('#ssDropHint').textContent = file.name.slice(0, 40);
          const shot = containerEl.querySelector('#ssShot');
          shot.src = dataUrl; shot.style.display = 'block';
          refreshPreview();
        }).catch(() => say('Could not read that photo -- try another.', false));
      });

      function say(text, good) {
        const m = containerEl.querySelector('#ssMsg');
        m.textContent = text;
        m.style.color = good ? '#5fd989' : '#ff8a8a';
      }

      containerEl.querySelector('#ssCopy').addEventListener('click', async () => {
        const text = captionText();
        try {
          if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); say('Caption copied.', true); return; }
        } catch (e) { /* fall through */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:-9999px;';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        say(ok ? 'Caption copied.' : 'Could not copy automatically -- select the text above and copy it.', ok);
      });

      containerEl.querySelector('#ssSavePhoto').addEventListener('click', () => {
        if (!photoData) { say('Add a photo first.', false); return; }
        const a = document.createElement('a');
        a.href = photoData;
        const g = currentGame();
        a.download = `LYBS-${team.replace(/[^A-Za-z0-9]+/g, '-')}-${g ? g.date : new Date().toISOString().slice(0, 10)}.jpg`;
        a.click();
        say('Photo saved -- attach it in Business Suite.', true);
      });

      containerEl.querySelector('#ssSend').addEventListener('click', async btnEvt => {
        if (!photoData) { say('Add a photo before filing it.', false); return; }
        if (ENDPOINT.startsWith('PASTE')) { say('Not connected to the league drive yet -- the caption and photo buttons above still work.', false); return; }
        btnEvt.target.disabled = true;
        btnEvt.target.textContent = 'Sending...';
        const g = currentGame();
        const result = await send({
          token: FORM_TOKEN, kind: 'win', photo: photoData, filename: photoName,
          team, division, location: g ? g.location : '', description: captionText(),
          submitter: '', // identity isn't collected here; the coach's name is already known from their session, not worth re-asking
        });
        say(result.ok ? (result.message || 'Filed in the league drive queue.') : result.message, result.ok);
        btnEvt.target.disabled = false;
        btnEvt.target.textContent = 'File in the league\'s review queue';
      });

      refreshPreview();
    },
  };
})();
