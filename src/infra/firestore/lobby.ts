import { createMatch, joinMatch, subscribeMatch } from '../../firebase/matches';
import { findQuickMatch } from '../../firebase/quickMatch';
import { getOnlineCount } from '../../firebase/presence';
import type { LobbyRepo } from '../repos';

/** LobbyRepo on Firestore: each call is the src/firebase function. Only the
 *  lobby imports it, so quick-match code stays in the lobby's chunk. */
export const lobbyRepo: LobbyRepo = {
  create: createMatch,
  join: joinMatch,
  subscribe: subscribeMatch,
  findQuick: findQuickMatch,
  onlineCount: getOnlineCount,
};
