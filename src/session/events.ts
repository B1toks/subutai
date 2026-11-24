import type { BoardState, Move } from '../engine';
import { findKing, isInCheck } from '../engine/moves';
import { promoteStrandedPawns } from '../engine/auxetic';
import { samePieces } from '../features/game/position';
import type { Actor, SessionEvent } from './types';

/**
 * What one log entry did, going from `before` to `after`: the move, a
 * capture (its victim read off `before`), a promotion, a rotation with the
 * pawns it promoted, and a check on the side now to move.
 *
 * The pawns a rotation promoted are the ones promoteStrandedPawns finds on
 * `before`, and only when that is how `after` came about — a board put on
 * the table from elsewhere (a resumed game) promotes nothing.
 */
export function eventsOfEntry(
  before: BoardState,
  after: BoardState,
  move: Move,
  san: string,
  actor: Actor,
  index: number,
): SessionEvent[] {
  const by = before.sideToMove;
  const events: SessionEvent[] = [{ type: 'move', move, san, by, actor, index }];
  if (move.kind === 'topologyToggle') {
    const { pieces, promoted } = promoteStrandedPawns(before.pieces, after.topologyState);
    const real = before.topologyState !== after.topologyState && samePieces(pieces, after.pieces);
    events.push({ type: 'rotation', by, promoted: real ? promoted : [] });
  } else {
    // A Chess960 castle can take the king onto its own rook's square: what
    // stands there is not taken (P7). Nor is any piece of the mover's own.
    const target = move.to && move.kind !== 'castle' ? before.pieces[move.to] : undefined;
    const victim = target && target.color !== by ? target : undefined;
    if (victim && move.to) {
      events.push({ type: 'capture', square: move.to, piece: victim.type, enPassant: false });
    } else if (move.kind === 'enPassant' && move.to) {
      events.push({ type: 'capture', square: move.to, piece: 'pawn', enPassant: true });
    }
    if (move.kind === 'promotion' && move.promotion && move.to) {
      events.push({ type: 'promotion', square: move.to, piece: move.promotion });
    }
  }
  if (findKing(after, after.sideToMove) && isInCheck(after)) {
    events.push({ type: 'check', side: after.sideToMove });
  }
  return events;
}
