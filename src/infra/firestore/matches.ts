import { rejoinMatch, subscribeMatch } from '../../firebase/matches';
import type { MatchesRepo } from '../repos';

/** MatchesRepo on Firestore: each call is the src/firebase function. */
export const matchesRepo: MatchesRepo = {
  rejoin: rejoinMatch,
  subscribe: subscribeMatch,
};
