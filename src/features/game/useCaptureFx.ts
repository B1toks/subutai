import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { SquareId, BoardState } from '../../engine';
import { promoteStrandedPawns } from '../../engine/auxetic';
import { samePieces } from './position';
import type { GameLog } from '../../recording/log';
import type { ToastContextValue } from '../../components/Toast';

interface UseCaptureFxArgs {
  setEnPassantExplosionSquare: Dispatch<SetStateAction<SquareId | null>>;
  registerFx: () => number;
  setCaptureFxSquare: Dispatch<SetStateAction<SquareId | null>>;
  setCaptureShake: Dispatch<SetStateAction<boolean>>;
  setCaptureStrobe: Dispatch<SetStateAction<'queen' | 'rook' | 'bishop' | 'knight' | null>>;
  setRotationDust: Dispatch<SetStateAction<boolean>>;
  state: BoardState;
  log: GameLog;
  toast: ToastContextValue;
}

/**
 * The board's reactions to captures and rotations: the en-passant blast,
 * the spark and shake of a capture, the strobe when a big piece falls, and
 * the dust wave of a rotation. Order inside matters: the capture and
 * rotation effects read prevBoardRef (the board before the last move)
 * before the last effect moves it on to the current board.
 */
export function useCaptureFx({
  setEnPassantExplosionSquare,
  registerFx,
  setCaptureFxSquare,
  setCaptureShake,
  setCaptureStrobe,
  setRotationDust,
  state,
  log,
  toast,
}: UseCaptureFxArgs) {
  // Stage T1: trigger the en-passant explosion overlay whenever a new
  // EP move lands in the log — works for both solo + MP because the log
  // alias covers both. Captured pawn sits at (file of `to`, rank of `from`).
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last) return;
    const mv = last.move;
    if (mv.kind !== 'enPassant' || !mv.from || !mv.to) return;
    const captureSq = (mv.to[0] + mv.from[1]) as SquareId;
    setEnPassantExplosionSquare(captureSq);
    const t = setTimeout(() => setEnPassantExplosionSquare(null), 700);
    return () => clearTimeout(t);
  }, [log.moves.length, setEnPassantExplosionSquare]);

  // R17c — the board as it stood BEFORE the latest log entry. The snapshot
  // effect below is declared AFTER the capture/rotation effects, so within
  // one commit they read the pre-move board (declaration order = run
  // order) and only then the ref advances. pieces[mv.to] on the snapshot
  // is therefore the piece that just got taken.
  const prevBoardRef = useRef<BoardState | null>(null);

  // R17a — spark burst + micro-shake on every plain capture (EP keeps its
  // dedicated bigger explosion above). Promotion-captures are skipped:
  // the log entry can't tell a quiet promotion from a capturing one.
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last) return;
    const mv = last.move;
    if (mv.kind !== 'capture' || !mv.to) return;
    registerFx();
    setCaptureFxSquare(mv.to as SquareId);
    setCaptureShake(true);
    const t1 = setTimeout(() => setCaptureFxSquare(null), 620);
    const t2 = setTimeout(() => setCaptureShake(false), 300);
    // R17c/M.22 — strobe frames on any non-pawn capture. Pawns keep just
    // the plain capture-burst spark (they're the most common loss, and
    // keeping them "lighter" preserves the hierarchy: losing a piece that
    // isn't a pawn is the moment worth a bigger flourish).
    const victim = prevBoardRef.current?.pieces[mv.to as SquareId];
    let t3: ReturnType<typeof setTimeout> | null = null;
    if (
      victim &&
      (victim.type === 'queen' ||
        victim.type === 'rook' ||
        victim.type === 'bishop' ||
        victim.type === 'knight')
    ) {
      setCaptureStrobe(victim.type);
      t3 = setTimeout(() => setCaptureStrobe(null), 760);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (t3) clearTimeout(t3);
    };
    // registerFx is stable; the effect keys off the move count as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.moves.length]);

  // R17c — dust shockwave when a topology rotation commits.
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last || last.move.kind !== 'topologyToggle') return;
    setRotationDust(true);
    // V1 — a rotation can promote a pawn it swings onto the far row (see
    // promoteStrandedPawns). The piece changes without anyone moving it,
    // so say so — otherwise a queen simply appears where a pawn was.
    // Only when `before` is the board this rotation was made from: loading,
    // resuming or replaying a game whose log ends in a rotation lands here
    // with the PREVIOUS game's snapshot, and its pawns are not this game's.
    const before = prevBoardRef.current;
    if (before && before.topologyState !== state.topologyState) {
      const { pieces: rotated, promoted } = promoteStrandedPawns(before.pieces, state.topologyState);
      if (promoted.length > 0 && samePieces(rotated, state.pieces)) {
        toast.show(
          promoted.length === 1
            ? `The rotation carried the pawn on ${promoted[0]} to the edge — it's a queen now.`
            : `The rotation carried ${promoted.length} pawns to the edge — they're queens now.`,
          'info',
          4200,
        );
      }
    }
    const t = setTimeout(() => setRotationDust(false), 780);
    return () => clearTimeout(t);
    // `state` is read for the topology the rotation just produced; the
    // effect keys off the move count exactly as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.moves.length]);

  // R17c — snapshot advance. MUST stay declared after the two effects
  // above (see prevBoardRef comment). Ref write only — no render churn.
  useEffect(() => {
    prevBoardRef.current = state;
  }, [state]);
}
