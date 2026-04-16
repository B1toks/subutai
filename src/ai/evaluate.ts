import type { BoardState, Color, Piece, PieceType, PieceMap, SquareId, TopologyState } from '../engine/types';
import { rayFrom, knightTargets } from '../engine/auxetic';

export const PIECE_VALUE: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000,
};

/**
 * Static evaluation from the perspective of state.sideToMove.
 * Positive = good for side to move.
 */
export function evaluate(state: BoardState): number {
  const side = state.sideToMove;
  const topo = state.topologyState;
  let score = 0;

  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (!piece) continue;
    const sign = piece.color === side ? 1 : -1;
    score += sign * PIECE_VALUE[piece.type];
    score += sign * pieceActivity(sq, piece.type, piece.color, topo, state.pieces);
  }

  return score;
}

const DIAG: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STRAIGHT: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL_DIRS: readonly (readonly [number, number])[] = [...STRAIGHT, ...DIAG];

function pieceActivity(
  sq: SquareId,
  type: PieceType,
  color: Color,
  topo: TopologyState,
  pieces: PieceMap,
): number {
  switch (type) {
    case 'pawn': {
      const rank = Number(sq[1]);
      return (color === 'white' ? rank - 2 : 7 - rank) * 5;
    }
    case 'knight':
      return knightTargets(sq, topo).length * 3;
    case 'bishop':
      return slidingReach(sq, DIAG, topo, pieces) * 3;
    case 'rook':
      return slidingReach(sq, STRAIGHT, topo, pieces) * 2;
    case 'queen':
      return slidingReach(sq, ALL_DIRS, topo, pieces) * 1;
    case 'king': {
      let reach = 0;
      for (const [df, dr] of ALL_DIRS) {
        if (rayFrom(sq, df, dr, topo).length > 0) reach++;
      }
      return reach;
    }
  }
}

function slidingReach(
  sq: SquareId,
  dirs: readonly (readonly [number, number])[],
  topo: TopologyState,
  pieces: PieceMap,
): number {
  let count = 0;
  for (const [df, dr] of dirs) {
    for (const t of rayFrom(sq, df, dr, topo)) {
      count++;
      if (pieces[t] !== undefined) break;
    }
  }
  return count;
}
