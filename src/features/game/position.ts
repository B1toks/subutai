import type { BoardState, Move, Piece, SquareId } from '../../engine';
import { applyMove, checkDrawConditions, findKing, isCheckmate } from '../../engine/moves';
import { applyRotationMove } from '../../engine/auxetic';
import { evaluate, PIECE_VALUE } from '../../ai/evaluate';
import type { GameLog } from '../../recording/log';
import type { GameMode, GameStatus } from '../../shared/game';

// Questions asked of a position: its 960 key, whether two boards hold the
// same pieces, how the eval moves with a move, what a log replays to, and
// whether the game is over.

export function backRankString(boardState: BoardState): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const abbrev: Record<string, string> = {
    rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K',
  };
  return files
    .map((f) => {
      const piece = boardState.pieces[`${f}1` as SquareId];
      return piece ? abbrev[piece.type] ?? '?' : '?';
    })
    .join('');
}

/** Same piece of the same colour on every occupied square. */
export function samePieces(a: BoardState['pieces'], b: BoardState['pieces']): boolean {
  const occupied = (p: BoardState['pieces']) =>
    Object.keys(p).filter((sq) => p[sq as SquareId]);
  const squares = occupied(a);
  if (squares.length !== occupied(b).length) return false;
  return squares.every((sq) => {
    const x = a[sq as SquareId];
    const y = b[sq as SquareId];
    return !!x && !!y && x.type === y.type && x.color === y.color;
  });
}

/** The piece `move` takes where it lands (en passant aside), if any. A
 *  Chess960 castle can take the king onto its own rook's square: that rook
 *  is not taken (P7), nor is any piece of the moving piece's own colour
 *  (read off the piece, not the side to move: a Roulette bag's second
 *  action is played on a board that already shows the other side to
 *  move). The capture events (session/events.ts) and the eval bump below
 *  both read it. */
export function takenBy(before: BoardState, move: Move): Piece | undefined {
  const target = move.to && move.kind !== 'castle' ? before.pieces[move.to] : undefined;
  const mover = move.from ? before.pieces[move.from] : undefined;
  return target && target.color !== mover?.color ? target : undefined;
}

// B3 — eval-bar stability. Dropping the search eval to null between
// moves made the bar flicker: search → static fallback → worker. Now
// the previous search eval is *bumped* by the move's material delta
// (the dominant term) so the bar shifts once toward the truth and the
// worker only fine-tunes it ~1s later.
export function bumpEvalForMove(
  prevEval: number | null,
  stateBefore: BoardState,
  move: Move,
): number | null {
  if (prevEval === null) return null;
  if (move.kind === 'topologyToggle' || !move.to) return prevEval;
  let delta = 0;
  const victim = takenBy(stateBefore, move);
  if (victim) {
    delta += PIECE_VALUE[victim.type] * (victim.color === 'black' ? 1 : -1);
  } else if (move.kind === 'enPassant') {
    const mover = move.from ? stateBefore.pieces[move.from] : undefined;
    delta += PIECE_VALUE.pawn * (mover?.color === 'white' ? 1 : -1);
  }
  if (move.kind === 'promotion' && move.promotion && move.from) {
    const mover = stateBefore.pieces[move.from];
    const gain = PIECE_VALUE[move.promotion] - PIECE_VALUE.pawn;
    delta += gain * (mover?.color === 'white' ? 1 : -1);
  }
  return prevEval + delta;
}

// White-perspective static eval. evaluate() returns the score for sideToMove,
// so we negate when it's Black's turn — this way + always means White is ahead.
export function evaluateFromWhite(state: BoardState): number {
  const raw = evaluate(state);
  return state.sideToMove === 'white' ? raw : -raw;
}

// Replay the first `moveCount` entries of a log on top of its initialState.
// Returns the resulting BoardState — used by watching-mode to project the
// current frame without mutating the underlying log.
export function replayBoardAt(replayLog: GameLog, moveCount: number): BoardState {
  let cur: BoardState = replayLog.initialState;
  const cap = Math.min(moveCount, replayLog.moves.length);
  for (let i = 0; i < cap; i++) {
    const mv = replayLog.moves[i].move;
    if (mv.kind === 'topologyToggle') {
      cur = applyRotationMove(cur);
    } else {
      cur = applyMove(cur, mv);
    }
  }
  return cur;
}

/** The ending this board is in under `gameMode`'s rules, if any. */
export function gameEnding(
  gameMode: GameMode,
  nextState: BoardState,
  lastMoveWasRotation: boolean = false,
): Exclude<GameStatus, 'active'> | null {
  // Q.D.8: roulette is capture-the-king — the ONLY terminal is a missing
  // king. No checkmate, no stalemate, no draws (the variant deliberately
  // skips them so play continues until a king is actually taken).
  if (gameMode === 'roulette') {
    if (!findKing(nextState, 'white')) return 'king_captured_black_wins';
    if (!findKing(nextState, 'black')) return 'king_captured_white_wins';
    return null;
  }
  // Classic mode: standard chess termination — checkmate, stalemate,
  // draw by repetition / 50-move / insufficient material.
  if (isCheckmate(nextState, lastMoveWasRotation)) return 'checkmate';
  const draw = checkDrawConditions(nextState, lastMoveWasRotation);
  if (draw === 'stalemate') return 'draw_stalemate';
  if (draw === 'insufficient_material') return 'draw_material';
  if (draw === 'threefold_repetition') return 'draw_repetition';
  if (draw === 'fifty_move_rule') return 'draw_50move';
  return null;
}
