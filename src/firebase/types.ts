import type { Timestamp } from 'firebase/firestore';
import type { GameOutcome } from '../analysis/points';

export interface BestGameSnapshot {
  chess960Id: string;
  moveCount: number;
  outcome: GameOutcome;
  createdAt: Timestamp;
  /** Wall-clock duration of the run, in ms. Optional for back-compat with
   *  snapshots written before Stage P / addendum 7. */
  durationMs?: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  displayNameLower: string;
  createdAt: Timestamp;
  lastActive: Timestamp;
  // Stage B / C — written by saveCompletedGame; absent for fresh accounts.
  // Classic-mode aggregates (legacy field names — kept for back-compat).
  gamesPlayed?: number;
  gamesWon?: number;
  gamesDrawn?: number;
  bestGamePoints?: number;
  bestGameId?: string;
  bestGameSnapshot?: BestGameSnapshot;
  longestSurvivalMoves?: number;
  lastGameAt?: Timestamp;
  // Stage O — roulette-mode aggregates live alongside in a separate field
  // group so the two leaderboards never cross-contaminate. Absent until the
  // player completes their first roulette game.
  rouletteGamesPlayed?: number;
  rouletteBestPoints?: number;
  rouletteBestGameId?: string;
  rouletteBestSnapshot?: BestGameSnapshot;
}

export interface DisplayNameEntry {
  uid: string;
  createdAt: Timestamp;
}
