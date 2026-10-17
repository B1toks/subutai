import { fetchLeaderboardPage } from '../../firebase/leaderboard';
import type { LeaderboardRepo } from '../repos';

/** LeaderboardRepo on Firestore: the src/firebase function. Only the lazy
 *  screens that show the board import it. */
export const leaderboardRepo: LeaderboardRepo = {
  page: fetchLeaderboardPage,
};
