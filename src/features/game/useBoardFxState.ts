import { useState, useRef, useCallback } from 'react';
import type { SquareId } from '../../engine';

/** How long two heavy board effects count as "back to back". */
const FX_WINDOW_MS = 2600;

/**
 * What the board's effects show right now: the capture spark and shake,
 * the big-capture strobe, the rotation dust, the check vignette, the
 * victory freeze and the en-passant blast, plus registerFx, which sets how
 * loud the next heavy effect plays. The effects that fire them live in App.
 */
export function useBoardFxState() {
  // Stage T1: square that just had a pawn taken via en passant — paints a
  // brief explosion overlay so the off-target capture is visually obvious.
  // R17a — cinema micro-FX: spark burst on the capture square + a brief
  // board jitter. Driven off the shared log (same pattern as the EP
  // explosion below) so human, AI, chat and PvP captures all fire it.
  const [captureFxSquare, setCaptureFxSquare] = useState<SquareId | null>(null);
  const [captureShake, setCaptureShake] = useState(false);
  // R17c — storyboard "big capture" strobe: two flash frames when a QUEEN
  // or ROOK is taken (plain captures only). Color codes the loss —
  // queen reads red, rook reads electric blue. Kept under 3 flashes/sec
  // for photosensitivity; reduced-motion hides it entirely.
  const [captureStrobe, setCaptureStrobe] = useState<
    'queen' | 'rook' | 'bishop' | 'knight' | null
  >(null);
  // R17c — rotation dust wave: an expanding shockwave ring when a topology
  // rotation commits (human, AI, chat or PvP — all come through the log).
  const [rotationDust, setRotationDust] = useState(false);
  // R17b — red vignette pulse when a REAL check lands (preview-induced
  // "checks" from the rotation eye are ignored).
  const [checkVignette, setCheckVignette] = useState(false);
  /**
   * V1 — the loudness governor.
   *
   * Every heavy move still gets its full vocabulary — the shake, the
   * strobe on a big capture, the red vignette on a check — because that
   * is how the board says "that one hurt". What changes is the volume
   * when they arrive back to back: an exchange, a check, a recapture used
   * to stack three full-strength effects into a board nobody could read.
   *
   * So each effect registers here first and gets a level: the first in a
   * window plays at 100%, the next at 60%, and anything after that at
   * 40%. Quieter, never silent — the player still feels each one. The
   * window resets once the board has been calm for FX_WINDOW_MS.
   */
  const fxRecentRef = useRef<number[]>([]);
  const [fxIntensity, setFxIntensity] = useState(1);
  const registerFx = useCallback((): number => {
    const now = Date.now();
    const recent = fxRecentRef.current.filter((t) => now - t < FX_WINDOW_MS);
    recent.push(now);
    fxRecentRef.current = recent;
    const level = recent.length <= 1 ? 1 : recent.length === 2 ? 0.6 : 0.4;
    setFxIntensity(level);
    return level;
  }, []);
  // R17b — the storyboard's "зрив темпу": a dim freeze-frame beat before
  // the victory cinematic slams in.
  const [victoryFreeze, setVictoryFreeze] = useState(false);
  const victoryFreezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enPassantExplosionSquare, setEnPassantExplosionSquare] =
    useState<SquareId | null>(null);
  return {
    captureFxSquare,
    setCaptureFxSquare,
    captureShake,
    setCaptureShake,
    captureStrobe,
    setCaptureStrobe,
    rotationDust,
    setRotationDust,
    checkVignette,
    setCheckVignette,
    fxIntensity,
    registerFx,
    victoryFreeze,
    setVictoryFreeze,
    victoryFreezeTimer,
    enPassantExplosionSquare,
    setEnPassantExplosionSquare,
  };
}
