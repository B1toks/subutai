import type { BoardState, Color, Move, PieceType } from '../engine';
import { findKing, generateLegalMoves, isSquareAttacked } from '../engine/moves';
import { toggleTopology } from '../engine/auxetic';
import { isPieceMovableInRoulette } from '../features/game/roulette';
import type { GameMode } from '../shared/game';

// The questions step() asks of a board under a mode's rules.

/** Every move the side to move may make: Roulette has no check rule. */
export function legalMovesFor(mode: GameMode, board: BoardState): Move[] {
  return generateLegalMoves(board, { allowSelfCheck: mode === 'roulette' });
}

/** Roulette: the moves a bag allows, `used` slots spent. */
export function playableRouletteMoves(
  board: BoardState,
  slots: readonly PieceType[],
  used: readonly number[],
): Move[] {
  return generateLegalMoves(board, { allowSelfCheck: true }).filter((m) => {
    if (!m.from) return false;
    const p = board.pieces[m.from];
    if (!p) return false;
    return isPieceMovableInRoulette(p.type, board, 'roulette', [...slots], [...used]);
  });
}

/** Classic: does turning the board leave the mover's king standing safe? */
export function rotationKeepsKingSafe(board: BoardState): boolean {
  const toggled = toggleTopology(board);
  const king = findKing(toggled, board.sideToMove);
  if (!king) return false;
  const opponent: Color = board.sideToMove === 'white' ? 'black' : 'white';
  return !isSquareAttacked(toggled, king, opponent, toggled.topologyState);
}

/** The same move, as two Move objects from different lists see it. */
export function sameMove(a: Move, b: Move): boolean {
  return (
    a.kind === b.kind &&
    a.from === b.from &&
    a.to === b.to &&
    a.promotion === b.promotion &&
    a.castleRookFrom === b.castleRookFrom &&
    a.castleRookTo === b.castleRookTo
  );
}

export function otherColor(c: Color): Color {
  return c === 'white' ? 'black' : 'white';
}
