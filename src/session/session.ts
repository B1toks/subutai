import { createStartingPosition } from '../engine';
import { createStore } from './store';
import { createSession, step } from './step';
import { createTurns } from './players/turns';
import type { Action, SessionEvent, SessionState } from './types';

/** V1 — seed of the very first game of a page load: every visit starts
 *  from a fresh Chess960 position. */
export const FIRST_SEED = Date.now();

/** The game on the board. One per page: solo and hot-seat play read and
 *  change it here; online play still reads its own match document. */
export const session = createStore<SessionState, Action, SessionEvent>(
  createSession({ initial: createStartingPosition(FIRST_SEED), seed: FIRST_SEED, now: FIRST_SEED }),
  step,
);

/** Whose turn it is and who answers it (src/session/players). */
export const turns = createTurns(session);
