import type { BoardState, Color, PieceType } from '../engine/types';
import { allSquares } from '../engine/board';
import { EG_TABLES, MAX_PHASE, MG_TABLES, PHASE_WEIGHTS } from './pst';

export const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000,
};

const BISHOP_PAIR = 30;
const DOUBLED_PENALTY = 20;
const ISOLATED_PENALTY = 15;
const PASSED_PER_RANK = 20;
const TEMPO = 10;

/**
 * Static evaluation from the perspective of state.sideToMove.
 * Positive = good for side to move.
 *
 * One pass over the 64 pre-built squares accumulates: phase, MG/EG material
 * + PST, per-file pawn bitsets, and bishop counts. Pawn structure and
 * bishop pair are then derived from those accumulators without re-scanning
 * the board. The previous implementation walked Object.entries up to eight
 * times per call — the GC pressure alone dominated the deep-search hot
 * path. Result is float (no Math.round) but the search compares scores
 * with > / >= and stores them as plain numbers, so sub-cp precision is
 * irrelevant for ordering decisions.
 */
export function evaluate(state: BoardState): number {
  let phase = 0;
  let mgFromWhite = 0;
  let egFromWhite = 0;

  // Per-file rank bitsets per color: bit (rank-1) is set if a pawn sits
  // on that file at that rank. Lets pawn structure run as a few bitwise
  // ops per file rather than another Object.entries iteration.
  const pawnsW = [0, 0, 0, 0, 0, 0, 0, 0];
  const pawnsB = [0, 0, 0, 0, 0, 0, 0, 0];
  let bishopsW = 0;
  let bishopsB = 0;

  // allSquares is ordered: i=0..7 → a1..a8, i=8..15 → b1..b8, …, i=56..63 → h1..h8.
  // So file = i >> 3 and rank = (i & 7) + 1 — avoids 2 charCodeAt calls per piece.
  const pieces = state.pieces;
  for (let i = 0; i < 64; i++) {
    const piece = pieces[allSquares[i]];
    if (!piece) continue;

    const type = piece.type;
    phase += PHASE_WEIGHTS[type];

    const file = i >> 3;
    const rankIdx = i & 7; // 0..7 = rank 1..8

    const isWhite = piece.color === 'white';
    // White: row 0 = rank 8. Black mirrors vertically.
    const row = isWhite ? 7 - rankIdx : rankIdx;
    const idx = row * 8 + file;
    const pv = PIECE_VALUE[type];
    const mg = pv + MG_TABLES[type][idx];
    const eg = pv + EG_TABLES[type][idx];

    if (isWhite) {
      mgFromWhite += mg;
      egFromWhite += eg;
      if (type === 'pawn') pawnsW[file] |= 1 << rankIdx;
      else if (type === 'bishop') bishopsW++;
    } else {
      mgFromWhite -= mg;
      egFromWhite -= eg;
      if (type === 'pawn') pawnsB[file] |= 1 << rankIdx;
      else if (type === 'bishop') bishopsB++;
    }
  }

  if (phase > MAX_PHASE) phase = MAX_PHASE;

  let scoreFromWhite =
    (mgFromWhite * phase + egFromWhite * (MAX_PHASE - phase)) / MAX_PHASE;

  scoreFromWhite +=
    pawnStructureFromBits(pawnsW, pawnsB, 'white') -
    pawnStructureFromBits(pawnsB, pawnsW, 'black');

  if (bishopsW >= 2) scoreFromWhite += BISHOP_PAIR;
  if (bishopsB >= 2) scoreFromWhite -= BISHOP_PAIR;

  return state.sideToMove === 'white'
    ? scoreFromWhite + TEMPO
    : -scoreFromWhite + TEMPO;
}

// ---- Pawn structure (bitset-driven) ----------------------------------------

/** Compute doubled / isolated / passed-pawn bonuses for `color` from
 *  per-file rank bitsets. Semantics match the original Map-based version. */
function pawnStructureFromBits(
  my: number[],
  opp: number[],
  color: Color,
): number {
  let score = 0;

  for (let file = 0; file < 8; file++) {
    const myBits = my[file];
    if (myBits === 0) continue;

    const count = popcount(myBits);
    if (count > 1) score -= DOUBLED_PENALTY * (count - 1);

    const leftEmpty = file === 0 || my[file - 1] === 0;
    const rightEmpty = file === 7 || my[file + 1] === 0;
    if (leftEmpty && rightEmpty) score -= ISOLATED_PENALTY;

    // Enemy pawns on this file or adjacent files are blockers for a passer.
    const oppMask =
      (file > 0 ? opp[file - 1] : 0) |
      opp[file] |
      (file < 7 ? opp[file + 1] : 0);

    // Walk only the bits that are set — for typical games this is 1-2 ranks.
    let bits = myBits;
    while (bits !== 0) {
      const rankIdx = lowestBitIndex(bits); // 0..7 = rank 1..8
      bits &= bits - 1;
      const rank = rankIdx + 1;
      // "Ahead" for the passer check: enemy bits at strictly higher rank
      // (white) or strictly lower rank (black).
      const aheadMask =
        color === 'white'
          ? (0xff << rank) & 0xff
          : (1 << rankIdx) - 1;
      if ((oppMask & aheadMask) === 0) {
        const advancement = color === 'white' ? rank - 1 : 8 - rank;
        score += PASSED_PER_RANK * advancement;
      }
    }
  }
  return score;
}

function popcount(n: number): number {
  // Brian Kernighan — bounded by set-bit count, fine for 8-bit values.
  let c = 0;
  let x = n;
  while (x !== 0) {
    x &= x - 1;
    c++;
  }
  return c;
}

function lowestBitIndex(n: number): number {
  // n must be non-zero. Math.log2 is precise for powers of two; `n & -n`
  // isolates the lowest set bit.
  return Math.log2(n & -n);
}
