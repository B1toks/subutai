import type { BoardState, Color, Piece, PieceType, SquareId } from '../engine/types';
import { computePhase, pstValue } from './pst';

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

function opposite(c: Color): Color {
  return c === 'white' ? 'black' : 'white';
}

/**
 * Static evaluation from the perspective of state.sideToMove.
 * Positive = good for side to move.
 */
export function evaluate(state: BoardState): number {
  const side = state.sideToMove;
  const phase = computePhase(state);
  let score = 0;

  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (!piece) continue;
    const sign = piece.color === side ? 1 : -1;
    score += sign * (PIECE_VALUE[piece.type] + pstValue(piece.type, piece.color, sq, phase));
  }

  const opp = opposite(side);
  score += pawnStructureScore(state, side) - pawnStructureScore(state, opp);
  score += bishopPairBonus(state, side) - bishopPairBonus(state, opp);
  score += TEMPO;

  return score;
}

// ---- Pawn structure ---------------------------------------------------------

/** file → list of ranks occupied by colour's pawns. */
function pawnsByFile(state: BoardState, color: Color): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (!piece || piece.type !== 'pawn' || piece.color !== color) continue;
    const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = Number(sq[1]);
    const list = map.get(file);
    if (list) list.push(rank);
    else map.set(file, [rank]);
  }
  return map;
}

function isPassed(
  rank: number,
  file: number,
  color: Color,
  oppPawns: Map<number, number[]>,
): boolean {
  // No enemy pawns on this file or adjacent files in front of us.
  for (let f = file - 1; f <= file + 1; f++) {
    const enemyRanks = oppPawns.get(f);
    if (!enemyRanks) continue;
    for (const er of enemyRanks) {
      if (color === 'white' ? er > rank : er < rank) return false;
    }
  }
  return true;
}

function pawnStructureScore(state: BoardState, color: Color): number {
  const my = pawnsByFile(state, color);
  const opp = pawnsByFile(state, opposite(color));
  let score = 0;

  for (let file = 0; file < 8; file++) {
    const ranks = my.get(file);
    if (!ranks || ranks.length === 0) continue;

    // Doubled pawns: each extra pawn on the file costs DOUBLED_PENALTY.
    if (ranks.length > 1) score -= DOUBLED_PENALTY * (ranks.length - 1);

    // Isolated pawn: no friendly pawns on the two adjacent files at all.
    const leftEmpty = (my.get(file - 1)?.length ?? 0) === 0;
    const rightEmpty = (my.get(file + 1)?.length ?? 0) === 0;
    if (leftEmpty && rightEmpty) score -= ISOLATED_PENALTY;

    // Passed pawn: bonus scales with advancement toward the promotion rank.
    for (const rank of ranks) {
      if (isPassed(rank, file, color, opp)) {
        const advancement = color === 'white' ? rank - 1 : 8 - rank;
        score += PASSED_PER_RANK * advancement;
      }
    }
  }
  return score;
}

// ---- Bishop pair ------------------------------------------------------------

function bishopPairBonus(state: BoardState, color: Color): number {
  let count = 0;
  for (const piece of Object.values(state.pieces)) {
    if (!piece) continue;
    if (piece.color === color && piece.type === 'bishop') count++;
    if (count >= 2) return BISHOP_PAIR;
  }
  return 0;
}
