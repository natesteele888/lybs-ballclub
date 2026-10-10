/* ============================================================
   Stats Import -- parses a GameChanger "Export Stats" season-totals
   CSV (the official, sanctioned export: Team -> Stats -> Export
   Stats in the GameChanger app -- no API, no scraping, same "use
   the files GameChanger already gives you" boundary documented in
   js/team-page.js's header) and surfaces the same kind of "who
   should lead off, who's the best bat" insights a paid tool like
   gcstats.app computes from the same file, without a subscription
   or sending a roster anywhere -- parsing happens entirely in this
   browser tab.

   Column names are matched by GameChanger's own stat abbreviations
   (GP, PA, AB, AVG, OBP, SLG, OPS, ERA, BA/RSP, ...) rather than by
   position, since the exact column set in a real export can vary by
   what a coach has enabled. Whatever's present gets used; whatever's
   missing just means that one insight card doesn't show, instead of
   guessing or silently showing a wrong number.

   Privacy: GameChanger exports a player's full name -- this app
   never shows one anywhere else (see roster.js). Every parsed row is
   matched against this team's own roster (first name + last initial)
   by name; a confident match swaps in the roster's own name and id.
   An unmatched row is reduced to "First L" before it's ever rendered
   or stored -- same convention schedule.js's pitch-count log already
   uses (its "First L" placeholder) -- so a full last name from an
   uploaded file is never the thing that ends up on screen or in the
   database. "Save as new lineup" only places roster-matched rows
   into a lineup slot, since js/lineup-builder.js's slots are always
   a real roster player, never a free-typed name.

   Stored at teams/{teamId}/importedStats = {source, importedAt,
   battingRows, pitchingRows} -- a batting import and a pitching
   import (GameChanger exports them separately) merge into the same
   record rather than overwriting each other.
   ============================================================ */
