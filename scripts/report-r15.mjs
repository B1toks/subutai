// R15 step 1: the three product reports over the labelled human games.
//   1. survival funnel (game length x outcome)
//   2. first-blunder map (when the first big human eval drop happens, what precedes it)
//   3. rotate statistics (who rotates, when, eval delta)
// Reads data/human-games-labelled.json + data/games-dump.json (for move.kind).
//
// Usage: node scripts/report-r15.mjs

import { readFile } from 'node:fs/promises';

const labelled = JSON.parse(await readFile('data/human-games-labelled.json', 'utf8'));
const dump = JSON.parse(await readFile('data/games-dump.json', 'utf8'));
const kindByGame = new Map(
  dump.map((g) => [g.id, (g.log?.moves ?? []).map((m) => m.move?.kind ?? '?')]),
);

const fullMove = (ply) => Math.floor(ply / 2) + 1; // ply index -> move number
const BLUNDER_CP = 250; // "великий провал" — cpl of the human move

// ---------- 1. survival funnel ----------
console.log('=== 1. Воронка виживання (довжина партії x результат) ===');
const buckets = ['1-10', '11-20', '21-30', '31-40', '41-50', '50+'];
const funnel = new Map(); // bucket -> outcome -> count
for (const g of labelled) {
  const moves = fullMove(g.labels.length - 1);
  const b = buckets[Math.min(5, Math.floor((moves - 1) / 10))];
  const byOutcome = funnel.get(b) ?? {};
  byOutcome[g.outcome] = (byOutcome[g.outcome] ?? 0) + 1;
  funnel.set(b, byOutcome);
}
const outcomes = ['human-win', 'ai-win', 'human-resign', 'draw'];
console.log(['bucket', ...outcomes, 'total'].join('\t'));
for (const b of buckets) {
  const row = funnel.get(b) ?? {};
  const total = Object.values(row).reduce((a, c) => a + c, 0);
  console.log([b, ...outcomes.map((o) => row[o] ?? 0), total].join('\t'));
}
const survive50 = labelled.filter((g) => fullMove(g.labels.length - 1) >= 50);
console.log(`доживають до 50 ходів: ${survive50.length}/${labelled.length}`);

// ---------- 2. first-blunder map ----------
console.log(`\n=== 2. Перший людський бландер (cpl >= ${BLUNDER_CP}) ===`);
const firstBlunderMoves = [];
let gamesNoBlunder = 0;
const precede = { capture: 0, botRotation: 0, ownRotation: 0, quiet: 0 };
for (const g of labelled) {
  const kinds = kindByGame.get(g.id) ?? [];
  const idx = g.labels.findIndex((l) => l.isHuman && !l.rotation && l.cpl >= BLUNDER_CP);
  if (idx < 0) { gamesNoBlunder++; continue; }
  firstBlunderMoves.push(fullMove(idx));
  // what happened in the 2 plies before the blunder?
  const window = g.labels.slice(Math.max(0, idx - 2), idx);
  if (window.some((l) => !l.isHuman && l.rotation)) precede.botRotation++;
  else if (window.some((l) => l.isHuman && l.rotation)) precede.ownRotation++;
  else if (window.some((l) => kinds[l.i] === 'capture' || kinds[l.i] === 'enPassant')) precede.capture++;
  else precede.quiet++;
}
firstBlunderMoves.sort((a, b) => a - b);
const q = (p) => firstBlunderMoves[Math.floor(p * (firstBlunderMoves.length - 1))];
console.log(`ігор з бландером: ${firstBlunderMoves.length}, без жодного: ${gamesNoBlunder}`);
if (firstBlunderMoves.length) {
  console.log(`перший бландер на ході: медіана ${q(0.5)}, p25 ${q(0.25)}, p75 ${q(0.75)}`);
  const hist = new Map();
  for (const m of firstBlunderMoves) {
    const b = buckets[Math.min(5, Math.floor((m - 1) / 10))];
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  console.log('розподіл по ходах:', buckets.map((b) => `${b}: ${hist.get(b) ?? 0}`).join('  '));
  console.log('що передує (2 попередні пів-ходи):', JSON.stringify(precede));
}
// human cpl profile by game phase
const phases = [[1, 10, 0, 0], [11, 20, 0, 0], [21, 30, 0, 0], [31, 99, 0, 0]];
for (const g of labelled)
  for (const l of g.labels) {
    if (!l.isHuman || l.rotation) continue;
    const m = fullMove(l.i);
    const ph = phases.find(([a, b]) => m >= a && m <= b);
    if (ph) { ph[2] += Math.min(l.cpl, 1000); ph[3]++; }
  }
console.log('середній людський cpl по фазах:',
  phases.map(([a, b, s, n]) => `ходи ${a}-${b}: ${n ? (s / n).toFixed(0) : '-'}cp (n=${n})`).join('  '));

// ---------- 3. rotate statistics ----------
console.log('\n=== 3. Ротейт-статистика ===');
let humanRot = 0, botRot = 0;
const deltas = []; // eval delta from the rotating side's perspective
const rotMoves = [];
for (const g of labelled) {
  for (const l of g.labels) {
    if (!l.rotation) continue;
    if (l.isHuman) humanRot++; else botRot++;
    rotMoves.push(fullMove(l.i));
    const prev = l.i > 0 ? g.labels.find((x) => x.i === l.i - 1) : null;
    if (prev) {
      const d = l.evalW - prev.evalW; // + favours white
      deltas.push({ d: l.mover === 'white' ? d : -d, human: l.isHuman });
    }
  }
}
console.log(`ротацій: людських ${humanRot}, ботових ${botRot}`);
if (rotMoves.length) {
  rotMoves.sort((a, b) => a - b);
  console.log(`хід ротації: медіана ${rotMoves[Math.floor(rotMoves.length / 2)]}, min ${rotMoves[0]}, max ${rotMoves.at(-1)}`);
}
function deltaStats(list) {
  if (!list.length) return 'n=0';
  const v = list.map((x) => Math.max(-1000, Math.min(1000, x.d))).sort((a, b) => a - b);
  const mean = v.reduce((a, c) => a + c, 0) / v.length;
  const pos = v.filter((x) => x > 50).length, neg = v.filter((x) => x < -50).length;
  return `n=${v.length}, середня дельта ${mean.toFixed(0)}cp, медіана ${v[Math.floor(v.length / 2)]}cp, покращило(>+50) ${pos}, погіршило(<-50) ${neg}`;
}
console.log('дельта eval для того, хто крутив (людина):', deltaStats(deltas.filter((x) => x.human)));
console.log('дельта eval для того, хто крутив (бот):   ', deltaStats(deltas.filter((x) => !x.human)));

// ---------- бонус: чи чесний поріг підбадьорення -2.5 ----------
const comebacks = labelled.filter((g) => {
  if (g.outcome !== 'human-win') return false;
  const sign = g.humanColor === 'white' ? 1 : -1;
  return g.labels.some((l) => sign * l.evalW <= -250);
});
console.log(`\nкамбеки: виграних партій, де людина побувала <= -2.5 пішака: ${comebacks.length} з ${labelled.filter((g) => g.outcome === 'human-win').length}`);
