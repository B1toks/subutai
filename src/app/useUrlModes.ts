import { useMemo } from 'react';

/**
 * What the URL asks the app to be, read once on the first render: self-play
 * (?auto=1, capped by ?max=N), the training stats page (?stats=1), or a
 * shared game to open in Review (?game=<id>).
 */
export function useUrlModes() {
  // Self-play / training data collection mode: ?auto=1 in the URL puts both
  // sides under AI control, hides the regular UI, and writes finished games
  // to /training_games. URL-derived so it survives reloads but can be exited
  // by clicking Stop (which navigates back to the no-param URL).
  const isAutoMode = useMemo(
    () => new URLSearchParams(window.location.search).get('auto') === '1',
    [],
  );
  const maxGames = useMemo(() => {
    const m = new URLSearchParams(window.location.search).get('max');
    if (!m) return 0;
    const n = parseInt(m, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, []);
  // Internal monitoring page for the /training_games collection. URL-only so
  // it never shows up in the regular navigation UI.
  const isStatsMode = useMemo(
    () => new URLSearchParams(window.location.search).get('stats') === '1',
    [],
  );
  // T2: ?game=<id> loads a saved /games doc into the Review screen on
  // mount, so a copied share-link opens directly into playback.
  const sharedGameId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('game');
    // Firestore auto-ids are 20 url-safe chars; anything else is junk that
    // would only produce a confusing "could not load" banner (or a thrown
    // invalid-path error for slashes). Ignore it up front.
    return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
  }, []);
  return { isAutoMode, maxGames, isStatsMode, sharedGameId };
}
