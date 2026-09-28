/* V1 regression tests for the pawn rules in topology B, every one of them
 * reported from a real game.
 *
 * The key fact, measured against the real display layout: the squares
 * with no forward neighbour are EXACTLY the visual edge row. In A that is
 * rank 8; in B the 2×2 rotation carries a7, a8, d7, d8, e7, e8, h7 and h8
 * up there and draws b8, c8, f8 and g8 one row lower. The label on a
 * square is not where the player sees it.
 *
 * The promotion rule went wrong twice before settling:
 *   · "rank 8 OR no square in front" promoted a pawn on b8 in B — drawn on
 *     the SEVENTH row, a promotion one row short of the edge.
 *   · "rank 8 only" left a pawn on e7 in B — drawn on the TOP row — at the
 *     edge as a pawn.
 * It is "the row this topology draws as the edge", on a move and on a
 * rotation alike.
 *
 * Run: npx tsx scripts/test-pawn-rules-b.ts
 */
import { createStartingPosition } from '../src/engine';
import { applyMove, generateLegalMoves } from '../src/engine/moves';
import {
  applyRotationMove,
  computeBoardLayout,
  pawnCaptureTargets,
  pawnForwardTargets,
  stepInDirection,
  tilePixelCenter,
  toggleTopology,
} from '../src/engine/auxetic';
import type { BoardState, Color, Move, SquareId } from '../src/engine';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${String(actual)}, want ${String(expected)}`);
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ALL: SquareId[] = FILES.flatMap((f) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}` as SquareId),
);

/** Squares a pawn can stand on without having already promoted. */
function pawnSquares(color: Color, topology: 'A' | 'B'): SquareId[] {
  const dir = color === 'white' ? 1 : -1;
  return ALL.filter((sq) => stepInDirection(sq, 0, dir, topology) !== null);
}

/** The squares drawn on the visual top (white) / bottom (black) row. */
function visualEdge(color: Color, topology: 'A' | 'B'): Set<SquareId> {
  const layout = computeBoardLayout(topology, 800);
  const ys = ALL.map((sq) => Math.round(tilePixelCenter(sq, topology, layout).cy));
  const edgeY = color === 'white' ? Math.min(...ys) : Math.max(...ys);
  return new Set(ALL.filter((_, i) => ys[i] === edgeY));
}

/** A board with nothing on it but the two kings, in a chosen topology. */
function bareBoard(topology: 'A' | 'B'): BoardState {
  const base = createStartingPosition(1);
  const pieces: BoardState['pieces'] = {};
  for (const [sq, piece] of Object.entries(base.pieces)) {
    if (piece && piece.type === 'king') pieces[sq as SquareId] = piece;
  }
  return {
    ...base,
    pieces,
    topologyState: topology,
    enPassantTarget: null,
    castlingRights: {
      whiteKingSide: null,
      whiteQueenSide: null,
      blackKingSide: null,
      blackQueenSide: null,
    },
  };
}

function put(state: BoardState, sq: SquareId, color: Color): BoardState {
  return { ...state, pieces: { ...state.pieces, [sq]: { type: 'pawn', color } } };
}

// ── 0. The premise: dead ends ARE the visual edge ──────────────────────
for (const topology of ['A', 'B'] as const) {
  for (const color of ['white', 'black'] as const) {
    const dir = color === 'white' ? 1 : -1;
    const dead = ALL.filter((sq) => stepInDirection(sq, 0, dir, topology) === null).sort();
    const edge = [...visualEdge(color, topology)].sort();
    check(`${topology}/${color}: dead ends == visual edge row`, dead.join(','), edge.join(','));
  }
}

// ── 1. A double push in B must leave an EP marker on the passed square ─
{
  let pushes = 0;
  let onPassed = 0;
  for (const file of FILES) {
    const from = `${file}2` as SquareId;
    const board = put(bareBoard('B'), from, 'white');
    const { one, two } = pawnForwardTargets(from, 'white', 'B');
    if (!one || !two || board.pieces[one] || board.pieces[two]) continue;
    pushes++;
    const after = applyMove({ ...board, sideToMove: 'white' }, { from, to: two, kind: 'normal' });
    if (after.enPassantTarget === one) onPassed++;
  }
  check('B: double pushes exist', pushes > 0, true);
  check('B: every double push marks the passed square', onPassed, pushes);
}

