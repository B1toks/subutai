import type { BoardState, Color, Move } from '../../engine';
import type { Action, SessionEvent } from '../types';
import type { Player } from './types';

/** Waits for the turn to end; `onEnd` runs as it does. */
function untilEnd(signal: AbortSignal, onEnd: () => void): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      onEnd();
      reject(signal.reason);
    }, { once: true });
  });
}

export interface ChatPlayerOptions {
  readonly color: Color;
  /** Opens chat's vote on this turn's move (moveVoting.gateHumanMove);
   *  resolves with the elected move, or null for none. */
  readonly elect: (board: BoardState, legal: Move[]) => Promise<Move | null>;
  /** Drops a vote still running (moveVoting.cancelRound). */
  readonly cancel: () => void;
  /** Chat's move (or rotation) has run, from `before`, as move `index`
   *  of the log: what follows a played move. */
  readonly played: (action: Action, events: readonly SessionEvent[], before: BoardState, index: number) => void;
}

/**
 * Chat vs bot: Twitch chat plays this side by majority. On each turn chat
 * votes (classic games only), and the elected move or rotation is played.
 * The player here shares the seat: a move made at this device first goes
 * through turns.act and ends the turn, which drops the vote, as a manual
 * move always cancelled the round.
 */
export function createChatPlayer(opts: ChatPlayerOptions): Player {
  let from: { board: BoardState; index: number } | null = null;
  return {
    color: opts.color,
    kind: 'chat',
    async onTurn(s, signal) {
      const ended = untilEnd(signal, opts.cancel);
      ended.catch(() => {}); // also when chat's move is played first
      if (s.mode !== 'classic') return ended;
      const move = await Promise.race([opts.elect(s.board, s.legal as Move[]), ended]);
      signal.throwIfAborted();
      if (!move) return ended;
      from = { board: s.board, index: s.log.moves.length };
      // R10 — chat elected to rotate the board as its move; the rotation
      // is checked by the session as any other (step.ts rotate).
      if (move.kind === 'topologyToggle') return { type: 'rotate', actor: 'chat', now: Date.now() };
      if (!move.from || !move.to) return ended;
      return { type: 'move', move, actor: 'chat', now: Date.now() };
    },
    onPlayed(action, events) {
      const f = from;
      from = null;
      if (f) opts.played(action, events, f.board, f.index);
    },
  };
}

export interface GuessOptions {
  /** Opens chat's guess at the move the player here is about to make
   *  (moveVoting.openGuessRound). */
  readonly open: (board: BoardState, legal: Move[]) => void;
  /** Drops a guess not yet revealed (moveVoting.cancelRound). */
  readonly cancel: () => void;
}

/**
 * Guess the streamer: the player here, while chat guesses each move they
 * make (classic games only). The round opens with the turn and is dropped
 * when the turn ends unrevealed; the player's own move reveals it first,
 * where it is made (the click), and a revealed round is left alone.
 */
export function withGuess(player: Player, opts: GuessOptions): Player {
  return {
    ...player,
    onTurn(s, signal) {
      if (s.mode === 'classic') opts.open(s.board, s.legal as Move[]);
      return untilEnd(signal, opts.cancel);
    },
  };
}
