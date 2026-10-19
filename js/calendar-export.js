// ---------------------------------------------------------------------------
// Calendar export -- ported near-verbatim from the ASL Bengals app
// (js/calendar-export.js there), which the audit confirmed is fully generic:
// it builds a plain .ics file from an array of
// {uid, title, date, time, durationMinutes, location, description} and never
// touches any team-specific global state. Every major calendar app (Apple
// Calendar, Google Calendar, Outlook) can import one directly, no API key or
// account connection needed.
//
// Only change from the source file: PRODID/UID no longer hardcode one team's
// name, since this app serves multiple teams -- callers (schedule.js,
// calendar-family.js) pass whatever title text they want per event, and the
// UID suffix is just this app's own domain, not a specific team.
//
// Times are written "floating" (no timezone/Z suffix) -- calendar apps show
// them in whatever timezone the device is already set to, which is right for
// a local youth sports schedule with no travel across time zones.
// ---------------------------------------------------------------------------
(function () {

  function pad(n) { return String(n).padStart(2, '0'); }

  function parseTime(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
    const ap = m[3];
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, m: min };
  }

  function escapeText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  // RFC 5545 folding counts UTF-8 octets, not JS string length (UTF-16 code
  // units) -- a plain .length/.slice on the string would cut a multi-byte
  // character (an accented opponent name, an emoji in a note) in half right
  // on the fold boundary and hand the importing calendar app a corrupted
  // byte sequence instead of the character. Walk the UTF-8 bytes instead,
  // and never end a chunk on a continuation byte (top two bits 10xxxxxx) --
  // back off until the chunk boundary sits on an actual character start.
  function foldLine(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const decoder = new TextDecoder('utf-8');
    const chunkEnd = (start, maxLen) => {
      let end = Math.min(start + maxLen, bytes.length);
      while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      return end;
    };
    let out = '';
    let start = 0;
    let maxLen = 75;
    while (start < bytes.length) {
      const end = chunkEnd(start, maxLen);
      out += (start === 0 ? '' : '\r\n ') + decoder.decode(bytes.subarray(start, end));
      start = end;
      maxLen = 74;
    }
    return out;
  }

  // event: {uid, title, date:'YYYY-MM-DD', time:'6:00 PM'|'', durationMinutes, location, description}
  function buildEvent(ev) {
    const durationMin = ev.durationMinutes || 120;
    const [y, mo, d] = (ev.date || '').split('-').map(Number);
    // A game/practice with no date (neither field is required on its own
    // edit form -- see js/schedule.js's/js/practices.js's date inputs)
    // used to still reach here and emit a syntactically broken VEVENT --
    // DTSTART/DTEND built from NaN/undefined pieces ("0undefinedundefined",
    // "NaNNaNNaN") -- corrupting the whole downloaded .ics file around it,
    // not just that one event. Skip it instead, same "don't export a
    // half-complete record" rule js/calendar-view.js's own date filter
    // already follows for its on-screen list.
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return [];
    const time = parseTime(ev.time);
    const lines = [];
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@lybsballclub`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
    if (time) {
      const start = new Date(y, mo - 1, d, time.h, time.m);
      const end = new Date(start.getTime() + durationMin * 60000);
      const fmt = dt => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
      lines.push(`DTSTART:${fmt(start)}`);
      lines.push(`DTEND:${fmt(end)}`);
    } else {
      const fmtDate = (yy, mm, dd) => `${yy}${pad(mm)}${pad(dd)}`;
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(y, mo, d)}`);
      const endDate = new Date(y, mo - 1, d + 1);
      lines.push(`DTEND;VALUE=DATE:${fmtDate(endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate())}`);
    }
    lines.push(foldLine(`SUMMARY:${escapeText(ev.title)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    lines.push('END:VEVENT');
    return lines;
  }

  window.buildICS = function (events) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LYBS Ballclub//Schedule//EN', 'CALSCALE:GREGORIAN'];
    (events || []).forEach(ev => { lines.push(...buildEvent(ev)); });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  window.downloadICS = function (filename, icsText) {
    const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.ics') ? filename : filename + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})();
