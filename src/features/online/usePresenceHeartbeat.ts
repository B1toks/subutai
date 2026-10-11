import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from '../../firebase/presence';

interface UsePresenceHeartbeatArgs {
  user: User | null;
  displayName: string | null;
}

/**
 * Keeps a signed-in player counted as online for quick match while the app
 * is open (the heartbeat's timing lives in firebase/presence.ts).
 */
export function usePresenceHeartbeat({ user, displayName }: UsePresenceHeartbeatArgs) {
  // R16 — presence heartbeat feeds the quick-match "online now" counter.
  // Signed-in users only (same gate as everything matchmaking touches).
  useEffect(() => {
    if (!user || !displayName) return;
    startPresenceHeartbeat(user.uid);
    return () => stopPresenceHeartbeat();
  }, [user, displayName]);
}
