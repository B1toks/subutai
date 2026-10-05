/* R-1 follow-up: Roulette logs the way the live game really writes them.
 *
 * replay-import-strict.ts (section 4) plays Roulette turns of two plain
 * piece moves. The live game also lets an action be a rotation (it costs an
 * action, App.tsx handleRotate: first action -> sideToMove clamped back to
 * the mover; second action -> the turn ends, no rotation right after a
 * rotation) or a castle, and a turn can have a single action. This probe
 * plays such turns with the app's own engine and checks that the app's
 * exporter + importer bring the same position back.
 *
 * It also records (does not assert) what the importer does with logs no
 * live game can produce: one side taking 3+ actions in a row, Black opening.
 *
 * Run:  QA_SRC=<checkout>/src npx tsx qa/engine/roulette-import-probe.ts
 * Env:  PROBE_GAMES (default 400)
 */
import type { BoardState, SquareId } from '../../src/engine/types';
import { envInt, loadEngine, mulberry32, srcModule, type MemoryBuild, type RecordingLog } from './_src';
import { ALL_SQUARES } from './layout';

type ReplayImport = typeof import('../../src/memory/replayImport');

const GAMES = envInt('PROBE_GAMES', 400);
const { index, moves, auxetic } = await loadEngine();
const rec = await srcModule<RecordingLog>('recording/log.ts');
const build = await srcModule<MemoryBuild>('memory/build.ts');
const imp = await srcModule<ReplayImport>('memory/replayImport.ts');

const counts = { games: 0, entries: 0, rotations: 0, rotFirst: 0, rotSecond: 0, castles: 0, castleSecond: 0, singleActionTurns: 0 };
const failures: string[] = [];

function sameBoard(a: BoardState, b: BoardState): string | null {
  for (const sq of ALL_SQUARES) {
    const p = a.pieces[sq as SquareId];
    const q = b.pieces[sq as SquareId];
    if ((p?.color ?? '') + (p?.type ?? '') !== (q?.color ?? '') + (q?.type ?? '')) return `${sq}: import=${p ? p.color + ' ' + p.type : 'empty'} played=${q ? q.color + ' ' + q.type : 'empty'}`;
  }
  if (a.topologyState !== b.topologyState) return `topology import=${a.topologyState} played=${b.topologyState}`;
  return null;
}

for (let g = 0; g < GAMES; g++) {
  const rnd = mulberry32(90_001 + g);
  let st: BoardState = index.createStartingPosition(90_001 + g);
  let log = rec.createGameLog(`probe-${g}`, st, g);
  let over = false;
  for (let turn = 0; turn < 40 && !over; turn++) {
    const side = st.sideToMove;
    const actions = rnd() < 0.15 ? 1 : 2;
    if (actions === 1) counts.singleActionTurns++;
    for (let action = 0; action < actions && !over; action++) {
      const last = action === actions - 1;
      const canRotate = !st.lastMoveWasRotation;
      const legal = moves.generateLegalMoves(st, { allowSelfCheck: true });
      if (canRotate && (rnd() < 0.18 || legal.length === 0)) {
        // A rotation action, exactly like handleRotate in Roulette.
        const m = { kind: 'topologyToggle' as const };
        log = rec.appendMove(log, m, rec.computeSAN(st, m), st.topologyState);
        const rotated = auxetic.applyRotationMove(st);
        counts.rotations++;
        if (last) { st = rotated; counts.rotSecond++; } else { st = { ...rotated, sideToMove: side }; counts.rotFirst++; }
        continue;
      }
      if (!legal.length) break;
      const castles = legal.filter((m) => m.kind === 'castle');
      const m = castles.length && rnd() < 0.5 ? castles[0] : legal[Math.floor(rnd() * legal.length)];
      if (m.kind === 'castle') { counts.castles++; if (action === 1) counts.castleSecond++; }
      log = rec.appendMove(log, m, rec.computeSAN(st, m), st.topologyState);
      const after = moves.applyMove(st, m);
      if (!moves.findKing(after, 'white') || !moves.findKing(after, 'black')) { st = after; over = true; break; }
      st = last ? after : { ...after, sideToMove: side };
    }
    if (!over && st.sideToMove === side) st = { ...st, sideToMove: side === 'white' ? 'black' : 'white' };
  }
  counts.games++;
  counts.entries += log.moves.length;
  const text = build.buildSavedGameSnapshot(log, `probe-${g}`).notation;
  try {
    const r = imp.replayFromNotation(text, { roulette: true });
    const diff = sameBoard(r.final, st);
    if (diff) failures.push(`game ${g}: loads, but ${diff}`);
  } catch (e) {
    failures.push(`game ${g} (${log.moves.length} entries): refused — ${(e as Error).message}`);
  }
}

// Logs no live Roulette game can write (informational).
const H = '[Chess960 "RNBQKBNR"]\n[Seed "1"]\n\n';
const odd: Array<[string, string]> = [
  ['White takes 3 actions in a row', `${H}1. a2→a3  b2→b3\n2. c2→c3  e7→e6`],
  ['White takes 6 actions in a row', `${H}1. a2→a3  b2→b3\n2. c2→c3  d2→d3\n3. g2→g3  h2→h3`],
  ['Black takes 3 actions in a row', `${H}1. a2→a3  a7→a6\n2. b7→b6  c7→c6`],
  ['Black opens', `${H}1. e7→e5`],
  ['a classic log with alternation broken, loaded in Roulette', `${H}1. e2→e4  d2→d4\n2. Ng1→f3  e7→e5`],
];
const oddSeen: string[] = [];
for (const [what, text] of odd) {
  try {
    imp.replayFromNotation(text, { roulette: true });
    oddSeen.push(`${what}: ACCEPTED`);
  } catch (e) {
    oddSeen.push(`${what}: refused — ${(e as Error).message}`);
  }
}

console.log(`roulette (app-like turns): ${counts.games - failures.length}/${counts.games} load back ${JSON.stringify(counts)}`);
for (const f of failures.slice(0, 10)) console.log(`  - ${f}`);
console.log('logs no live game writes (informational):');
for (const s of oddSeen) console.log(`  ${s}`);
if (failures.length) process.exitCode = 1;
else console.log('\nALL PASS');
