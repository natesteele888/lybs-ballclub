#!/usr/bin/env node
/* Validates a built situations app. Usage: node scripts/validate.js <app.html>
   Checks the five invariants from SKILL.md. Exits non-zero on failure. */
const fs = require('fs');
const path = process.argv[2] || 'assets/baseball-situations.html';
const html = fs.readFileSync(path, 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];
const core = js.split('/* ------------------------------ playback ---')[0]
  .replace(/^let MYRULES=.*$/m, 'let MYRULES=[];')
  .replace(/^let CFG=.*$/m, "let CFG={name:'x',sub:'y'};")
  .replace(/^let TEAM=Object\.assign\(\{/m, 'let TEAM=({')
  .replace(/^\},JSON\.parse\(store\.get\(LS\+'team','\{\}'\)\)\);$/m, '});');
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
global.performance = global.performance || { now: () => 0 };
const ctx = {};
new Function('g', core + '\nObject.assign(g,{SITS,BASE_RULES,LM,STARTS,POSLIST,POSN,resolve,pt,buildPlay,S,sitById,BASEKEY});')(ctx);
const { SITS, LM, STARTS, POSLIST, resolve, buildPlay, S } = ctx;

const STATES = ['_','1','2','3','12','13','23','123'];
const fail = [];
const note = (t, m) => fail.push(`[${t}] ${m}`);

/* --- geometry --- */
const HOME=[260,415], ARC=[260,312.6], R=232.6, BACK=[260,428], BR=80;
const zone = (x,y) => {
  if (Math.hypot(x-BACK[0], y-BACK[1]) <= BR) return 'backstop';
  const dx=x-HOME[0], dy=y-HOME[1];
  if (dy > 0) return 'off';
  const a = Math.atan2(Math.abs(dx), -dy) * 180/Math.PI;
  if (a > 58 || Math.hypot(x-ARC[0], y-ARC[1]) > R-3) return 'off';
  return a <= 45 ? 'fair' : 'foul';
};

/* 3. positions on the right ground */
SITS.forEach(s => {
  const z = zone(+s.ball_x, +s.ball_y);
  if (z === 'off') note('geometry', `${s.ball_id} ball is off the field`);
  const shouldFoul = s.ball_id.startsWith('FOUL_');
  if (z !== 'backstop' && (z === 'foul') !== shouldFoul)
    note('geometry', `${s.ball_id} ball is in ${z} territory`);
});
Object.keys(LM).forEach(k => {
  if (!LM[k]) return;
  if (zone(LM[k][0], LM[k][1]) === 'off') note('geometry', `landmark ${k} is off the field`);
});
POSLIST.forEach(p => {
  if (zone(STARTS[p][0], STARTS[p][1]) === 'off') note('geometry', `${p} starts off the field`);
});
const onSkin = p => Math.hypot(p[0]-260, p[1]-415) <= 196;
['P','1B','2B','3B','SS'].forEach(p => { if (!onSkin(STARTS[p])) note('geometry', `${p} does not start on the dirt`); });
['LF','CF','RF'].forEach(p => { if (onSkin(STARTS[p])) note('geometry', `${p} starts on the infield dirt`); });

/* 1, 2, 4 --- per-situation checks --- */
let plays = 0;
SITS.forEach(s => STATES.forEach(b => [0,1,2].forEach(o => [false,true].forEach(inf => {
  const a = resolve(s.ball_id, b, o, inf);
  const key = `${s.ball_id}/${b}/${o}${inf?'/in':''}`;
  const seen = {};
  POSLIST.forEach(p => {
    const t = a[p].target;
    if (!a[p].cue) note('completeness', `${key} ${p} has no cue`);
    if (t !== 'BALL' && !t.startsWith('POS_') && !LM[t]) note('completeness', `${key} ${p} unknown landmark ${t}`);
    if (a[p].throw) a[p].throw.split('>').forEach(x => {
      if (!LM[x.trim()]) note('completeness', `${key} ${p} throws to unknown ${x}`);
    });
    if (t === 'BALL' || a[p].role === 'HOLD' || t.startsWith('POS_')) return;
    (seen[t] = seen[t] || []).push(p);
  });
  Object.entries(seen).forEach(([t, ps]) => {
    if (ps.length > 1) note('collision', `${key}: ${ps.join(' + ')} all sent to ${t}`);
  });
  ['BASE_1','BASE_2','BASE_3'].forEach(base => {
    const covers = POSLIST.filter(p => a[p].target === base && a[p].role === 'COVER');
    if (covers.length > 1) note('coverage', `${key}: ${covers.join(' + ')} both cover ${base}`);
  });
  if (inf) return;
  plays++;
  S.ball = s.ball_id; S.bases = b; S.outs = o; S.infIn = false;
  try {
    const plan = buildPlay();
    if (!isFinite(plan.duration) || plan.duration <= 0 || plan.duration > 16)
      note('timeline', `${key} duration ${plan.duration}`);
    plan.runners.forEach(r => { if (!isFinite(r.dur)) note('timeline', `${key} bad runner leg`); });
  } catch (e) { note('timeline', `${key} threw: ${e.message}`); }
}))));

const byType = {};
fail.forEach(f => { const t = f.slice(1, f.indexOf(']')); byType[t] = (byType[t]||0)+1; });
console.log(`${SITS.length} situations · ${ctx.BASE_RULES.length} rules · ${plays} plays checked`);
if (!fail.length) { console.log('PASS — all five invariants hold'); process.exit(0); }
console.log('FAIL');
Object.entries(byType).forEach(([t,n]) => console.log(`  ${t}: ${n}`));
[...new Set(fail)].slice(0, 25).forEach(f => console.log('   ' + f));
process.exit(1);
