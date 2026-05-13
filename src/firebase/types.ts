import type { Timestamp } from 'firebase/firestore';
import type { GameOutcome } from '../analysis/points';

export interface BestGameSnapshot {
  chess960Id: string;
  moveCount: number;
  outcome: GameOutcome;
  createdAt: Timestamp;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  displayNameLower: string;
  createdAt: Timestamp;
  lastActive: Timestamp;
  // Stage B / C — written by saveCompletedGame; absent for fresh accounts.
  gamesPlayed?: number;
  gamesWon?: number;
  gamesDrawn?: number;
  bestGamePoints?: number;
  bestGameId?: string;
  bestGameSnapshot?: BestGameSnapshot;
  longestSurvivalMoves?: number;
  lastGameAt?: Timestamp;
}

export interface DisplayNameEntry {
  uid: string;
  createdAt: Timestamp;
}
