import type { BoardState, Move, SquareId } from '../../engine';
import type { GameLog } from '../../recording/log';
import type { GameStatus } from '../../shared/game';

/** A saved game opened from the leaderboard and played back on the board. */
export interface WatchingGame {
  log: GameLog;
  playerName: string;
  gameId: string;
  currentMoveIdx: number;
  autoplay: boolean;
}

/** The solo game put aside while watching, restored when watching stops. */
export interface GameBackup {
  seed: number;
  state: BoardState;
  initialState: BoardState;
  legalMoves: Move[];
  log: GameLog;
  gameStatus: GameStatus;
  lastMove: { from?: SquareId; to?: SquareId } | null;
  liveSavedGameId: string;
  savedForLogId: string | null;
  completedLogId: string | null;
  searchEvalFromWhite: number | null;
  searchMateInPlies: number | null;
  formationLocked: boolean;
  lockedFormationKey: string | null;
  /** The time each side had used (a timed game's clock goes on from it). */
  clock: { white: number; black: number };
}