// ── 2. The EP capture in B removes the pawn that pushed ────────────────
{
  let tested = 0;
  let correct = 0;
  for (const file of FILES) {
    const from = `${file}2` as SquareId;
    let board = put(bareBoard('B'), from, 'white');
    const { one, two } = pawnForwardTargets(from, 'white', 'B');
    if (!one || !two || board.pieces[one] || board.pieces[two]) continue;
    const blackFrom = pawnSquares('black', 'B').find(
      (sq) => !board.pieces[sq] && sq !== two && pawnCaptureTargets(sq, 'black', 'B').includes(one),
    );
    if (!blackFrom) continue;
    board = put(board, blackFrom, 'black');
    const afterPush = applyMove({ ...board, sideToMove: 'white' }, { from, to: two, kind: 'normal' });
    const ep = generateLegalMoves(afterPush).find((m) => m.kind === 'enPassant' && m.from === blackFrom);
    if (!ep) continue;
    tested++;
    const after = applyMove(afterPush, ep);
    if (!after.pieces[two] && after.pieces[one]?.color === 'black') correct++;
  }
  check('B: an EP capture is reachable', tested > 0, true);
  check('B: EP removes the pusher and lands on the passed square', correct, tested);
}

// ── 3. A move promotes if and only if it lands on the visual edge ──────
for (const topology of ['A', 'B'] as const) {
  const edge = visualEdge('white', topology);
  let onEdge = 0;
  let onEdgePromoted = 0;
  let offEdgePromoted = 0;
  for (const from of pawnSquares('white', topology)) {
    const seed = bareBoard(topology);
    if (seed.pieces[from]) continue;
    const board = { ...put(seed, from, 'white'), sideToMove: 'white' as Color };
    for (const m of generateLegalMoves(board)) {
      if (m.from !== from || !m.to) continue;
      if (edge.has(m.to)) {
        onEdge++;
        if (m.kind === 'promotion') onEdgePromoted++;
      } else if (m.kind === 'promotion') {
        offEdgePromoted++;
      }
    }
  }
  check(`${topology}: moves onto the visual edge exist`, onEdge > 0, true);
  check(`${topology}: every move onto the visual edge promotes`, onEdgePromoted, onEdge);
  check(`${topology}: nothing off the visual edge promotes`, offEdgePromoted, 0);
}

// The two squares that were each wrong once, named explicitly.
{
  const b8 = visualEdge('white', 'B').has('b8' as SquareId);
  const e7 = visualEdge('white', 'B').has('e7' as SquareId);
  check('B: b8 is NOT on the visual top row (round-3 bug)', b8, false);
  check('B: e7 IS on the visual top row (round-4 bug)', e7, true);
}

// ── 4. A rotation that leaves a pawn on its far row promotes it ────────
{
  // White pawn on b8 in B: drawn a row short of the edge, a legal resting
  // place for a pawn. Rotating to A puts b8 on the top row.
  const b = { ...put(bareBoard('B'), 'b8' as SquareId, 'white'), sideToMove: 'black' as Color };
  const afterMove = applyRotationMove(b);
  check('rotation B→A promotes a white pawn resting on b8', afterMove.pieces['b8' as SquareId]?.type, 'queen');
  check('…and keeps its colour', afterMove.pieces['b8' as SquareId]?.color, 'white');
  check('…and resets the fifty-move count', afterMove.halfmoveClock, 0);

  // White pawn on e7 in A: rotating to B carries e7 onto the top row.
  const a = { ...put(bareBoard('A'), 'e7' as SquareId, 'white'), sideToMove: 'black' as Color };
  check('rotation A→B promotes a white pawn on e7', applyRotationMove(a).pieces['e7' as SquareId]?.type, 'queen');

  // Black mirror: a black pawn on e2 in A lands on B's bottom row.
  const k = { ...put(bareBoard('A'), 'e2' as SquareId, 'black'), sideToMove: 'white' as Color };
  check('rotation A→B promotes a black pawn on e2', applyRotationMove(k).pieces['e2' as SquareId]?.type, 'queen');

  // The hypothetical flip agrees with the real one — king-safety checks
  // must see the same queen the move would create.
  check(
    'toggleTopology promotes exactly like applyRotationMove',
    toggleTopology(a).pieces['e7' as SquareId]?.type,
    'queen',
  );
}

// ── 5. The very first rotation of a game promotes nothing ──────────────
{
  let games = 0;
  let spurious = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const start = createStartingPosition(seed);
    const rotated = applyRotationMove(start);
    games++;
    const before = Object.values(start.pieces).filter((p) => p?.type === 'queen').length;
    const after = Object.values(rotated.pieces).filter((p) => p?.type === 'queen').length;
    if (after !== before) spurious++;
  }
  check(`opening rotation promotes nothing (${games} starts)`, spurious, 0);
}

// ── 6. Nothing can be stranded: every non-edge square has a way forward ─
for (const topology of ['A', 'B'] as const) {
  const edge = visualEdge('white', topology);
  const stuck = ALL.filter((sq) => !edge.has(sq) && stepInDirection(sq, 0, 1, topology) === null);
  check(`${topology}: every square off the edge has a forward neighbour`, stuck.length, 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
