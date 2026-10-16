import type { Color } from '../../engine';
import type { Action } from '../types';
import type { Player } from './types';

/**
 * The other player of an online match. Their moves are written to the
 * match document (src/firebase/matches.ts) by their device, and reach the
 * board as the session follows that document (session/online.ts), so
 * nothing is answered from here: onTurn only waits for the turn to end.
 * My own side of the match is not seated here either: my moves go to the
 * document (mpSync.sendMove) and come back the same way.
 */
export function createRemotePlayer(color: Color): Player {
  return {
    color,
    kind: 'remote',
    onTurn: (_state, signal) =>
      new Promise<Action>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  };
}

/** The opponent's side, either colour. */
export const remotePlayers = { white: createRemotePlayer('white'), black: createRemotePlayer('black') } as const;
