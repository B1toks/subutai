import type { Color } from '../../engine';
import type { Action } from '../types';
import type { Player } from './types';

/**
 * A player at this device. Its turn is answered by a click, a rotation,
 * a promotion piece picked: things the UI does with `turns.act`, which
 * runs them there and then, so a click changes the board in the same
 * event, as it always has. onTurn only waits for the turn to end.
 */
export function createHumanPlayer(color: Color): Player {
  return {
    color,
    kind: 'human',
    onTurn: (_state, signal) =>
      new Promise<Action>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  };
}

/** The player at this device, one per side: hot-seat seats both. */
export const humanPlayers = { white: createHumanPlayer('white'), black: createHumanPlayer('black') } as const;
