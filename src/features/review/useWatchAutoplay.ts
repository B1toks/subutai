import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { WatchingGame } from './watching';

/** How long each move stays on the board while a watched game plays itself. */
const WATCH_AUTOPLAY_MS = 1500;

interface UseWatchAutoplayArgs {
  watchingGame: WatchingGame | null;
  setWatchingGame: Dispatch<SetStateAction<WatchingGame | null>>;
  watchAutoplayRef: RefObject<number | null>;
  seekWatchTo: (idx: number) => void;
}

/**
 * Plays a watched game forward one move at a time while its autoplay is
 * on, and turns autoplay off at the last move.
 */
export function useWatchAutoplay({
  watchingGame,
  setWatchingGame,
  watchAutoplayRef,
  seekWatchTo,
}: UseWatchAutoplayArgs) {
  // Watching-mode autoplay: when enabled, advances one move every
  // WATCH_AUTOPLAY_MS until we hit the end of the replay.
  useEffect(() => {
    if (!watchingGame || !watchingGame.autoplay) return;
    if (watchingGame.currentMoveIdx >= watchingGame.log.moves.length) {
      // Hit the end — flip autoplay off so the play button resets to ▶.
      setWatchingGame((cur) => (cur ? { ...cur, autoplay: false } : cur));
      return;
    }
    watchAutoplayRef.current = setTimeout(() => {
      seekWatchTo(watchingGame.currentMoveIdx + 1);
    }, WATCH_AUTOPLAY_MS);
    return () => {
      if (watchAutoplayRef.current) {
        clearTimeout(watchAutoplayRef.current);
        watchAutoplayRef.current = null;
      }
    };
    // seekWatchTo is stable-ish (defined in the component body but captures
    // setState which is stable); we intentionally drive this effect off the
    // watchingGame snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchingGame?.autoplay, watchingGame?.currentMoveIdx]);
}
