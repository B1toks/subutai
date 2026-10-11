import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { GameStatus } from '../../shared/game';

interface UseAfkNudgeArgs {
  setShowAfkAlert: Dispatch<SetStateAction<boolean>>;
  lastActivityRef: RefObject<number>;
  gameStatus: GameStatus;
  currentPlayer: 'human' | 'ai';
}

/**
 * The idle nudge: any pointer or key activity counts, and after 40 s
 * without any on the player's own turn the board shows a pulsing alert.
 * Separate from the online inactivity forfeit, which runs on the server.
 */
export function useAfkNudge({
  setShowAfkAlert,
  lastActivityRef,
  gameStatus,
  currentPlayer,
}: UseAfkNudgeArgs) {
  // Sprint 2.5 — local AFK nag. Pointer / keyboard activity refreshes
  // the timestamp and clears any existing alert; if we're idle for 20s
  // on our own turn while the game is still active, surface a pulsing
  // attention banner. Distinct from mpSync.selfAfkWarning which is the
  // server-driven 30s forfeit timer.
  useEffect(() => {
    function bump() {
      lastActivityRef.current = Date.now();
      setShowAfkAlert(false);
    }
    document.addEventListener('pointerdown', bump, { passive: true });
    document.addEventListener('pointermove', bump, { passive: true });
    document.addEventListener('keydown', bump, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', bump);
      document.removeEventListener('pointermove', bump);
      document.removeEventListener('keydown', bump);
    };
  }, [lastActivityRef, setShowAfkAlert]);

  useEffect(() => {
    if (currentPlayer !== 'human' || gameStatus !== 'active') {
      setShowAfkAlert(false);
      return;
    }
    // Reset the timestamp whenever it becomes our turn — we don't want to
    // count idle time from before the opponent moved.
    lastActivityRef.current = Date.now();
    setShowAfkAlert(false);
    const t = setInterval(() => {
      // Sprint 2.7: bumped from 20s → 40s after a round of playtesting —
      // the original threshold tripped during normal thinking pauses.
      if (Date.now() - lastActivityRef.current > 40_000) {
        setShowAfkAlert(true);
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [currentPlayer, gameStatus, lastActivityRef, setShowAfkAlert]);
}
