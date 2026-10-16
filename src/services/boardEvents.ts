import type { GameStatus } from '../shared/game';
import type { SessionEvent } from '../session/types';

/**
 * What happens on the board, whatever game is on it: the session's events,
 * an online match's moves among them (actor 'remote'), forwarded by
 * startSessionServices. The board's sound and effects listen here.
 * `status` is the session's status after the batch (an online match does
 * not set it: it ends in its document).
 */
type Listener = (events: readonly SessionEvent[], status: GameStatus) => void;

const listeners = new Set<Listener>();

export const boardEvents = {
  emit(events: readonly SessionEvent[], status: GameStatus): void {
    if (events.length === 0) return;
    for (const l of [...listeners]) l(events, status);
  },
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
