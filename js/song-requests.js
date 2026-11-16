/* ============================================================
   Walk-up song requests -- a family asks for their player's walk-up
   song from the Roster tab, a coach approves it in one tap (or
   declines with a note), and only an approved song is ever the
   player's song. Walk-Up (natesteele888/apps, walkup/) picks up the
   approved songs and the pending count from here.

   Where things live (every path behind team sign-in, see
   database.rules.json -- nothing here is public, and no song or name
   is ever committed to this repo):
     teams/{teamId}/songRequests/{rid}  one request:
       { pid, kind: 'library'|'link'|'upload', lib?, link?, file?,
         title, start (seconds), st: 'pending'|'approved'|'declined',
         note?, by (the name the asker gave), at, decidedAt? }
       Anyone on the team may add a pending one; only a coach changes it.
     teams/{teamId}/walkupSongs/{pid}   the approved song for a player
       (same shape minus st/note). Coach-only, so the old song stays
       until a coach approves a new one.
     songFiles/{teamId}/{fileId}        an uploaded song, as base64
       { type, name, size, data }. Its own top-level tree so loading
       the team never pulls megabytes of audio, and the offline copies
       in backend.js never try to hold it.
     walkupLibrary/{id}, walkupLibraryFiles/{id}
       the league library: songs board members upload for every team.
       Readable by anyone signed in to a team (not the anonymous
       public view); writable by board members only.
     pushSubs/{teamId}/coach/{key}, pushSubs/{teamId}/req/{rid}/{key}
       Web Push subscriptions: coaches hear about new requests, the
       asker hears the answer. Written by the app, read only by
       functions/index.js.

   Uploads are capped at MAX_FILE (7 MB): a Realtime Database string
   tops out at 10 MB and base64 adds a third. Most MP3s are far under.
   ============================================================ */
