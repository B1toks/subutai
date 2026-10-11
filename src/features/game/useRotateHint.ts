import { useState, useEffect } from 'react';
import type { GameStatus } from '../../shared/game';

interface UseRotateHintArgs {
  gameStatus: GameStatus;
}

/**
 * The one-time hint that points at Rotate: shown in a live game until the
 * player dismisses it, rotates, or ignores it for 10 s, then never again
 * (subutai_rotate_hint_seen).
 */
export function useRotateHint({ gameStatus }: UseRotateHintArgs) {
  // Sprint 4.2 — rotate hint now fires immediately on game start (was
  // move 5 in 4.1; new players need to discover rotate from move 1).
  // Hint auto-dismisses after 10s of inactivity so it doesn't linger
  // forever; localStorage still gates so it never reappears after the
  // first dismissal or first rotation.
  const [rotateHintShown, setRotateHintShown] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('subutai_rotate_hint_seen') === '1';
  });
  const showRotateHint = !rotateHintShown && gameStatus === 'active';
  function dismissRotateHint() {
    setRotateHintShown(true);
    try {
      window.localStorage.setItem('subutai_rotate_hint_seen', '1');
    } catch {
      /* private mode / quota — no-op */
    }
  }
  // Sprint 4.2 — auto-dismiss the rotate hint after 10s if the user
  // hasn't interacted with it. Prevents the pulse + tooltip from
  // becoming permanent visual noise.
  useEffect(() => {
    if (!showRotateHint) return;
    const id = setTimeout(() => dismissRotateHint(), 10_000);
    return () => clearTimeout(id);
  }, [showRotateHint]);
  return { rotateHintShown, showRotateHint, dismissRotateHint };
}
