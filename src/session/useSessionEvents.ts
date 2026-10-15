import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { session } from './session';
import type { SessionEvent } from './types';

/**
 * Hands the session's events to `handler` after React has committed the
 * render they caused, where an effect watching the game would have run:
 * the handler reads the game as the component now shows it (its latest
 * props and state). Batches that arrive between two commits come out one
 * by one, in order.
 */
export function useSessionEventsAfterCommit(
  handler: (events: readonly SessionEvent[]) => void,
): void {
  const queueRef = useRef<(readonly SessionEvent[])[]>([]);
  const [arrived, setArrived] = useState(0);
  const run = useEffectEvent(handler);

  useEffect(
    () =>
      session.onEvents((events) => {
        queueRef.current.push(events);
        setArrived((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    for (const events of queueRef.current.splice(0)) run(events);
  }, [arrived]);
}
