import { startPresenceHeartbeat, stopPresenceHeartbeat } from '../../firebase/presence';
import type { PresenceRepo } from '../repos';

/** PresenceRepo on Firestore: each call is the src/firebase function. */
export const presenceRepo: PresenceRepo = {
  start: startPresenceHeartbeat,
  stop: stopPresenceHeartbeat,
};
