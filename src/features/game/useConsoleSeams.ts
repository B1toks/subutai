import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { ENCOURAGE_ROTATE, ENCOURAGE_GENERIC } from './coachTexts';
import type { ToastContextValue } from '../../components/Toast';

interface UseConsoleSeamsArgs {
  setCheckVignette: Dispatch<SetStateAction<boolean>>;
  setCaptureStrobe: Dispatch<SetStateAction<'queen' | 'rook' | 'bishop' | 'knight' | null>>;
  setRotationDust: Dispatch<SetStateAction<boolean>>;
  toast: ToastContextValue;
  setEncourageRotate: Dispatch<SetStateAction<boolean>>;
}

/**
 * DevTools seams for QA: window.subutaiEncourage and window.subutaiFX fire
 * the losing-position nudge and the check, strobe and dust effects on
 * demand. Call order matters: the endgame effect later in App adds
 * subutaiFX.mate onto the object this one creates.
 */
export function useConsoleSeams({
  setCheckVignette,
  setCaptureStrobe,
  setRotationDust,
  toast,
  setEncourageRotate,
}: UseConsoleSeamsArgs) {
  // Console seams — preview the big moments on demand without having to
  // play them out for real. Attached in production too (harmless hidden
  // globals) so they work on the live site's DevTools:
  //   subutaiEncourage()                          — a losing-position nudge
  //                                                 (+ pulses the Rotate btn)
  //   subutaiFX.check()                           — the red check vignette
  //   subutaiFX.strobe('queen'|'rook'|'bishop'|'knight') — the capture strobe
  //   subutaiFX.dust()                             — the rotation dust wave
  //   subutaiFX.mate()                             — the checkmate iris
  // The FX ones normally fire only off real game events (a landed check,
  // a non-pawn capture, a committed rotation, an actual mate) — there was
  // no way to QA them without playing a whole line out. This exposes the
  // same setters the real triggers use, so a reviewer can fire each one
  // in isolation. (subutaiFX.mate and the endgame cinematics — subutai
  // Victory / subutaiDefeat / subutaiEndgame — are attached by a separate
  // effect further down, once mateKingPos exists; it merges onto this
  // same object.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const encourage = () => {
      const pool = Math.random() < 0.5 ? ENCOURAGE_ROTATE : ENCOURAGE_GENERIC;
      toast.show(pool[Math.floor(Math.random() * pool.length)], 'info', 5200);
      setEncourageRotate(true);
      window.setTimeout(() => setEncourageRotate(false), 5200);
    };
    const fx = {
      check: () => {
        setCheckVignette(true);
        window.setTimeout(() => setCheckVignette(false), 900);
      },
      strobe: (piece: 'queen' | 'rook' | 'bishop' | 'knight' = 'queen') => {
        setCaptureStrobe(piece);
        window.setTimeout(() => setCaptureStrobe(null), 760);
      },
      dust: () => {
        setRotationDust(true);
        window.setTimeout(() => setRotationDust(false), 780);
      },
    };
    const w = window as unknown as {
      subutaiEncourage?: () => void;
      subutaiFX?: typeof fx;
    };
    w.subutaiEncourage = encourage;
    w.subutaiFX = fx;
  }, [toast, setCaptureStrobe, setCheckVignette, setEncourageRotate, setRotationDust]);
}
