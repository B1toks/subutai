import { useEffect, useRef, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { audio } from '../../audio/AudioController';
import type { GameStatus } from '../../shared/game';
import type { GameLog } from '../../recording/log';
import type { SquareId } from '../../engine';
import type { AnnotationColor, ArrowAnnotation } from './annotations';

interface UseMoveFeedbackArgs {
  gameStatus: GameStatus;
  log: GameLog;
  setSquareAnnotations: Dispatch<SetStateAction<Map<SquareId, AnnotationColor>>>;
  setArrowAnnotations: Dispatch<SetStateAction<ArrowAnnotation[]>>;
  annotationStartRef: RefObject<SquareId | null>;
}

/**
 * What every new move sets off around the board: the checkmate flash on
 * <body>, the right-click annotations cleared, and the move, capture,
 * promotion or mate sound. Also lets go of a right-drag released off the
 * board.
 */
export function useMoveFeedback({
  gameStatus,
  log,
  setSquareAnnotations,
  setArrowAnnotations,
  annotationStartRef,
}: UseMoveFeedbackArgs) {
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

  // Sprint 3.6 — clear annotations on every new move so the scratch
  // pad doesn't leak into the next ply. Plus a document-level
  // mouseup so a right-drag that's released off the board still
  // resets annotationStartRef instead of leaving it stuck.
  useEffect(() => {
    setSquareAnnotations((prev) => (prev.size === 0 ? prev : new Map()));
    setArrowAnnotations((prev) => (prev.length === 0 ? prev : []));
  }, [log.moves.length, setArrowAnnotations, setSquareAnnotations]);

  // Sprint 3.7 — move-driven SFX dispatch. Fires once per new top
  // log entry; priority: checkmate > promotion > capture > move.
  // Brilliant / blunder reactions live in triggerFlash below — they
  // run on classifier callback, not on the synchronous move dispatch.
  const lastSfxLogLengthRef = useRef(0);
  useEffect(() => {
    const len = log.moves.length;
    if (len === 0) {
      lastSfxLogLengthRef.current = 0;
      return;
    }
    if (len <= lastSfxLogLengthRef.current) {
      lastSfxLogLengthRef.current = len;
      return;
    }
    lastSfxLogLengthRef.current = len;
    if (gameStatus === 'checkmate') {
      audio.play('checkmate');
      return;
    }
    const last = log.moves[len - 1];
    if (!last) return;
    if (last.move.kind === 'promotion') {
      audio.play('promotion');
      return;
    }
    if (last.move.kind === 'capture' || last.move.kind === 'enPassant') {
      audio.play('capture');
      return;
    }
    audio.play('move');
  }, [log.moves.length, gameStatus]);

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
