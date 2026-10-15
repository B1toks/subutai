// TODO(B3): delete this file. Online moves reach the session through the
// Remote player then, and their events come out of step() like every
// other move.
import { useEffect, useRef } from 'react';
import type { BoardState } from '../engine';
import type { GameLog } from '../recording/log';
import { eventsOfEntry } from '../session/events';
import { session } from '../session/session';
import { statusOf } from '../session/step';
import { boardEvents } from './boardEvents';

/**
 * Online play still lives in the match document, so its moves make no
 * session events. This turns the match as App sees it (`state`, `log`,
 * the read-side aliases) into the same events for the board's sound and
 * effects: when the log grows, its last entry plays out against the board
 * that stood before it. That is how those effects used to find every move;
 * now nothing outside this file does.
 */
export function useOnlineBoardEvents({
  isMultiplayer,
  state,
  log,
}: {
  isMultiplayer: boolean;
  state: BoardState;
  log: GameLog;
}) {
  // The board as it stood before the latest entry: the snapshot effect is
  // declared after the one that reads it, so within one commit the read
  // sees the pre-move board and only then the ref moves on.
  const prevBoardRef = useRef<BoardState | null>(null);
  const prevLengthRef = useRef(log.moves.length);

  useEffect(() => {
    const length = log.moves.length;
    const grew = length > prevLengthRef.current;
    prevLengthRef.current = length;
    if (!isMultiplayer || !grew) return;
    const last = log.moves[length - 1];
    const before = prevBoardRef.current;
    if (!last || !before) return;
    boardEvents.emit(
      eventsOfEntry(before, state, last.move, last.san ?? '', 'remote', length - 1),
      statusOf(session.getState()),
    );
    // `state` is read for the board this entry produced; the effect keys
    // off the move count, as the effects it replaces did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.moves.length]);

  useEffect(() => {
    prevBoardRef.current = state;
  }, [state]);
}
