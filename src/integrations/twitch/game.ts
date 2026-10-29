import type { Store } from '../../session/store';
import { statusOf } from '../../session/step';
import type { Action, SessionEvent, SessionState } from '../../session/types';
import { twitchChat } from './chat';
import { moveVoting } from './moveVoting';
import {
  applyPrediction,
  emptyPredictions,
  tally,
  winnersFor,
  type GameResult,
  type PredictionPick,
} from './predictions';

type SessionStore = Store<SessionState, Action, SessionEvent>;
export type TwitchGameChange = 'newGame' | 'ended';

/** How the game on the board ended, as chat predicts it; null while it runs. */
export function resultOf(s: SessionState): GameResult | null {
  const status = statusOf(s);
  if (status === 'checkmate') {
    const board = s.online?.game?.board ?? s.board;
    return board.sideToMove === 'white' ? 'black' : 'white';
  }
  if (status === 'king_captured_white_wins') return 'white';
  if (status === 'king_captured_black_wins') return 'black';
  if (status === 'resigned_white') return 'black';
  if (status === 'resigned_black') return 'white';
  if (status.startsWith('draw')) return 'draw';
  return null;
}

/**
 * Chat's game: T2 result calls (!white / !black / !draw, the latest per
 * viewer) and the per-game leaderboard. It follows the session, so the
 * game on the board drives it, not the panel: a new game (another log)
 * clears the calls and the scores; the end of the game awards +3 to
 * whoever called it. TwitchPanel shows it.
 */
class TwitchGame {
  private predictions = emptyPredictions();
  private logId: string | null = null;
  private result: GameResult | null = null;
  private listeners = new Set<(what: TwitchGameChange) => void>();
  private following = false;

  /** Starts following the session and chat (connect()), once. */
  follow(store: SessionStore): void {
    if (this.following) return;
    this.following = true;
    twitchChat.onMessage((msg) => {
      applyPrediction(this.predictions, msg);
    });
    const refresh = () => {
      const s = store.getState();
      if (s.log.id !== this.logId) {
        const first = this.logId === null;
        this.logId = s.log.id;
        this.result = null;
        if (!first) {
          this.predictions = emptyPredictions();
          moveVoting.resetScores();
          this.emit('newGame');
        }
      }
      const result = resultOf(s);
      if (result !== this.result) {
        this.result = result;
        if (result) {
          moveVoting.awardResultCall(winnersFor(this.predictions, result));
          this.emit('ended');
        }
      }
    };
    store.subscribe(refresh);
    refresh();
  }

  /** The calls so far, per pick. */
  counts(): Record<PredictionPick, number> {
    return tally(this.predictions);
  }

  /** How the game ended; null while it runs. */
  getResult(): GameResult | null {
    return this.result;
  }

  /** A new game, or the game's end. */
  onChange(cb: (what: TwitchGameChange) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(what: TwitchGameChange) {
    for (const cb of this.listeners) cb(what);
  }
}

export const twitchGame = new TwitchGame();