(function () {
  const MAX_FILE = 7 * 1024 * 1024;
  const PUSH_KEY_URL = 'https://us-central1-lybs-ballclub.cloudfunctions.net/pushKey';
  const cache = {}; // teamId -> { requests: {rid: r}, songs: {pid: s} }
  const pending = {};
  let library = null; // { id: {title, type, size, at} }

  const esc = s => window.escapeHtml(s == null ? '' : String(s));
  const now = () => new Date().toISOString();

  /* ---------- small pure pieces (also used by tests/song-requests.test.js) ---------- */
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  // "1:05", "65", "1m5s" -> 65; anything else -> null
  function parseClock(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return 0;
    let m = /^(\d{1,2}):([0-5]?\d)(?:\.\d+)?$/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /^(\d{1,3})(?:\.\d+)?$/.exec(t);
    if (m) return Number(m[1]);
    return null;
  }
  function cleanLink(text) {
    const t = String(text || '').trim();
    if (t.length > 500) return null;
    try {
      const u = new URL(t);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (e) { return null; }
  }
  function cleanTitle(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
  // newest request per player, so the roster shows where each player stands
  function latestByPlayer(requests) {
    const out = {};
    Object.keys(requests || {}).forEach(rid => {
      const r = requests[rid]; if (!r || !r.pid) return;
      const cur = out[r.pid];
      if (!cur || String(r.at || '') > String(cur.at || '')) out[r.pid] = Object.assign({ rid }, r);
    });
    return out;
  }
  function pendingList(requests) {
    return Object.keys(requests || {}).map(rid => Object.assign({ rid }, requests[rid]))
      .filter(r => r.st === 'pending').sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  }
  // what a request becomes once approved: the player's walk-up song
  function approvedSong(r) {
    const s = { kind: r.kind, title: r.title, start: Number(r.start) || 0, at: now(), rid: r.rid || null };
    if (r.kind === 'library') s.lib = r.lib;
    if (r.kind === 'link') s.link = r.link;
    if (r.kind === 'upload') s.file = r.file;
    return s;
  }
  function playerLabel(p) {
    if (!p) return 'A player';
    const first = String(p.name || '').trim().split(/\s+/)[0] || '';
    return (p.number ? '#' + p.number + ' ' : '') + first || 'A player';
  }

  /* ---------- reads and writes ---------- */
  const DB = () => window.FIREBASE_DB_URL;
  const mock = () => !DB() || DB() === 'MOCK';
  // a song file is read straight from the database: never through dbGet, whose offline copy would try to keep megabytes in localStorage
  async function getFile(path) {
    if (mock()) return window.dbGet(path);
    const res = await fetch(await window.firebaseAuthed(`${DB()}/${path}.json`));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function putFile(path, value) {
    if (mock()) return window.dbPut(path, value);
    const res = await fetch(await window.firebaseAuthed(`${DB()}/${path}.json`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return value;
  }
  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }
  function blobUrl(rec) {
    if (!rec || !rec.data) return null;
    const bin = atob(rec.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: rec.type || 'audio/mpeg' }));
  }

  async function ensureLoaded(teamId) {
    if (cache[teamId]) return cache[teamId];
    if (pending[teamId]) return pending[teamId];
    pending[teamId] = (async () => {
      try {
        const [requests, songs] = await Promise.all([
          window.dbGet(window.teamPath(teamId, 'songRequests')).catch(() => null),
          window.dbGet(window.teamPath(teamId, 'walkupSongs')).catch(() => null),
        ]);
        cache[teamId] = { requests: requests || {}, songs: songs || {} };
        return cache[teamId];
      } finally { delete pending[teamId]; }
    })();
    return pending[teamId];
  }
  async function reload(teamId) { delete cache[teamId]; return ensureLoaded(teamId); }
  async function ensureLibrary(force) {
    if (library && !force) return library;
    try { library = (await window.dbGet('walkupLibrary')) || {}; } catch (e) { library = {}; }
    return library;
  }

  /* ---------- the form ---------- */
  let previewUrl = null, previewAudio = null;
  function stopPreview() {
    if (previewAudio) { try { previewAudio.pause(); } catch (e) {} }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewAudio = null;
  }
  function closeModal() { stopPreview(); const x = document.getElementById('infoModalClose'); if (x) x.click(); }

  // opts: { isCoach, byName, onDone }
  async function openForm(teamId, player, opts) {
    opts = opts || {};
    const lib = await ensureLibrary();
    const libIds = Object.keys(lib).sort((a, b) => String(lib[a].title).localeCompare(String(lib[b].title)));
    const cur = (cache[teamId] && cache[teamId].songs[player.id]) || null;
    const libOpts = libIds.map(id => `<option value="${esc(id)}">${esc(lib[id].title)}</option>`).join('');
    window.openInfoModal(`Walk-up song for ${playerLabel(player)}`, `
      <div class="srForm" id="srForm">
        ${cur ? `<p class="srNow">Now: <b>${esc(cur.title)}</b>${cur.start ? ' from ' + fmtClock(cur.start) : ''}. It stays until a coach approves a new one.</p>` : ''}
        <div class="srKinds" role="radiogroup" aria-label="Where the song comes from">
          ${libIds.length ? '<label><input type="radio" name="srKind" value="library" checked> League library</label>' : ''}
          <label><input type="radio" name="srKind" value="upload" ${libIds.length ? '' : 'checked'}> Upload a song</label>
          <label><input type="radio" name="srKind" value="link"> Paste a link</label>
        </div>
        <div data-kind="library" ${libIds.length ? '' : 'hidden'}><label>Song<select id="srLib">${libOpts}</select></label></div>
        <div data-kind="upload" ${libIds.length ? 'hidden' : ''}><label>Song file (MP3, M4A or WAV, up to 7 MB)<input type="file" id="srFile" accept="audio/*"></label></div>
        <div data-kind="link" hidden>
          <label>Link to the song<input id="srLink" type="url" inputmode="url" placeholder="Paste from YouTube, Spotify or Apple Music"></label>
          <label>Song name<input id="srTitle" maxlength="120" placeholder="Artist - Song"></label>
        </div>
        <div class="srStart">
          <label>Start the song at<input id="srStart" value="0:00" inputmode="numeric" aria-describedby="srStartHint"></label>
          <input type="range" id="srStartRange" min="0" max="300" step="1" value="0" aria-label="Start the song at">
          <div class="srHint" id="srStartHint">Where the song kicks in, in minutes and seconds.</div>
          <button type="button" class="btn btnGhost btnSmall" id="srPreview">Play from here</button>
          <audio id="srAudio" preload="metadata" hidden></audio>
        </div>
        ${opts.isCoach ? '' : `<label>Your name<input id="srBy" maxlength="60" value="${esc(opts.byName || '')}" placeholder="So the coach knows who asked"></label>`}
        <div class="detailActions">
          <button class="btn" id="srSend">${opts.isCoach ? 'Set this song' : 'Send to the coach'}</button>
        </div>
        <p class="srHint">${opts.isCoach ? 'Sets the song now, with no approval step.' : 'The coach approves it before it plays. You can turn on an alert for the answer after you send.'}</p>
      </div>`);
    const el = document.getElementById('srForm');
    const $ = s => el.querySelector(s);
    const audio = $('#srAudio');
    previewAudio = audio;
    const kind = () => (el.querySelector('input[name=srKind]:checked') || {}).value;
    let fileRec = null, libRec = {}; // what the preview plays

    function showKind() {
      el.querySelectorAll('[data-kind]').forEach(d => { d.hidden = d.dataset.kind !== kind(); });
      $('#srPreview').textContent = kind() === 'link' ? 'Open the link' : 'Play from here';
      setSource();
    }
    function setStart(sec, from) {
      sec = Math.max(0, Math.min(Number($('#srStartRange').max) || 600, Math.round(sec)));
      if (from !== 'text') $('#srStart').value = fmtClock(sec);
      if (from !== 'range') $('#srStartRange').value = String(sec);
    }
    async function setSource() {
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      audio.removeAttribute('src');
      let rec = null;
      if (kind() === 'upload') rec = fileRec;
      if (kind() === 'library') {
        const id = $('#srLib').value;
        if (id && !libRec[id]) {
          $('#srPreview').disabled = true; $('#srPreview').textContent = 'Loading...';
          try { libRec[id] = await getFile('walkupLibraryFiles/' + id); } catch (e) { libRec[id] = null; }
          $('#srPreview').disabled = false; $('#srPreview').textContent = 'Play from here';
          if (kind() !== 'library' || $('#srLib').value !== id) return;
        }
        rec = id ? libRec[id] : null;
      }
      if (rec) { previewUrl = blobUrl(rec); audio.src = previewUrl; }
    }
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration) && audio.duration > 1) { $('#srStartRange').max = String(Math.floor(audio.duration - 1)); setStart(parseClock($('#srStart').value) || 0); }
    });
    el.querySelectorAll('input[name=srKind]').forEach(r => r.addEventListener('change', showKind));
    const libSel = $('#srLib'); if (libSel) libSel.addEventListener('change', setSource);
    $('#srFile').addEventListener('change', async () => {
      const f = $('#srFile').files[0]; fileRec = null;
      if (!f) return setSource();
      if (f.size > MAX_FILE) { window.showToast('That file is over 7 MB. Try a shorter clip or an MP3.'); $('#srFile').value = ''; return setSource(); }
      if (f.type && !/^audio\//.test(f.type)) { window.showToast('That file isn\'t a song file.'); $('#srFile').value = ''; return setSource(); }
      fileRec = { type: f.type || 'audio/mpeg', name: f.name.slice(0, 120), size: f.size, data: await readAsBase64(f) };
      setSource();
    });
    $('#srStart').addEventListener('input', () => { const s = parseClock($('#srStart').value); if (s != null) setStart(s, 'text'); });
    $('#srStartRange').addEventListener('input', () => setStart(Number($('#srStartRange').value), 'range'));
    $('#srPreview').addEventListener('click', () => {
      if (kind() === 'link') {
        const link = cleanLink($('#srLink').value);
        if (!link) { window.showToast('Paste the song\'s link first.'); return; }
        window.open(link, '_blank', 'noopener');
        return;
      }
      if (!audio.src) { window.showToast(kind() === 'upload' ? 'Choose a song file first.' : 'Pick a song first.'); return; }
      if (!audio.paused) { audio.pause(); $('#srPreview').textContent = 'Play from here'; return; }
      audio.currentTime = parseClock($('#srStart').value) || 0;
      audio.play().then(() => { $('#srPreview').textContent = 'Stop'; }).catch(() => window.showToast('This phone couldn\'t play that file.'));
    });
    audio.addEventListener('pause', () => { if (document.getElementById('srPreview')) $('#srPreview').textContent = kind() === 'link' ? 'Open the link' : 'Play from here'; });

    $('#srSend').addEventListener('click', ev => window.withBusyButton(ev.target, opts.isCoach ? 'Saving...' : 'Sending...', async () => {
      const start = parseClock($('#srStart').value);
      if (start == null) { window.showToast('Write the start like 0:15.'); return; }
      const r = { pid: player.id, kind: kind(), start, st: opts.isCoach ? 'approved' : 'pending', at: now(), by: opts.isCoach ? 'Coach' : (cleanTitle($('#srBy').value).slice(0, 60) || 'A family') };
      if (r.kind === 'library') {
        const id = $('#srLib').value; if (!id || !lib[id]) { window.showToast('Pick a song first.'); return; }
        r.lib = id; r.title = cleanTitle(lib[id].title);
      } else if (r.kind === 'link') {
        r.link = cleanLink($('#srLink').value); if (!r.link) { window.showToast('Paste the song\'s link first.'); return; }
        r.title = cleanTitle($('#srTitle').value) || 'Song from a link';
      } else {
        if (!fileRec) { window.showToast('Choose a song file first.'); return; }
        r.file = window.uid('sf'); r.title = cleanTitle(fileRec.name.replace(/\.[a-z0-9]{2,4}$/i, '')) || 'Uploaded song';
      }
      const rid = window.uid('sr');
      try {
        if (r.kind === 'upload') await putFile(`songFiles/${teamId}/${r.file}`, fileRec);
        const up = {};
        up[`${window.teamPath(teamId, 'songRequests')}/${rid}`] = r;
        if (opts.isCoach) { r.decidedAt = r.at; up[`${window.teamPath(teamId, 'walkupSongs')}/${player.id}`] = approvedSong(Object.assign({ rid }, r)); }
        await window.dbUpdate(up);
      } catch (e) { window.showToast('Couldn\'t send that just now. Check your signal and try again.'); return; }
      await reload(teamId);
      closeModal();
      if (opts.isCoach) window.showToast(`${playerLabel(player)}'s walk-up song is set.`);
      else afterSend(teamId, rid, player);
      if (opts.onDone) opts.onDone();
    }));
    showKind();
  }

  function afterSend(teamId, rid, player) {
    window.openInfoModal('Sent to the coach', `
      <p>The coach will approve or decline ${esc(playerLabel(player))}'s song. Until then the old song stays.</p>
      ${pushSupported() ? '<button class="btn" id="srAlertMe">Tell me the answer on this phone</button>' : `<p class="srHint">${esc(pushHint())}</p>`}
      <p class="srHint">The answer also shows on the Roster tab.</p>`);
    const b = document.getElementById('srAlertMe');
    if (b) b.addEventListener('click', ev => window.withBusyButton(ev.target, 'Turning on...', async () => {
      if (await enableAlerts(teamId, { rid })) { closeModal(); window.showToast('You\'ll get an alert with the coach\'s answer.'); }
    }));
  }

  /* ---------- the roster ---------- */
  function cellHtml(teamId, p) {
    const c = cache[teamId] || { requests: {}, songs: {} };
    const last = latestByPlayer(c.requests)[p.id];
    const song = c.songs[p.id];
    let chip = '';
    if (last && last.st === 'pending') chip = '<span class="srChip warn">Waiting on coach</span>';
    else if (last && last.st === 'declined' && (!song || String(song.at || '') < String(last.decidedAt || last.at || ''))) chip = `<span class="srChip" title="${esc(last.note || '')}">Not approved${last.note ? ': ' + esc(last.note) : ''}</span>`;
    else if (song) chip = `<span class="srChip ok">${esc(song.title)}</span>`;
    return `${chip}<button type="button" class="btn btnGhost btnSmall srAsk" data-sr-pid="${esc(p.id)}" aria-label="Request walk-up song for ${esc(playerLabel(p))}">Request walk-up song</button>`;
  }
  function wireCells(teamId, el, players, opts) {
    el.querySelectorAll('[data-sr-pid]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const p = players.find(x => x.id === b.dataset.srPid); if (!p) return;
      openForm(teamId, p, { isCoach: !!opts.isCoach, byName: opts.byName, onDone: opts.onChange });
    }));
  }

  /* ---------- the coach's queue ---------- */
  function panelHtml(teamId, players, opts) {
    const c = cache[teamId] || { requests: {} };
    const list = pendingList(c.requests);
    const byId = {}; players.forEach(p => { byId[p.id] = p; });
    const rows = list.map(r => `
      <div class="srReq" data-rid="${esc(r.rid)}">
        <div class="srReqMain"><b>${esc(playerLabel(byId[r.pid]))}</b>: ${esc(r.title)}${r.start ? ' from ' + fmtClock(r.start) : ''}
          <div class="srHint">${esc(r.kind === 'library' ? 'League library' : r.kind === 'link' ? 'A link' : 'An uploaded file')} · asked by ${esc(r.by || 'a family')}</div></div>
        <div class="srReqBtns">
          <button type="button" class="btn btnGhost btnSmall" data-sr-do="hear">${r.kind === 'link' ? 'Open' : 'Play'}</button>
          <button type="button" class="btn btnSmall" data-sr-do="ok">Approve</button>
          <button type="button" class="btn btnGhost btnSmall" data-sr-do="no">Decline</button>
        </div>
      </div>`).join('');
    const share = location.origin + location.pathname.replace(/index\.html$/, '') + '#walkup-songs';
    return `
      <div class="detailCard srPanel" id="srPanel">
        <div class="srPanelHead"><b>Walk-up song requests${list.length ? ` <span class="srBadge">${list.length}</span>` : ''}</b></div>
        ${rows || '<div class="srHint">No requests waiting.</div>'}
        <div class="srPanelTools">
          <button type="button" class="btn btnGhost btnSmall" data-sr-do="share" data-link="${esc(share)}">Share the request link</button>
          ${pushSupported() ? '<button type="button" class="btn btnGhost btnSmall" data-sr-do="alerts">Alert me about requests</button>' : ''}
          ${opts.isBoard ? '<button type="button" class="btn btnGhost btnSmall" data-sr-do="library">League song library</button>' : ''}
        </div>
      </div>`;
  }
  function wirePanel(teamId, el, players, opts) {
    const panel = el.querySelector('#srPanel'); if (!panel) return;
    panel.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-sr-do]'); if (!b) return;
      const d = b.dataset.srDo, row = b.closest('[data-rid]'), rid = row && row.dataset.rid;
      const r = rid ? Object.assign({ rid }, (cache[teamId].requests || {})[rid]) : null;
      if (d === 'share') return shareLink(b.dataset.link);
      if (d === 'alerts') return window.withBusyButton(b, 'Turning on...', async () => { if (await enableAlerts(teamId, 'coach')) window.showToast('This phone will get an alert for each new request.'); });
      if (d === 'library') return openLibrary();
      if (!r) return;
      if (d === 'hear') return hear(teamId, r);
      if (d === 'ok') return window.withBusyButton(b, 'Approving...', async () => {
        const up = {}, base = `${window.teamPath(teamId, 'songRequests')}/${rid}`, at = now();
        up[base + '/st'] = 'approved'; up[base + '/decidedAt'] = at;
        up[`${window.teamPath(teamId, 'walkupSongs')}/${r.pid}`] = approvedSong(r);
        try { await window.dbUpdate(up); } catch (e) { return; }
        stopPreview(); await reload(teamId); if (opts.onChange) opts.onChange();
      });
      if (d === 'no') {
        if (!(await window.confirmModal(`Decline "${r.title}"? The old song stays.`))) return;
        const note = (await window.promptModal('A short note for the family (optional), like "Pick a clean version".', '')) || '';
        const up = {}, base = `${window.teamPath(teamId, 'songRequests')}/${rid}`;
        up[base + '/st'] = 'declined'; up[base + '/decidedAt'] = now(); up[base + '/note'] = String(note).trim().slice(0, 300);
        try { await window.dbUpdate(up); } catch (e) { return; }
        stopPreview(); await reload(teamId); if (opts.onChange) opts.onChange();
      }
    });
  }
  async function hear(teamId, r) {
    if (r.kind === 'link') { window.open(r.link, '_blank', 'noopener'); return; }
    stopPreview();
    let rec = null;
    try { rec = await getFile(r.kind === 'library' ? 'walkupLibraryFiles/' + r.lib : `songFiles/${teamId}/${r.file}`); } catch (e) {}
    if (!rec) { window.showToast('Couldn\'t load that song just now.'); return; }
    previewUrl = blobUrl(rec); previewAudio = new Audio(previewUrl);
    previewAudio.currentTime = Number(r.start) || 0;
    previewAudio.addEventListener('loadedmetadata', () => { previewAudio.currentTime = Number(r.start) || 0; }, { once: true });
    previewAudio.play().catch(() => window.showToast('This phone couldn\'t play that file.'));
  }
  async function shareLink(link) {
    const text = 'Request your player\'s walk-up song here (sign in with the team code, then tap Request walk-up song on the Roster): ' + link;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text); window.showToast('Copied the request link.');
    } catch (e) { if (e && e.name !== 'AbortError') window.showToast(link); }
  }

  /* ---------- the league library (board members) ---------- */
  async function openLibrary() {
    const lib = await ensureLibrary(true);
    const ids = Object.keys(lib).sort((a, b) => String(lib[a].title).localeCompare(String(lib[b].title)));
    window.openInfoModal('League song library', `
      <div id="srLibAdmin">
        <p class="srHint">Songs here can be picked by every team's families. Use clean versions. They stay behind sign-in, never on a public page or in GitHub.</p>
        ${ids.map(id => `<div class="srReq" data-lid="${esc(id)}"><div class="srReqMain">${esc(lib[id].title)}</div><button type="button" class="btn btnGhost btnSmall" data-lib-del>Remove</button></div>`).join('') || '<div class="srHint">No songs yet.</div>'}
        <label>Add songs (up to 7 MB each)<input type="file" id="srLibFiles" accept="audio/*" multiple></label>
      </div>`);
    const el = document.getElementById('srLibAdmin');
    el.querySelector('#srLibFiles').addEventListener('change', async ev => {
      const files = Array.from(ev.target.files || []); let added = 0;
      for (const f of files) {
        if (f.size > MAX_FILE || (f.type && !/^audio\//.test(f.type))) { window.showToast(`Skipped ${f.name}: not a song file under 7 MB.`); continue; }
        const id = window.uid('lib'), rec = { type: f.type || 'audio/mpeg', name: f.name.slice(0, 120), size: f.size, data: await readAsBase64(f) };
        try {
          await putFile('walkupLibraryFiles/' + id, rec);
          await window.dbPut('walkupLibrary/' + id, { title: cleanTitle(f.name.replace(/\.[a-z0-9]{2,4}$/i, '')) || 'Song', type: rec.type, size: f.size, at: now() });
          added++;
        } catch (e) { window.showToast(`Couldn't add ${f.name}.`); }
      }
      if (added) { window.showToast(`Added ${added} ${added === 1 ? 'song' : 'songs'}.`); openLibrary(); }
    });
    el.querySelectorAll('[data-lib-del]').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('[data-lid]').dataset.lid;
      if (!(await window.confirmModal(`Remove "${lib[id].title}" from the league library? Players who already have it approved keep it until it's gone from their phone.`))) return;
      try { await window.dbUpdate({ ['walkupLibrary/' + id]: null, ['walkupLibraryFiles/' + id]: null }); } catch (e) { return; }
      openLibrary();
    }));
  }

  /* ---------- alerts (Web Push, sent by functions/index.js) ---------- */
  function isIos() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function standalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function pushHint() {
    if (isIos() && !standalone()) return 'On iPhone, alerts work once Ballclub is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.';
    return 'This browser can\'t show alerts. The answer shows on the Roster tab.';
  }
  function b64urlToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function subKey(endpoint) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(h)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // target: 'coach', or { rid } for the answer to one request
  async function enableAlerts(teamId, target) {
    if (!pushSupported()) { window.showToast(pushHint()); return false; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { window.showToast('Alerts are off for Ballclub in this browser\'s settings.'); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = (await (await fetch(PUSH_KEY_URL)).text()).trim();
        if (!/^[A-Za-z0-9_-]{80,100}$/.test(key)) throw new Error('no push key');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
      }
      const k = await subKey(sub.endpoint), rec = { sub: sub.toJSON(), at: now() };
      const path = target === 'coach' ? `pushSubs/${teamId}/coach/${k}` : `pushSubs/${teamId}/req/${target.rid}/${k}`;
      await window.dbPut(path, rec);
      return true;
    } catch (e) {
      window.showToast('Couldn\'t turn on alerts just now.');
      return false;
    }
  }

  window.SongRequests = {
    MAX_FILE, ensureLoaded, reload, ensureLibrary, openForm, cellHtml, wireCells, panelHtml, wirePanel, enableAlerts, openLibrary,
    _test: { fmtClock, parseClock, cleanLink, cleanTitle, latestByPlayer, pendingList, approvedSong, playerLabel },
  };
})();
