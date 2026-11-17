import { useEffect } from 'react';
import { moveSoundsOnEvents } from '../../services/moveSounds';
import { useBoardEventsAfterCommit } from '../../services/useBoardEventsAfterCommit';
import { useSession } from '../../session/useSession';
import { gameStatusOf, logOf } from './boardView';
import type { BoardUi } from './useBoardUi';

interface UseMoveFeedbackArgs {
  /** The board's own UI state (useBoardUi). */
  ui: BoardUi;
  isMultiplayer: boolean;
}

/**
 * What every new move sets off around the board: the checkmate flash on
 * <body> and the right-click annotations cleared (the move's sound is
 * src/services/moveSounds.ts). Also lets go of a right-drag released off
 * the board.
 */
export function useMoveFeedback({
  ui,
  isMultiplayer,
}: UseMoveFeedbackArgs) {
  const { setSquareAnnotations, setArrowAnnotations, annotationStartRef } = ui;
  const gameStatus = useSession(gameStatusOf);
  const log = useSession(logOf(isMultiplayer));
  // Sprint 3.2 — checkmate flash: brief radial whiteout via a body
  // class. Triggers whenever gameStatus transitions to 'checkmate'.
  // CSS animation handles cleanup; we still strip the class after the
  // animation length so the class doesn't sit on body indefinitely.
  useEffect(() => {
    if (gameStatus !== 'checkmate') return;
    document.body.classList.add('checkmate-flash');
    const t = setTimeout(() => {
      document.body.classList.remove('checkmate-flash');
    }, 1500);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('checkmate-flash');
    };
  }, [gameStatus]);

  // Sprint 3.4.1 — the per-capture burst useEffect that watched
  // log.moves.length has been removed; captures no longer get their
  // own visual flash (see state-declarations block above for the
  // rationale).

  // Sprint 3.7 — the move's sound (src/services/moveSounds.ts), after the
  // render that shows the move, where it always played.
  useBoardEventsAfterCommit(moveSoundsOnEvents);

  // Sprint 3.6 — clear annotations on every new move so the scratch
  // pad doesn't leak into the next ply. Plus a document-level
  // mouseup so a right-drag that's released off the board still
  // resets annotationStartRef instead of leaving it stuck.
  useEffect(() => {
    setSquareAnnotations((prev) => (prev.size === 0 ? prev : new Map()));
    setArrowAnnotations((prev) => (prev.length === 0 ? prev : []));
  }, [log.moves.length, setArrowAnnotations, setSquareAnnotations]);

  useEffect(() => {
    function onUp(e: MouseEvent) {
      if (e.button === 2) {
        // Defer the reset by a tick so the synthetic tile-onMouseUp
        // (which reads the ref to finalise the annotation) runs first.
        queueMicrotask(() => {
          annotationStartRef.current = null;
        });
      }
    }
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [annotationStartRef]);
}
