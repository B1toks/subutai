import { useSyncExternalStore } from 'react';
import { session } from './session';
import type { SessionState } from './types';

/**
 * Reads the session. The component re-renders when the selected value
 * changes (by identity), so a selector returns a piece of the state as
 * it is (`s => s.board`), never a new object or array built on the spot:
 * that would be a "change" on every read.
 */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useSyncExternalStore(session.subscribe, () => selector(session.getState()));
}
