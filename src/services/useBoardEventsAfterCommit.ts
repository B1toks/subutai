import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { GameStatus } from '../shared/game';
import type { SessionEvent } from '../session/types';
import { boardEvents } from './boardEvents';

type Batch = { events: readonly SessionEvent[]; status: GameStatus };

/**
 * Hands the board's events to `handler` after React has committed the
 * render they caused: where the effects that used to watch the move log
 * ran. Anything timed from them (how long a spark stays, when a sound
 * plays) is then timed from what is on screen, as it always was, and not
 * from the moment the move was decided, a render earlier. Batches that
 * arrive between two commits come out one by one, in order.
 */
export function useBoardEventsAfterCommit(
  handler: (events: readonly SessionEvent[], status: GameStatus) => void,
): void {
  const queueRef = useRef<Batch[]>([]);
  const [arrived, setArrived] = useState(0);
  const run = useEffectEvent(handler);

  useEffect(
    () =>
      boardEvents.on((events, status) => {
        queueRef.current.push({ events, status });
        setArrived((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    for (const batch of queueRef.current.splice(0)) run(batch.events, batch.status);
  }, [arrived]);
}