(function () {
  // ---- CSV parsing -- hand-rolled, no build step / CDN dependency.
  // Handles quoted fields (commas and escaped "" inside quotes). ----
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (!(row.length === 1 && row[0] === '')) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // GameChanger's own stat abbreviations -- see help.gc.com's stat glossary.
  const COLUMN_ALIASES = {
    name: ['name', 'player', 'playername', 'player name'],
    gp: ['gp'], pa: ['pa'], ab: ['ab'], r: ['r'], h: ['h'],
    b2: ['2b'], b3: ['3b'], hr: ['hr'], rbi: ['rbi'], bb: ['bb'], so: ['so'],
    sb: ['sb'], cs: ['cs'], avg: ['avg'], obp: ['obp'], slg: ['slg'], ops: ['ops'],
    hbp: ['hbp'], sac: ['sac'], sf: ['sf'], barsp: ['ba/rsp', 'barsp'], psPerPa: ['ps/pa'],
    ip: ['ip'], er: ['er'], era: ['era'], w: ['w'], l: ['l'], sv: ['sv'], bf: ['bf'],
  };
  function normalizeHeader(h) {
    const clean = (h || '').trim().toLowerCase();
    for (const key in COLUMN_ALIASES) {
      if (COLUMN_ALIASES[key].includes(clean)) return key;
    }
    return null;
  }
  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  // Baseball innings-pitched notation: "5.2" means 5-and-2/3 innings, not
  // 5.2 decimal innings -- the digit after the dot is outs (0, 1 or 2).
  function ipToDecimal(ip) {
    if (ip == null) return null;
    const whole = Math.trunc(ip);
    const outs = Math.round((ip - whole) * 10);
    return whole + (outs === 1 ? 1 / 3 : outs === 2 ? 2 / 3 : 0);
  }

  function toFirstLastInitial(rawName) {
    const s = (rawName || '').trim();
    if (!s) return 'Unknown';
    let first, last;
    if (s.includes(',')) {
      const [l, f] = s.split(',').map(x => x.trim());
      last = l; first = (f || '').split(/\s+/)[0];
    } else {
      const parts = s.split(/\s+/).filter(Boolean);
      first = parts[0]; last = parts[parts.length - 1];
    }
    if (!first) return s;
    const initial = (last || '').charAt(0).toUpperCase();
    return initial && last !== first ? `${first} ${initial}` : first;
  }

  function matchRosterPlayer(rawName, roster) {
    const display = toFirstLastInitial(rawName);
    const [first, initial] = display.split(' ');
    return (roster || []).find(p => {
      const parts = (p.name || '').split(' ');
      return parts[0] && parts[0].toLowerCase() === (first || '').toLowerCase()
        && (parts[1] || '').toLowerCase() === (initial || '').toLowerCase();
    }) || null;
  }

  function parseRows(text, roster) {
    const table = parseCSV(text).filter(r => r.some(c => (c || '').trim() !== ''));
    if (!table.length) return { kind: null, rows: [] };
    const headerMap = table[0].map(normalizeHeader);
    const nameIdx = headerMap.indexOf('name');
    const hasPitching = headerMap.includes('era') || headerMap.includes('ip');
    const hasBatting = headerMap.includes('avg') || headerMap.includes('ab');
    const kind = hasPitching && !hasBatting ? 'pitching' : 'batting';

    const rows = table.slice(1).map(cells => {
      const rawName = nameIdx >= 0 ? cells[nameIdx] : '';
      if (!rawName) return null;
      const player = matchRosterPlayer(rawName, roster);
      const out = { name: player ? player.name : toFirstLastInitial(rawName), playerId: player ? player.id : null };
      headerMap.forEach((key, i) => {
        if (!key || key === 'name') return;
        out[key] = num(cells[i]);
      });
      return out;
    }).filter(Boolean);

    return { kind, rows };
  }

  // ---- Insights -- qualified pool first (enough AB/IP to mean something),
  // falls back to everyone if nobody clears the bar yet (small early-season
  // samples) rather than showing nothing at all. ----
  function battingInsights(rows) {
    const qualified = rows.filter(r => (r.ab || 0) >= 5 || (r.pa || 0) >= 5);
    const pool = qualified.length ? qualified : rows;
    const pick = (field, label, fmt) => {
      const withVal = pool.filter(r => r[field] != null);
      if (!withVal.length) return null;
      const best = withVal.slice().sort((a, b) => b[field] - a[field])[0];
      return { label, name: best.name, value: fmt(best[field]) };
    };
    const contactPick = () => {
      const withVal = pool.filter(r => r.ab > 0 && r.so != null);
      if (!withVal.length) return null;
      const best = withVal.slice().sort((a, b) => (a.so / a.ab) - (b.so / b.ab))[0];
      return { label: 'Best Contact', name: best.name, value: `${Math.round((1 - best.so / best.ab) * 100)}% contact` };
    };
    return [
      pick('ops', 'Best Hitter', v => `${v.toFixed(3)} OPS`) || pick('avg', 'Best Hitter', v => `${v.toFixed(3)} AVG`),
      pick('obp', 'Best Leadoff', v => `${v.toFixed(3)} OBP`),
      pick('slg', 'Best Power', v => `${v.toFixed(3)} SLG`),
      pick('sb', 'Best Speed Threat', v => `${v} SB`),
      contactPick(),
      pick('barsp', 'Best w/ RISP', v => `${v.toFixed(3)} AVG`),
    ].filter(Boolean);
  }

  function pitchingInsights(rows) {
    const withIp = rows.map(r => ({ ...r, ipDec: ipToDecimal(r.ip) }));
    const qualified = withIp.filter(r => (r.ipDec || 0) >= 2);
    const pool = qualified.length ? qualified : withIp;
    const results = [];
    const eraPool = pool.filter(r => r.era != null);
    if (eraPool.length) {
      const best = eraPool.slice().sort((a, b) => a.era - b.era)[0];
      results.push({ label: 'Best ERA', name: best.name, value: best.era.toFixed(2) });
    }
    const soPool = pool.filter(r => r.so != null);
    if (soPool.length) {
      const best = soPool.slice().sort((a, b) => b.so - a.so)[0];
      results.push({ label: 'Most Strikeouts', name: best.name, value: `${best.so} K` });
    }
    const kbbPool = pool.filter(r => r.so != null && r.bb > 0);
    if (kbbPool.length) {
      const best = kbbPool.slice().sort((a, b) => (b.so / b.bb) - (a.so / a.bb))[0];
      results.push({ label: 'Best K/BB', name: best.name, value: (best.so / best.bb).toFixed(2) });
    }
    const whipPool = pool.filter(r => r.bb != null && r.h != null && r.ipDec > 0);
    if (whipPool.length) {
      const best = whipPool.map(r => ({ ...r, whip: (r.bb + r.h) / r.ipDec })).sort((a, b) => a.whip - b.whip)[0];
      results.push({ label: 'Best WHIP', name: best.name, value: best.whip.toFixed(2) });
    }
    return results;
  }

  // Transparent heuristic, not a black box: leadoff by OBP, everyone else
  // by OPS (or AVG if OPS isn't in this file) -- a starting point to edit,
  // not a final answer. Matches the framing gcstats.app itself uses.
  function suggestedOrder(rows) {
    const withStat = rows.filter(r => r.ops != null || r.avg != null);
    const qualified = withStat.filter(r => (r.ab || 0) >= 3 || (r.pa || 0) >= 3);
    const pool = qualified.length >= 2 ? qualified : withStat;
    if (pool.length < 2) return [];
    const byOps = v => v.ops != null ? v.ops : (v.avg || 0);
    const sorted = pool.slice().sort((a, b) => byOps(b) - byOps(a));
    const leadoff = pool.slice().sort((a, b) => (b.obp || 0) - (a.obp || 0))[0];
    return [leadoff, ...sorted.filter(r => r !== leadoff)];
  }

  // Same transparent-heuristic framing as suggestedOrder above, for the
  // Pitching tab's depth order instead of a batting lineup: best ERA first
  // (qualified by IP when enough pitchers clear that bar), falling back to
  // most IP for anyone ERA can't rank. A starting point a coach edits from,
  // not a final answer -- matches that same ethos.
  function suggestedPitchingOrder(rows) {
    const withIp = rows.map(r => ({ ...r, ipDec: ipToDecimal(r.ip) }));
    const qualified = withIp.filter(r => (r.ipDec || 0) >= 2);
    const pool = qualified.length >= 2 ? qualified : withIp;
    if (pool.length < 2) return [];
    const withEra = pool.filter(r => r.era != null);
    const byIp = pool.slice().sort((a, b) => (b.ipDec || 0) - (a.ipDec || 0));
    if (!withEra.length) return byIp;
    const sortedByEra = withEra.slice().sort((a, b) => a.era - b.era);
    const rest = byIp.filter(r => r.era == null);
    return [...sortedByEra, ...rest];
  }

  window.StatsImport = {
    parseRows, battingInsights, pitchingInsights, suggestedOrder, suggestedPitchingOrder, ipToDecimal, toFirstLastInitial,

    async render(containerEl, teamId, opts) {
      opts = opts || {};
      await window.Roster.ensureLoaded(teamId);
      const roster = window.Roster.getPlayers(teamId);
      let data = await window.dbGet(window.teamPath(teamId, 'importedStats'));

      function cardsHtml(insights) {
        if (!insights.length) return '';
        return `<div class="pcStatRow" style="margin-top:12px;">${insights.map(c => `
          <div class="pcStatTile" style="min-width:120px;">
            <div class="siCardName">${escapeHtml(c.name)}</div>
            <div class="pcStatValue" style="font-size:16px;">${escapeHtml(String(c.value))}</div>
            <div class="pcStatLabel">${escapeHtml(c.label)}</div>
          </div>`).join('')}</div>`;
      }

      function tableHtml(rows, kind) {
        if (!rows.length) return '';
        const cols = kind === 'pitching'
          ? [['ip', 'IP'], ['era', 'ERA'], ['so', 'SO'], ['bb', 'BB'], ['h', 'H'], ['er', 'ER']]
          : [['avg', 'AVG'], ['obp', 'OBP'], ['slg', 'SLG'], ['ops', 'OPS'], ['ab', 'AB'], ['h', 'H'], ['hr', 'HR'], ['rbi', 'RBI'], ['sb', 'SB']];
        const present = cols.filter(([k]) => rows.some(r => r[k] != null));
        // ip keeps GameChanger's own innings-pitched notation (12.1, not
        // 12.100 -- the digit after the dot is outs, not a decimal), era
        // gets the standard 2-decimal convention (2.25, not 2.250) -- both
        // would otherwise fall into the 3-decimal AVG/OBP/SLG/OPS treatment
        // below, which is wrong for either and inconsistent with the
        // 2-decimal ERA already shown in the insight card above this table.
        const fmt = (k, v) => {
          if (v == null) return '-';
          if (k === 'ip') return v.toFixed(1);
          if (k === 'era') return v.toFixed(2);
          return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v;
        };
        const sorted = rows.slice().sort((a, b) => kind === 'pitching' ? (a.era ?? 99) - (b.era ?? 99) : (b.ops ?? b.avg ?? 0) - (a.ops ?? a.avg ?? 0));
        return `
          <div class="standingsTableWrap" style="margin-top:10px;">
            <table class="standingsTable">
              <thead><tr><th>Player</th>${present.map(([, l]) => `<th class="numCell">${l}</th>`).join('')}</tr></thead>
              <tbody>${sorted.map(r => `<tr><td>${escapeHtml(r.name)}</td>${present.map(([k]) => `<td class="numCell">${fmt(k, r[k])}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>`;
      }

      function orderHtml(order) {
        // The suggested order (and saving it as a lineup) is a coach
        // planning action, not spectator content -- the public read-only
        // view (opts.canEdit false, see refresh() below) stops at the
        // insight cards/tables, same content Game Ball's leader tile and
        // Awards already show everyone without needing edit rights.
        if (!order.length || !opts.canEdit) return '';
        return `
          <div class="sectionLabel" style="margin-top:18px;">Suggested batting order</div>
          <div class="helpText">Leadoff by OBP, rest by OPS -- a starting point, not a final answer. Save it, then edit it like any other lineup.</div>
          <div class="listBody" style="margin-top:8px;">
            ${order.map((r, i) => `
              <div class="listRow" style="cursor:default;">
                <div class="lineupSlotNum" style="margin-right:10px;">${i + 1}</div>
                <div class="listRowMain"><div class="listRowTitle">${escapeHtml(r.name)}</div></div>
                <div class="listRowSub">${r.ops != null ? r.ops.toFixed(3) + ' OPS' : (r.avg != null ? r.avg.toFixed(3) + ' AVG' : '')}</div>
              </div>`).join('')}
          </div>
          <button class="btn" id="siSaveLineup" style="width:100%;margin-top:10px;">Save as new lineup</button>`;
      }

      function refresh() {
        const battingRows = (data && data.battingRows) || [];
        const pitchingRows = (data && data.pitchingRows) || [];
        const battingIns = battingRows.length ? battingInsights(battingRows) : [];
        const pitchingIns = pitchingRows.length ? pitchingInsights(pitchingRows) : [];
        const order = battingRows.length ? suggestedOrder(battingRows) : [];

        const noStatsYet = !battingRows.length && !pitchingRows.length;
        containerEl.innerHTML = `
          <div class="drillHero">
            <div class="drillHeroTitle">${opts.canEdit ? 'Stats Insights' : 'Season Stats'}</div>
            <div class="drillHeroSub">${opts.canEdit
              ? 'Upload a GameChanger stats export (Team &rarr; Stats &rarr; Export Stats) to see who\'s hitting, who should lead off, and more.'
              : 'Who\'s hitting, who\'s pitching well -- from the team\'s last GameChanger stats import.'}</div>
          </div>
          ${opts.canEdit ? `
            <div class="detailCard">
              <label>GameChanger CSV export<input type="file" id="siFile" accept=".csv"></label>
              <button class="btn btnSmall" id="siImport" disabled style="margin-top:10px;">Import</button>
              ${data ? `<div class="helpText" style="margin-top:10px;">Last import: ${escapeHtml(data.source || 'file')} &middot; ${new Date(data.importedAt).toLocaleString()}</div>` : ''}
              <div id="siErr" style="color:#ff8a8a;font-size:12.5px;margin-top:8px;"></div>
            </div>` : ''}
          ${noStatsYet ? `<div class="emptyState">${opts.canEdit ? 'No stats imported yet.' : 'No stats imported yet -- check back once the coach uploads a GameChanger export.'}</div>` : ''}
          ${battingRows.length ? `<div class="sectionLabel" style="margin-top:18px;">Batting (${battingRows.length})</div>${cardsHtml(battingIns)}${tableHtml(battingRows, 'batting')}` : ''}
          ${pitchingRows.length ? `<div class="sectionLabel" style="margin-top:18px;">Pitching (${pitchingRows.length})</div>${cardsHtml(pitchingIns)}${tableHtml(pitchingRows, 'pitching')}` : ''}
          ${orderHtml(order)}`;

        const fileInput = containerEl.querySelector('#siFile');
        const importBtn = containerEl.querySelector('#siImport');
        if (fileInput && importBtn) {
          fileInput.addEventListener('change', () => { importBtn.disabled = !fileInput.files.length; });
          importBtn.addEventListener('click', () => {
            const file = fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const { kind, rows } = parseRows(String(reader.result), roster);
                if (!rows.length) throw new Error('No player rows found in that file.');
                data = data || {};
                if (kind === 'pitching') data.pitchingRows = rows; else data.battingRows = rows;
                data.source = file.name;
                data.importedAt = new Date().toISOString();
                await window.dbPut(window.teamPath(teamId, 'importedStats'), data);
                refresh();
              } catch (e) {
                containerEl.querySelector('#siErr').textContent = 'Could not read that file: ' + e.message;
              }
            };
            reader.readAsText(file);
          });
        }
        const saveLineupBtn = containerEl.querySelector('#siSaveLineup');
        if (saveLineupBtn) {
          saveLineupBtn.addEventListener('click', async () => {
            const matched = order.filter(r => r.playerId);
            await window.LineupBuilder.createFromOrder(teamId, matched);
            if (opts.switchTool) opts.switchTool('lineups');
          });
        }
      }
      refresh();
    },
  };
})();
