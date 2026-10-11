import { useRef, useEffect } from 'react';
import type { GameLog } from '../../recording/log';

interface UseMoveLogScrollArgs {
  log: GameLog;
}

/** Keeps the newest move of the sidebar's move log in view. */
export function useMoveLogScroll({ log }: UseMoveLogScrollArgs) {
  // Sprint 4.1 — auto-scroll the sidebar move log so the latest ply
  // is always visible without manual scrolling. Anchored to the
  // <pre className="move-log-text"> element which already has the
  // max-height + overflow-y: auto from the sidebar-moves CSS.
  const moveLogScrollRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const el = moveLogScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log.moves.length]);
  return { moveLogScrollRef };
}
