import { useEffect, useRef, type RefObject } from 'react';
import type { GameLog } from '../../recording/log';

interface UseClassifyGuardsArgs {
  log: GameLog;
  logLengthRef: RefObject<number>;
}

/**
 * What a classification that finishes late checks before it touches the
 * board: how long the log is now, which game is on the board, and which
 * background run is the newest. The classifier in App reads these refs.
 */
export function useClassifyGuards({ log, logLengthRef }: UseClassifyGuardsArgs) {
  // Keep logLengthRef in sync with committed log state — used by classify
  // .then handlers to decide if their analysis is still the latest.
  useEffect(() => {
    logLengthRef.current = log.moves.length;
  }, [log.moves.length, logLengthRef]);
  // F7 — the id of the game on the board, so the background classification
  // of a loaded log can tell it has been replaced and stop.
  const logIdRef = useRef<string>('');
  useEffect(() => {
    logIdRef.current = log.id;
  }, [log.id]);
  // F7 — only the newest background classification run may go on (a Game
  // Review closing starts a catch-up run; the one it replaces stops).
  const classifyRunRef = useRef(0);
  return { logIdRef, classifyRunRef };
}
