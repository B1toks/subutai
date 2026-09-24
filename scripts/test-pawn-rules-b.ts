/* V1 regression tests for the pawn rules that only misbehaved in
 * topology B, all reported from real games:
 *
 *   1. En passant never arose in B at all. applyMove only set the marker
 *      when topologyState === 'A', on the reasoning that B "reshuffles
 *      squares enough that the pass-through semantic doesn't apply". It
 *      does apply — a double push in B still steps through exactly one
 *      square; B just disagrees with the coordinates about which one.
 *
 *   2. A pawn could step onto the geometric last rank in B, still have a
 *      forward neighbour there (so it did not promote), and then be
 *      stranded as a pawn on rank 8 forever once the board rotated back.
 *
 *   3. The first fix for (2) kept the old topological rule alongside the
 *      geometric one, and that rule turned out to be the opposite bug: a
 *      pawn capturing onto a7/d7/e7/h5 in B — squares with no forward
 *      neighbour THERE — promoted on the seventh rank. Promotion is
 *      geometric only now.
 *
 * Run: npx tsx scripts/test-pawn-rules-b.ts
 */
import { createStartingPosition } from '../src/engine';
import { applyMove, generateLegalMoves } from '../src/engine/moves';
import { pawnCaptureTargets, pawnForwardTargets, stepInDirection } from '../src/engine/auxetic';
import type { BoardState, Color, Move, SquareId } from '../src/engine';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${String(actual)}, want ${String(expected)}`);
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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** Every square a pawn can legally stand on. */
function allPawnSquares(): SquareId[] {
  const out: SquareId[] = [];
  for (const f of FILES) for (let r = 2; r <= 7; r++) out.push(`${f}${r}` as SquareId);
  return out;
}

function put(state: BoardState, sq: SquareId, type: 'pawn', color: Color): BoardState {
  return { ...state, pieces: { ...state.pieces, [sq]: { type, color } } };
}

// ── 1. A double push in topology B must leave an EP marker ──────────────
// Walked over every file rather than hand-picking one, because which
// squares actually admit a two-step push in B is exactly the thing the
// old code was guessing about.
{
  let pushesFound = 0;
  let markersSet = 0;
  let markerIsPassedSquare = 0;
  for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const from = `${file}2` as SquareId;
    const board = put(bareBoard('B'), from, 'pawn', 'white');
    const { one, two } = pawnForwardTargets(from, 'white', 'B');
    if (!one || !two) continue;
    if (board.pieces[one] || board.pieces[two]) continue;
    pushesFound++;
    const move: Move = { from, to: two, kind: 'normal' };
    const after = applyMove({ ...board, sideToMove: 'white' }, move);
    if (after.enPassantTarget) markersSet++;
    if (after.enPassantTarget === one) markerIsPassedSquare++;
  }
  check('B: some double pushes exist to test', pushesFound > 0, true);
  check('B: every double push sets an EP marker', markersSet === pushesFound, true);
  check('B: the marker IS the passed square', markerIsPassedSquare === pushesFound, true);
}

// ── 2. The EP capture in B must remove the pawn that pushed ─────────────
{
  let tested = 0;
  let removedRightPawn = 0;
  let capturerOnPassedSquare = 0;
  for (const file of FILES) {
    const from = `${file}2` as SquareId;
    let board = put(bareBoard('B'), from, 'pawn', 'white');
    const { one, two } = pawnForwardTargets(from, 'white', 'B');
    if (!one || !two || board.pieces[one] || board.pieces[two]) continue;

    // Find a square a BLACK pawn could capture FROM onto the passed
    // square. In B "diagonally behind" is not a coordinate offset, so ask
    // the topology which squares actually attack `one`.
    const blackFrom = allPawnSquares().find(
      (sq) => !board.pieces[sq] && sq !== two && pawnCaptureTargets(sq, 'black', 'B').includes(one),
    );
    if (!blackFrom) continue;
    board = put(board, blackFrom, 'pawn', 'black');

    const afterPush = applyMove({ ...board, sideToMove: 'white' }, { from, to: two, kind: 'normal' });
    if (afterPush.enPassantTarget !== one) continue;

    const epMove = generateLegalMoves(afterPush).find(
      (m) => m.kind === 'enPassant' && m.from === blackFrom,
    );
    if (!epMove) continue;
    tested++;
    const afterEp = applyMove(afterPush, epMove);
    if (!afterEp.pieces[two]) removedRightPawn++;
    if (afterEp.pieces[one]?.color === 'black') capturerOnPassedSquare++;
  }
  check('B: at least one EP capture is reachable', tested > 0, true);
  check('B: EP removes the pawn that pushed', removedRightPawn === tested, true);
  check('B: EP lands the capturer on the passed square', capturerOnPassedSquare === tested, true);
}

// ── 3. No pawn may sit on the far rank without promoting ───────────────
// The stranded-pawn bug. Scanned over every square a pawn can stand on,
// not just rank 7: in B a pawn on b5 reaches b8 in one step, which is
// exactly the kind of jump the geometric rule has to cover.
{
  for (const topology of ['A', 'B'] as const) {
    let landings = 0;
    let promotions = 0;
    for (const from of allPawnSquares()) {
      const seed = bareBoard(topology);
      if (seed.pieces[from]) continue;
      const board = { ...put(seed, from, 'pawn', 'white'), sideToMove: 'white' as Color };
      for (const m of generateLegalMoves(board)) {
        if (m.from !== from || !m.to || Number(m.to[1]) !== 8) continue;
        landings++;
        if (m.kind === 'promotion') promotions++;
      }
    }
    check(`${topology}: moves onto rank 8 exist`, landings > 0, true);
    check(`${topology}: every move onto rank 8 is a promotion`, promotions === landings, true);
  }
}

// ── 4. A dead end in B must NOT promote ────────────────────────────────
// The follow-up bug: a7/d7/e7/h7 have no forward neighbour in topology B
// (a2/d2/e2/h2 for black), so a pawn capturing onto one of them promoted
// on the SEVENTH rank. Rotating back to A gives those squares their
// forward neighbour again, so a dead end in B is a temporary fold, not
// the end of the board.
{
  let deadEnds = 0;
  let wrongPromotions = 0;
  for (const from of allPawnSquares()) {
    const seed = bareBoard('B');
    if (seed.pieces[from]) continue;
    const board = { ...put(seed, from, 'pawn', 'white'), sideToMove: 'white' as Color };
    for (const m of generateLegalMoves(board)) {
      if (m.from !== from || !m.to) continue;
      if (Number(m.to[1]) === 8) continue; // the far rank SHOULD promote
      if (stepInDirection(m.to, 0, 1, 'B') !== null) continue;
      deadEnds++;
      if (m.kind === 'promotion') wrongPromotions++;
    }
  }
  check('B: dead-end squares below rank 8 exist', deadEnds > 0, true);
  check('B: a dead end does NOT promote', wrongPromotions, 0);
}

// ── 5. Nothing can be permanently stranded ─────────────────────────────
// Topology A has no dead ends below rank 8, so a pawn that runs out of
// squares in B always gets them back after one rotation.
{
  let deadInA = 0;
  for (const from of allPawnSquares()) {
    if (Number(from[1]) === 8) continue;
    if (stepInDirection(from, 0, 1, 'A') === null) deadInA++;
    if (Number(from[1]) === 1) continue;
    if (stepInDirection(from, 0, -1, 'A') === null) deadInA++;
  }
  check('A has no dead ends below the far rank', deadInA, 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
