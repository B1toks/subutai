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
  const read = () => selector(session.getState());
  // The same read on the server (the rules tests render the online hook
  // there): no store is shared with a client to hydrate from.
  return useSyncExternalStore(session.subscribe, read, read);
}

/**
 * Throws, while rendering, the error a session listener threw (the
 * store's fatal error, store.ts), so the error boundary above shows the
 * error screen: a listener runs in a dispatch, where no boundary catches.
 */
export function useSessionFatal(): void {
  const fatal = useSyncExternalStore(session.subscribe, session.getFatal, session.getFatal);
  if (fatal !== null) throw fatal;
}
