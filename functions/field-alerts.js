/* Field Time phone alerts: the words for each alert, kept apart from the
   Firebase triggers in index.js so tests/field-alerts.test.js can check
   them with no Firebase at all. Uses only team names and block times,
   never anything about a player. */
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function when(key) {
  const [d, t] = String(key || '').split('/');
  const [y, m, dd] = (d || '').split('-').map(Number);
  if (!y || !t) return 'a field block';
  const dt = new Date(Date.UTC(y, m - 1, dd, 12));
  const h = Number(t.slice(0, 2));
  return `${DAY[dt.getUTCDay()]} ${MON[m - 1]} ${dd}, ${((h + 11) % 12) + 1}:${t.slice(2)} ${h < 12 ? 'AM' : 'PM'}`;
}
const name = (teams, id) => String((teams && teams[id] && teams[id].name) || id || 'A team').slice(0, 40);
const fieldName = f => String((f && f.name) || 'the field').slice(0, 40);

function requestAlert(req, teams, field) {
  if (!req || req.st !== 'pending') return null;
  const body = req.give
    ? `${name(teams, req.from)} wants to swap their ${when(req.give)} for your ${when(req.want)} at ${fieldName(field)}.`
    : `${name(teams, req.from)} asks for your ${when(req.want)} at ${fieldName(field)}.`;
  return { to: req.to, payload: { title: 'Field time request', body: body + ' Tap to answer.', tag: 'field-req' } };
}
function answerAlert(before, req, teams, field) {
  if (!before || before.st !== 'pending' || !req || (req.st !== 'accepted' && req.st !== 'declined')) return null;
  const body = req.st === 'accepted'
    ? `${name(teams, req.to)} said yes: ${when(req.want)} at ${fieldName(field)} is yours.`
    : `${name(teams, req.to)} is keeping ${when(req.want)} at ${fieldName(field)}.`;
  return { to: req.from, payload: { title: req.st === 'accepted' ? 'Field time: yes' : 'Field time: no', body, tag: 'field-ans' } };
}
// A block someone gave up: tell every other team on the field, but only
// for a date that hasn't passed.
function openedAlert(key, was, teams, field, today) {
  if (!was || !was.team) return null;
  const date = String(key).split('/')[0];
  if (date < today) return null;
  const to = Object.keys(teams || {}).filter(id => id !== was.team);
  if (!to.length) return null;
  return { to, payload: { title: 'Field time opened up', body: `${when(key)} at ${fieldName(field)} is open. First to book it gets it.`, tag: 'field-open' } };
}
module.exports = { when, requestAlert, answerAlert, openedAlert };
