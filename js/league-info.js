/* ============================================================
   League Info -- field addresses/map links, important dates,
   league officials, and age-cutoff tables, mirrored from
   macleague.org's About section (data/league-info.json). Static
   reference content: the league publishes it, we don't edit it
   here, so unlike rules.js this never mirrors into shared/ -- a
   plain fetch is enough, same as club-logos.js's static town list.

   Only the league-wide administrator email is included from the
   officials list -- no per-town personal phone numbers or emails,
   even though some town pages on macleague.org show them for their
   own reps. Not ours to republish.
   ============================================================ */
(function () {
  let cache = null; // league-info.json contents

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function mapUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
  // Google's documented consumer Maps URL for opening Street View at a
  // point -- no API key needed. lat/lng come from a one-time geocode of
  // each address -- see scripts/geocode-facilities.mjs.
  function streetViewUrl(lat, lng) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  }

  window.LeagueInfo = {
    async ensureLoaded() {
      if (cache) return cache;
      cache = await fetch('data/league-info.json?v=' + window.BUILD_V).then(r => r.json()).catch(() => null);
      return cache;
    },

    render(containerEl) {
      if (!cache) {
        containerEl.innerHTML = '<div class="emptyState">League info isn\'t available right now.</div>';
        return;
      }
      let expanded = 'fields';

      function fieldRow(f) {
        const badge = window.ClubLogos.badgeHtml(f.town, 44);
        const hasCoords = f.lat != null && f.lng != null;
        return `
          <div class="listRow" style="cursor:default;">
            ${badge || '<div class="fieldBadgeFallback">' + escapeHtml((f.town || '?').trim().charAt(0).toUpperCase()) + '</div>'}
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(f.name)}</div>
              <div class="listRowSub">${escapeHtml(f.town)} &middot; ${escapeHtml(f.address)}</div>
            </div>
            <div class="fieldRowLinks">
              <a class="btn btnGhost btnTiny" href="${mapUrl(f.address)}" target="_blank" rel="noopener">Map</a>
              ${hasCoords ? `<a class="btn btnGhost btnTiny" href="${streetViewUrl(f.lat, f.lng)}" target="_blank" rel="noopener">Street View</a>` : ''}
            </div>
          </div>`;
      }

      function renderFields() {
        const home = cache.facilities.filter(f => f.home);
        const others = cache.facilities.filter(f => !f.home);
        return `
          <div class="sectionLabel">Lunenburg home fields</div>
          <div class="listBody">${home.map(fieldRow).join('')}</div>
          <div class="helpText" style="margin-top:14px;">${cache.facilityRules.map(r => `&bull; ${escapeHtml(r)}`).join('<br>')}</div>
          <div class="sectionLabel" style="margin-top:18px;">Other league fields</div>
          <div class="listBody">${others.map(fieldRow).join('')}</div>`;
      }

      function renderDates() {
        const statusBadge = (status) => {
          if (status === 'current') return '<span class="badge badgeW">Current</span>';
          if (status === 'draft') return '<span class="badge" style="background:rgba(180,187,191,0.15);color:#B4BBBF;border:1px solid rgba(180,187,191,0.3);">Draft</span>';
          return '';
        };
        return cache.seasons.map(s => `
          <div style="margin-bottom:18px;">
            <div class="sectionLabel" style="display:flex;align-items:center;gap:8px;">${escapeHtml(s.label)} ${statusBadge(s.status)}</div>
            <div class="helpText">${s.items.map(i => `&bull; ${escapeHtml(i)}`).join('<br>')}</div>
          </div>`).join('');
      }

      // Grouped by town (one header + badge per town) instead of one flat
      // list repeating the same badge/town name on every row -- a league
      // with ~10 member towns reads a lot faster as "who represents each
      // town" than as 20-odd rows with no visual separation between them.
      function renderOfficials() {
        const officials = cache.governance.officials;
        const byTown = {};
        const townOrder = [];
        officials.forEach(o => {
          if (!byTown[o.town]) { byTown[o.town] = []; townOrder.push(o.town); }
          byTown[o.town].push(o);
        });
        const groups = townOrder.map(town => {
          const badge = window.ClubLogos.badgeHtml(town, 24);
          const rows = byTown[town].map(o => `
            <div class="listRow" style="cursor:default;">
              <div class="listRowMain"><div class="listRowTitle">${escapeHtml(o.name)}</div></div>
              <span class="badge" style="background:rgba(76,106,235,0.15);color:#AFC0FF;border:1px solid rgba(76,106,235,0.3);">${escapeHtml(o.role)}</span>
            </div>`).join('');
          return `
            <div style="margin-bottom:16px;">
              <div class="sectionLabel" style="display:flex;align-items:center;gap:8px;">
                ${badge || `<div class="fieldBadgeFallback" style="width:24px;height:24px;font-size:11px;">${escapeHtml((town || '?').trim().charAt(0).toUpperCase())}</div>`}
                ${escapeHtml(town)}
              </div>
              <div class="listBody" style="margin-top:6px;">${rows}</div>
            </div>`;
        }).join('');
        return `
          <div class="helpText">League-wide questions: <a href="mailto:${escapeHtml(cache.governance.administratorEmail)}">${escapeHtml(cache.governance.administratorEmail)}</a>. ${escapeHtml(cache.governance.note)}</div>
          <div style="margin-top:10px;">${groups}</div>`;
      }

      // Links to macleague.org pages that aren't worth mirroring here --
      // either because rules.js already carries the full text (every other
      // item in the site's own Resources menu: Operating Guidelines,
      // Rookies/General/Minors/Majors/Junior & Senior/Playoff Rules, All
      // Stars Information), or because the content is inherently a
      // macleague.org/Crossbar function (accepting a team invite) that this
      // app has nothing to add to. Link out rather than duplicate.
      function renderResources() {
        const links = [
          { label: 'Coaches Meetings', desc: 'Dates and info for league coaches meetings.', url: 'https://www.macleague.org/coaching-resources/coaches-meetings/10779' },
          { label: 'HowTo -- Accept Invite', desc: "Crossbar's own guide to accepting a team invite as a coach or player.", url: 'https://www.macleague.org/coaching-resources/howto-accept-invite/167551' },
        ];
        return `
          <div class="helpText">Rules content (Majors, Minors, Rookies, Juniors &amp; Seniors, General, Playoff, All-Stars, Operating Guidelines) lives in full under the Rules tab. These two don't have an in-app equivalent, so they link straight to macleague.org.</div>
          <div class="listBody" style="margin-top:10px;">
            ${links.map(l => `
              <a class="listRow" href="${l.url}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
                <div class="listRowMain">
                  <div class="listRowTitle">${escapeHtml(l.label)}</div>
                  <div class="listRowSub">${escapeHtml(l.desc)}</div>
                </div>
                <span style="color:var(--text2);">&rarr;</span>
              </a>`).join('')}
          </div>`;
      }

      function renderAges() {
        const yr = cache.leagueAges['2026'];
        return `
          <div class="helpText">${escapeHtml(cache.leagueAges.note)}</div>
          <div class="listBody" style="margin-top:10px;">
            ${yr.map(a => `
              <div class="listRow" style="cursor:default;">
                <div class="listRowMain"><div class="listRowTitle">${escapeHtml(a.division)}</div></div>
                <div class="listRowSub">${escapeHtml(a.range)}</div>
              </div>`).join('')}
          </div>`;
      }

      const sections = [
        { id: 'fields', title: 'Fields & Facilities', run: renderFields },
        { id: 'dates', title: 'Important Dates', run: renderDates },
        { id: 'officials', title: 'League Officials', run: renderOfficials },
        { id: 'ages', title: 'League Ages (2026)', run: renderAges },
        { id: 'resources', title: 'Resources', run: renderResources },
      ];

      function renderAll() {
        const current = sections.find(s => s.id === expanded) || sections[0];
        containerEl.innerHTML = `
          <div class="helpText">Mirrored from macleague.org -- field addresses, league dates, officials, and age cutoffs in one place.</div>
          <div class="leagueSectionTabs">
            ${sections.map(s => `<button class="tabBtn ${s.id === current.id ? 'active' : ''}" data-id="${s.id}">${escapeHtml(s.title)}</button>`).join('')}
          </div>
          <div class="detailCard">${current.run()}</div>
          <div class="helpText" style="margin-top:12px;">${escapeHtml(cache.source)}</div>`;
        containerEl.querySelectorAll('.leagueSectionTabs [data-id]').forEach(el => {
          el.addEventListener('click', () => {
            expanded = el.dataset.id;
            renderAll();
          });
        });
      }
      renderAll();
    },
  };
})();
