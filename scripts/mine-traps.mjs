// R15 T5: mine the self-play corpus for early "trap" swings — moves inside
// the first 10 full moves where the eval jumps >= 300cp. searchScore is
// White-perspective; a swing AGAINST the mover = the mover fumbled (that's
// the pattern a "punishes typical mistakes" bot wants to steer toward).
// Exploratory: prints motif tables, changes nothing.
//
// Usage: node scripts/mine-traps.mjs [minSwingCp] [maxFullMove]

import { readFile } from 'node:fs/promises';

const MIN_SWING = Number(process.argv[2] ?? 300);
const MAX_FULL_MOVE = Number(process.argv[3] ?? 10);

const games = JSON.parse(await readFile('data/training-games-dump.json', 'utf8'));

const pieceOf = (san) => {
  if (!san) return '?';
  if (san.startsWith('O-O')) return 'castle';
  const c = san[0];
  return 'NBRQK'.includes(c)
    ? { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[c]
    : 'pawn';
};

const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

let events = 0;
let gamesWithEvent = 0;
const byMotif = new Map(); // "<piece> <kind>" of the fumbled move
const byFullMove = new Map();
const byPunisher = new Map(); // what the OPPONENT played right after (kind)
const byStart = new Map(); // chess960Id -> early-swing count
const rotationNearby = { yes: 0, no: 0 };

for (const g of games) {
  const moves = g.log?.moves ?? [];
  let found = false;
  for (let i = 1; i < Math.min(moves.length, MAX_FULL_MOVE * 2); i++) {
    const prev = moves[i - 1].searchScore;
    const cur = moves[i].searchScore;
    if (typeof prev !== 'number' || typeof cur !== 'number') continue;
    const moverIsWhite = i % 2 === 0;
    const deltaForMover = (cur - prev) * (moverIsWhite ? 1 : -1);
    if (deltaForMover > -MIN_SWING) continue; // not a fumble by the mover

    events++;
    found = true;
    const m = moves[i];
    tally(byMotif, `${pieceOf(m.san)} ${m.move?.kind ?? '?'}`);
    tally(byFullMove, Math.floor(i / 2) + 1);
    tally(byStart, g.chess960Id);
    const next = moves[i + 1];
    if (next) tally(byPunisher, `${pieceOf(next.san)} ${next.move?.kind ?? '?'}`);
    const win = moves.slice(Math.max(0, i - 2), i);
    if (win.some((x) => x.move?.kind === 'topologyToggle')) rotationNearby.yes++;
    else rotationNearby.no++;
  }
  if (found) gamesWithEvent++;
}

console.log(`self-play games: ${games.length}; early fumbles (>= ${MIN_SWING}cp against mover, first ${MAX_FULL_MOVE} moves): ${events} in ${gamesWithEvent} games (${((100 * gamesWithEvent) / games.length).toFixed(0)}%)`);
console.log('\nfumbled move motif (piece + kind):');
for (const [k, v] of top(byMotif)) console.log(`  ${k}: ${v}`);
console.log('\npunishing reply motif:');
for (const [k, v] of top(byPunisher, 8)) console.log(`  ${k}: ${v}`);
console.log('\nfumbles by full move:');
for (const [k, v] of [...byFullMove.entries()].sort((a, b) => a[0] - b[0]))
  console.log(`  move ${k}: ${v}`);
console.log(`\nrotation within 2 plies before the fumble: yes=${rotationNearby.yes} no=${rotationNearby.no}`);
console.log('\nmost fumble-prone starts (chess960Id):');
for (const [k, v] of top(byStart, 10)) console.log(`  ${k}: ${v}`);
