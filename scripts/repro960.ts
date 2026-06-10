/* Round-trip repro: play random games, export notation, re-import, compare.
 * Run: npx tsx scripts/repro960.ts
 */
import { createStartingPosition, createPositionFromBackRankKey } from '../src/engine';
import { positionSignature } from '../src/engine/board';
import { generateLegalMoves as getLegalMoves, applyMove } from '../src/engine/moves';
import { applyRotationMove, toggleTopology } from '../src/engine/auxetic';
import type { BoardState, Move } from '../src/engine';
import { createGameLog, appendMove, computeSAN, type GameLog } from '../src/recording/log';
import { buildSavedGameSnapshot } from '../src/memory/build';
import { parseMemoryNotation } from '../src/memory/notation';

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playRandomGame(seed: number, plies: number): { log: GameLog; final: BoardState } {
  const rnd = mulberry32(seed);
  const initial = createStartingPosition(seed);
  let state = initial;
  let log = createGameLog(`repro-${seed}`, initial, seed);
  for (let i = 0; i < plies; i++) {
    // ~8% of turns: topology rotation instead of a move
    if (rnd() < 0.08) {
      const topoBefore = state.topologyState;
      const mv: Move = { kind: 'topologyToggle' };
      const san = computeSAN(state, mv);
      state = applyRotationMove(state);
      log = appendMove(log, mv, san, topoBefore);
      continue;
    }
    const legal = getLegalMoves(state);
    if (legal.length === 0) break;
    const mv = legal[Math.floor(rnd() * legal.length)];
    const topoBefore = state.topologyState;
    const san = computeSAN(state, mv);
    state = applyMove(state, mv);
    log = appendMove(log, mv, san, topoBefore);
  }
  return { log, final: state };
}

// Mirror of App.tsx importReplayFromNotation (engine part only)
function replayFromNotation(notation: string): BoardState {
  const parsed = parseMemoryNotation(notation);
  const initial = createPositionFromBackRankKey(parsed.config960);
  let current: BoardState = initial;
  for (const token of parsed.moves) {
    const mv = token.move;
    if (token.requiredTopology && current.topologyState !== token.requiredTopology) {
      current = toggleTopology(current);
    }
    if (mv.kind === 'topologyToggle') {
      current = applyRotationMove(current);
    } else if (mv.kind === 'castle') {
      const legal = getLegalMoves(current);
      const targetFile = token.castleSide === 'queen' ? 'c' : 'g';
      const castleMove = legal.find(
        (m) => m.kind === 'castle' && m.to && m.to[0] === targetFile,
      );
      if (!castleMove) throw new Error('No legal castle move available at this position.');
      current = applyMove(current, castleMove);
    } else if (mv.from && mv.to) {
      if (!current.pieces[mv.from]) {
        throw new Error(`Illegal move: no piece on ${mv.from}.`);
      }
      const legal = getLegalMoves(current);
      const matched =
        legal.find(
          (m) => m.from === mv.from && m.to === mv.to && (!mv.promotion || m.promotion === mv.promotion),
        ) ?? mv;
      current = applyMove(current, matched);
    }
  }
  return current;
}

let pass = 0;
let fail = 0;
for (let seed = 1; seed <= 200; seed++) {
  const { log, final } = playRandomGame(seed, 220);
  const snapshot = buildSavedGameSnapshot(log, `snap-${seed}`);
  try {
    const replayed = replayFromNotation(snapshot.notation);
    const a = positionSignature(final);
    const b = positionSignature(replayed);
    if (a === b) {
      pass++;
    } else {
      fail++;
      console.log(`\n=== SEED ${seed}: SIGNATURE MISMATCH ===`);
      console.log('expected:', a);
      console.log('actual  :', b);
      console.log(snapshot.notation.split('\n').slice(0, 8).join('\n'), '...');
    }
  } catch (e) {
    fail++;
    console.log(`\n=== SEED ${seed}: THROWS: ${(e as Error).message} ===`);
    console.log(snapshot.notation.split('\n').slice(0, 12).join('\n'), '...');
  }
}
console.log(`\npass=${pass} fail=${fail}`);
