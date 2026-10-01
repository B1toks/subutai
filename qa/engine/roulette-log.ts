/* Roulette logs and everything that replays them.
 *
 * A roulette turn is up to two actions by the SAME side (App.commitMove /
 * executeAiRouletteAction clamp sideToMove back after the first), and a
 * turn with nothing playable is a pass that is not logged at all. Code that
 * rebuilds a game from its log with plain applyMove / applyRotationMove
 * flips the side on every entry, so after the first two-action turn it no
 * longer knows whose move is whose. That code includes the points
 * (analysis/points.ts: capture points are credited by the replayed side),
 * Memory's resume (App.resumeGame) and the review.
 *
 * This script plays random roulette games the way the app does (two
 * actions per turn, king capture ends it), then asks the app's own
 * computeGamePoints for the human's capture value and compares it with the
 * captures White actually made.
 *
 * Run: npx tsx qa/engine/roulette-log.ts   (ROU_GAMES)
 */
import type { BoardState, Move } from '../../src/engine/types';
import { envInt, loadEngine, mulberry32, srcModule, type RecordingLog } from './_src';

type Points = typeof import('../../src/analysis/points');
const GAMES = envInt('ROU_GAMES', 300);
const { index, moves } = await loadEngine();
const rec = await srcModule<RecordingLog>('recording/log.ts');
const points = await srcModule<Points>('analysis/points.ts');

// Same values and the same notion of "a capture" (kind 'capture' or en
// passant) as analysis/points.ts, so only the attribution can differ.
const VALUE: Record<string, number> = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
let mismatches = 0;
let wrongMoverEntries = 0;
let totalEntries = 0;
const examples: string[] = [];

for (let g = 0; g < GAMES; g++) {
  const rnd = mulberry32(777 + g);
  let st: BoardState = index.createStartingPosition(777 + g);
  let log = rec.createGameLog(`rou-${g}`, st, g);
  let whiteCaptured = 0;
  let over = false;
  const movers: string[] = [];
  for (let turn = 0; turn < 40 && !over; turn++) {
    const side = st.sideToMove;
    for (let action = 0; action < 2; action++) {
      const legal = moves.generateLegalMoves(st, { allowSelfCheck: true }).filter((m) => m.kind !== 'castle');
      if (!legal.length) break;
      const caps = legal.filter((m) => m.to && st.pieces[m.to]);
      const m: Move = caps.length && rnd() < 0.5 ? caps[Math.floor(rnd() * caps.length)] : legal[Math.floor(rnd() * legal.length)];
      const victim = m.to ? st.pieces[m.to] : undefined;
      if (side === 'white' && m.kind === 'capture' && victim) whiteCaptured += VALUE[victim.type];
      if (side === 'white' && m.kind === 'enPassant') whiteCaptured += VALUE.pawn;
      movers.push(side);
      log = rec.appendMove(log, m, rec.computeSAN(st, m), st.topologyState);
      const after = moves.applyMove(st, m);
      if (!moves.findKing(after, 'white') || !moves.findKing(after, 'black')) { st = after; over = true; break; }
      // Same clamp the app applies between the two actions of a turn.
      st = action === 0 ? { ...after, sideToMove: side } : after;
    }
    if (!over && st.sideToMove === side) st = { ...st, sideToMove: side === 'white' ? 'black' : 'white' };
  }
  // Who a log replay (review / resume / points) believes made each entry.
  let replay = log.initialState;
  log.moves.forEach((e, i) => {
    totalEntries++;
    if (replay.sideToMove !== movers[i]) wrongMoverEntries++;
    replay = moves.applyMove(replay, e.move);
  });

  const p = points.computeGamePoints(log, 'human-win', 'white', 'roulette');
  const counted = (p as unknown as { captureValueCp: number }).captureValueCp;
  if (counted !== whiteCaptured) {
    mismatches++;
    if (examples.length < 5) examples.push(`game ${g}: White captured ${whiteCaptured} cp, computeGamePoints credits ${counted} cp (log ${log.moves.length} entries)`);
  }
}

console.log(`roulette games: ${GAMES}`);
console.log(`capture value credited to the human differs from White's real captures: ${mismatches}/${GAMES}`);
console.log(`log entries a replay attributes to the wrong side: ${wrongMoverEntries}/${totalEntries}`);
for (const e of examples) console.log(`  - ${e}`);
if (mismatches || wrongMoverEntries) process.exitCode = 1;
