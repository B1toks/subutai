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
 *
 * A listener that throws does not stop the others, nor the dispatch: the
 * first such error is kept as the store's fatal error (getFatal), and the
 * React listeners are told again, so the app can throw it while it
 * renders and its error boundary shows the error screen, as an error in
 * the render itself would.
 */
export interface Store<S, A, E> {
  getState(): S;
  /** Runs the action; returns what happened (empty when refused). */
  dispatch(action: A): readonly E[];
  subscribe(listener: () => void): () => void;
  onEvents(listener: (events: readonly E[], state: S) => void): () => void;
  /** The first error a listener threw, as thrown; null while none has. */
  getFatal(): unknown;
}

export function createStore<S, A, E>(
  initial: S,
  stepFn: (state: S, action: A) => { state: S; events: readonly E[] },
): Store<S, A, E> {
  let state = initial;
  let fatal: unknown = null;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(events: readonly E[], state: S) => void>();

  /** Runs each listener; the first error any of them throws is kept. */
  function tell<L>(set: Set<L>, call: (l: L) => void): boolean {
    let failed = false;
    for (const l of [...set]) {
      try {
        call(l);
      } catch (err) {
        if (fatal === null) {
          fatal = err ?? new Error('a session listener threw nothing');
          failed = true;
        }
      }
    }
    return failed;
  }

  return {
    getState: () => state,
    dispatch(action) {
      const out = stepFn(state, action);
      if (out.state === state) return out.events;
      state = out.state;
      let failed = tell(listeners, (l) => l());
      if (out.events.length > 0) {
        if (tell(eventListeners, (l) => l(out.events, state))) failed = true;
      }
      // A listener failed: React reads the store again and finds the error.
      if (failed) tell(listeners, (l) => l());
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
    getFatal: () => fatal,
  };
}
