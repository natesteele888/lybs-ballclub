/* ============================================================
   Team Sponsor -- the "Sponsored by" spot on this team's Home card.

   Sponsors are board business; nothing else in this app shows them.
   The one exception is this: the sponsor (or sponsors) the board lined
   up with this team for the season, by name and logo, on the team's
   own page. That comes from the LYBS Sponsors app's backend
   (natesteele888/sponsor-banner-inventory, apps-script, action
   teamPageSponsor), asked with this device's own Ballclub sign-in.
   It answers only for someone Ballclub lets see this team (the same
   people database.rules.json lets read teams/{teamId}), and only with
   names and logos -- never contacts, levels, money or notes. Nothing
   is saved: the answer lives in memory for this page load only.

   No sponsor, no answer, a refusal or no signal: the spot stays empty
   and hidden, so the Home card looks exactly as it did before.
   ============================================================ */
(function () {
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbyY2MHbPp37YtO1nPDm_kJwL6GFW4gkZhP_4OSD1UFqkHwt6n2o2yomQCG6tSjTQ83y/exec';
  const OK_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const cache = {}; // teamId -> promise of [{name, image}]

  function load(teamId) {
    if (cache[teamId]) return cache[teamId];
    cache[teamId] = (async () => {
      if (window.__isMockBackend && window.__isMockBackend()) return [];
      if (!window.getFirebaseIdToken) return [];
      try {
        const idToken = await window.getFirebaseIdToken();
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ action: 'teamPageSponsor', teamId, idToken }),
        });
        const data = await res.json();
        if (!data || !data.ok || !Array.isArray(data.sponsors)) return [];
        return data.sponsors.slice(0, 3).map(s => ({
          name: String((s && s.name) || '').trim().slice(0, 120),
          image: s && s.image && OK_MIME.includes(s.image.mime) && /^[A-Za-z0-9+/=]+$/.test(String(s.image.base64 || ''))
            ? 'data:' + s.image.mime + ';base64,' + s.image.base64 : '',
        })).filter(s => s.name);
      } catch (e) { return []; }
    })();
    cache[teamId].then(list => { if (!list.length) delete cache[teamId]; });
    return cache[teamId];
  }

  window.TeamSponsor = {
    async render(slotEl, teamId) {
      if (!slotEl) return;
      slotEl.innerHTML = '';
      slotEl.hidden = true;
      const list = await load(teamId);
      if (!list.length || !slotEl.isConnected) return;
      slotEl.innerHTML = `
        <div class="teamSponsorLabel">Sponsored by</div>
        <div class="teamSponsorList">
          ${list.map(s => `
            <div class="teamSponsorItem">
              ${s.image ? `<img class="teamSponsorLogo" src="${s.image}" alt="${escapeHtml(s.name)} logo">` : ''}
              <div class="teamSponsorName">${escapeHtml(s.name)}</div>
            </div>`).join('')}
        </div>`;
      slotEl.hidden = false;
    },
  };
})();
