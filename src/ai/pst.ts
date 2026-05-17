import type { BoardState, Color, PieceType, SquareId } from '../engine/types';

// Standard "Simplified Evaluation Function" piece-square tables
// (https://www.chessprogramming.org/Simplified_Evaluation_Function).
// All tables are written from the WHITE perspective, row 8 first:
//   index 0..7   = a8..h8
//   index 56..63 = a1..h1
// Black lookups mirror vertically — see `pstIndexFor`.

const PAWN_MG: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

// Endgame pawn table emphasises advancement — passed pawns become decisive.
const PAWN_EG: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
  90, 90, 90, 90, 90, 90, 90, 90,
  50, 50, 50, 50, 50, 50, 50, 50,
  30, 30, 30, 30, 30, 30, 30, 30,
  20, 20, 20, 20, 20, 20, 20, 20,
  10, 10, 10, 10, 10, 10, 10, 10,
   5,  5,  5,  5,  5,  5,  5,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const KNIGHT_PST: readonly number[] = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

const BISHOP_PST: readonly number[] = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

const ROOK_PST: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];

const QUEEN_PST: readonly number[] = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

const KING_MG: readonly number[] = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const KING_EG: readonly number[] = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

export const MG_TABLES: Record<PieceType, readonly number[]> = {
  pawn: PAWN_MG,
  knight: KNIGHT_PST,
  bishop: BISHOP_PST,
  rook: ROOK_PST,
  queen: QUEEN_PST,
  king: KING_MG,
};

export const EG_TABLES: Record<PieceType, readonly number[]> = {
  pawn: PAWN_EG,
  knight: KNIGHT_PST,
  bishop: BISHOP_PST,
  rook: ROOK_PST,
  queen: QUEEN_PST,
  king: KING_EG,
};

/** 0..63 index into a PST for a piece on `square` of the given colour. */
export function pstIndexFor(color: Color, square: SquareId): number {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]); // 1..8
  // White: rank 8 maps to row 0; black mirrors vertically (rank 1 → row 0).
  const row = color === 'white' ? 8 - rank : rank - 1;
  return row * 8 + file;
}

/**
 * Game phase, 24 = full midgame, 0 = bare-king endgame. Used to interpolate
 * between the midgame and endgame piece-square tables so the king naturally
 * comes out to the centre as material drops.
 */
export const PHASE_WEIGHTS: Record<PieceType, number> = {
  pawn: 0,
  knight: 1,
  bishop: 1,
  rook: 2,
  queen: 4,
  king: 0,
};

export const MAX_PHASE = 24;

export function computePhase(state: BoardState): number {
  let p = 0;
  for (const piece of Object.values(state.pieces)) {
    if (!piece) continue;
    p += PHASE_WEIGHTS[piece.type];
  }
  return Math.min(p, MAX_PHASE);
}

/** Linear blend of MG and EG values. phase=MAX_PHASE returns mg, phase=0 returns eg. */
function interpolate(mg: number, eg: number, phase: number): number {
  return Math.round((mg * phase + eg * (MAX_PHASE - phase)) / MAX_PHASE);
}

export function pstValue(
  pieceType: PieceType,
  color: Color,
  square: SquareId,
  phase: number,
): number {
  const idx = pstIndexFor(color, square);
  const mg = MG_TABLES[pieceType][idx];
  const eg = EG_TABLES[pieceType][idx];
  return interpolate(mg, eg, phase);
}
