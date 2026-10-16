import type { Color } from '../../engine';
import type { Action, SessionEvent, SessionState } from '../types';

/**
 * Whoever plays one side of the game on the board.
 *
 * When it is that side's turn, the turns (turns.ts) ask it for an action
 * with `onTurn` and run what it answers. The signal aborts when the turn
 * is over before the answer came: the other side's clock fell, the game
 * was resigned or replaced, the seats changed. An answer that comes after
 * that is dropped.
 *
 * A player at this device answers by acting (see human.ts): its onTurn
 * never resolves, and its moves go through `turns.act` at once, as the
 * click that makes them.
 */
export interface Player {
  readonly color: Color;
  readonly kind: 'human' | 'bot' | 'remote' | 'chat';
  onTurn(state: SessionState, signal: AbortSignal): Promise<Action>;
  /** What the action it answered did, once the session has run it (no
   *  events: the session refused it). */
  onPlayed?(action: Action, events: readonly SessionEvent[]): void;
}

/** Who plays each side here. A side with no player is nobody's to move
 *  from this device (the other player's in an online match). */
export type Seats = { readonly [C in Color]: Player | null };
