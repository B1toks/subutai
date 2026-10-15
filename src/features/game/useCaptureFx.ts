import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { SquareId } from '../../engine';
import type { ToastContextValue } from '../../components/Toast';
import type { SessionEvent } from '../../session/types';
import { useBoardEventsAfterCommit } from '../../services/useBoardEventsAfterCommit';

interface UseCaptureFxArgs {
  setEnPassantExplosionSquare: Dispatch<SetStateAction<SquareId | null>>;
  registerFx: () => number;
  setCaptureFxSquare: Dispatch<SetStateAction<SquareId | null>>;
  setCaptureShake: Dispatch<SetStateAction<boolean>>;
  setCaptureStrobe: Dispatch<SetStateAction<'queen' | 'rook' | 'bishop' | 'knight' | null>>;
  setRotationDust: Dispatch<SetStateAction<boolean>>;
  toast: ToastContextValue;
  /** Length of the move log on the board (App's alias, online too). */
  logLength: number;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * The board's reactions to captures and rotations: the en-passant blast,
 * the spark and shake of a capture, the strobe when a big piece falls, and
 * the dust wave of a rotation. They follow the board's events
 * (src/services/boardEvents.ts), after the render that shows the move: a
 * capture event names its victim, read off the board before the move, so
 * nothing here keeps a copy of it.
 */
export function useCaptureFx({
  setEnPassantExplosionSquare,
  registerFx,
  setCaptureFxSquare,
  setCaptureShake,
  setCaptureStrobe,
  setRotationDust,
  toast,
  logLength,
}: UseCaptureFxArgs) {
  // Each move ends what the previous one's timers were still going to do,
  // as the effects these replace did when the log grew again.
  const timersRef = useRef<Timer[]>([]);
  // The log length the last move event left behind.
  const eventLengthRef = useRef(logLength);
  const clearTimers = () => {
    const timers = timersRef.current;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  };
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  };

  useBoardEventsAfterCommit((events: readonly SessionEvent[]) => {
    const moveEvent = events.find((e) => e.type === 'move');
    if (!moveEvent || moveEvent.type !== 'move') return;
    clearTimers();
    eventLengthRef.current = moveEvent.index + 1;
    const mv = moveEvent.move;

    // Stage T1: the en-passant explosion overlay. Captured pawn sits at
    // (file of `to`, rank of `from`).
    if (mv.kind === 'enPassant' && mv.from && mv.to) {
      const captureSq = (mv.to[0] + mv.from[1]) as SquareId;
      setEnPassantExplosionSquare(captureSq);
      later(() => setEnPassantExplosionSquare(null), 700);
    }

    // R17a — spark burst + micro-shake on every plain capture (EP keeps its
    // dedicated bigger explosion above). Promotion-captures are skipped.
    if (mv.kind === 'capture' && mv.to) {
      registerFx();
      setCaptureFxSquare(mv.to as SquareId);
      setCaptureShake(true);
      later(() => setCaptureFxSquare(null), 620);
      later(() => setCaptureShake(false), 300);
      // R17c/M.22 — strobe frames on any non-pawn capture. Pawns keep just
      // the plain capture-burst spark (they're the most common loss, and
      // keeping them "lighter" preserves the hierarchy: losing a piece that
      // isn't a pawn is the moment worth a bigger flourish).
      const capture = events.find((e) => e.type === 'capture');
      const victim = capture?.type === 'capture' ? capture.piece : null;
      if (victim === 'queen' || victim === 'rook' || victim === 'bishop' || victim === 'knight') {
        setCaptureStrobe(victim);
        later(() => setCaptureStrobe(null), 760);
      }
    }

    // R17c — dust shockwave when a topology rotation commits.
    if (mv.kind === 'topologyToggle') {
      setRotationDust(true);
      // V1 — a rotation can promote a pawn it swings onto the far row (see
      // promoteStrandedPawns). The piece changes without anyone moving it,
      // so say so — otherwise a queen simply appears where a pawn was.
      const rotation = events.find((e) => e.type === 'rotation');
      const promoted = rotation?.type === 'rotation' ? rotation.promoted : [];
      if (promoted.length > 0) {
        toast.show(
          promoted.length === 1
            ? `The rotation carried the pawn on ${promoted[0]} to the edge — it's a queen now.`
            : `The rotation carried ${promoted.length} pawns to the edge — they're queens now.`,
          'info',
          4200,
        );
      }
      later(() => setRotationDust(false), 780);
    }
  });

  // The effects these replace were cleaned up whenever the log's length
  // changed, whatever changed it: a new game or a step back in a replay
  // cancelled their timers too, and what those timers would have cleared
  // (the spark, the shake, the strobe, the dust) stayed on the board until
  // the next move set it again. A length no move event explains does the
  // same here.
  useEffect(() => {
    if (logLength === eventLengthRef.current) return;
    eventLengthRef.current = logLength;
    const timers = timersRef.current;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  }, [logLength]);

  useEffect(() => {
    const timers = timersRef.current; // one array for the hook's life
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    };
  }, []);
}
