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

      function renderOfficials() {
        const rows = cache.governance.officials.map(o => `
          <div class="listRow" style="cursor:default;">
            <div class="listRowMain">
              <div class="listRowTitle">${escapeHtml(o.name)}</div>
              <div class="listRowSub">${escapeHtml(o.town)}</div>
            </div>
            <span class="badge" style="background:rgba(76,106,235,0.15);color:#AFC0FF;border:1px solid rgba(76,106,235,0.3);">${escapeHtml(o.role)}</span>
          </div>`).join('');
        return `
          <div class="helpText">League-wide questions: <a href="mailto:${escapeHtml(cache.governance.administratorEmail)}">${escapeHtml(cache.governance.administratorEmail)}</a>. ${escapeHtml(cache.governance.note)}</div>
          <div class="listBody" style="margin-top:10px;">${rows}</div>`;
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
      ];

      function renderAll() {
        containerEl.innerHTML = `
          <div class="helpText">Mirrored from macleague.org -- field addresses, league dates, officials, and age cutoffs in one place.</div>
          ${sections.map(s => `
            <div class="detailCard" style="margin-bottom:12px;">
              <div class="leagueInfoHeader" data-id="${s.id}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
                <h3 style="margin:0;">${escapeHtml(s.title)}</h3>
                <span style="color:var(--text2);font-size:20px;line-height:1;">${expanded === s.id ? '&minus;' : '+'}</span>
              </div>
              ${expanded === s.id ? `<div style="margin-top:14px;">${s.run()}</div>` : ''}
            </div>`).join('')}
          <div class="helpText" style="margin-top:4px;">${escapeHtml(cache.source)}</div>`;
        containerEl.querySelectorAll('.leagueInfoHeader').forEach(el => {
          el.addEventListener('click', () => {
            expanded = expanded === el.dataset.id ? null : el.dataset.id;
            renderAll();
          });
        });
      }
      renderAll();
    },
  };
})();
