/**
 * A store around a pure step function: the one place a state changes.
 *
 * Same singleton-outside-React pattern as beatEngine / moveVoting /
 * dockLayout: dispatch runs `step`, keeps the state it returns, and tells
 * two kinds of listener: `subscribe` (React, through useSyncExternalStore
 * in useSession.ts: "something changed, read again") and `onEvents`
 * (whoever reacts to what happened: sound, effects, saves).
 *
 * An action `step` refuses comes back as the same state object; nobody
 * is told and nothing re-renders.
 */
export interface Store<S, A, E> {
  getState(): S;
  /** Runs the action; returns what happened (empty when refused). */
  dispatch(action: A): readonly E[];
  subscribe(listener: () => void): () => void;
  onEvents(listener: (events: readonly E[], state: S) => void): () => void;
}

export function createStore<S, A, E>(
  initial: S,
  stepFn: (state: S, action: A) => { state: S; events: readonly E[] },
): Store<S, A, E> {
  let state = initial;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(events: readonly E[], state: S) => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const out = stepFn(state, action);
      if (out.state === state) return out.events;
      state = out.state;
      for (const l of [...listeners]) l();
      if (out.events.length > 0) {
        for (const l of [...eventListeners]) l(out.events, state);
      }
      return out.events;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEvents(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  };
}
