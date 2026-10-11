/**
 * fix/v1.1.4 — a page left open across a deploy still holds the old
 * index chunk, whose lazy screens (online lobby, review, leaderboard,
 * stats, Twitch, music dock) point at hashed files the new deploy no
 * longer has. The first one opened 404s, React.lazy rejects and the
 * error boundary showed "Something went wrong". A reload fetches the new
 * index (navigations are network-first in public/sw.js) and with it the
 * new chunk names, so that is what the boundary does instead — once: a
 * second failure soon after the reload means the reload did not help,
 * and the error screen is shown.
 */

/** What a failed dynamic import / preload says in each engine. */
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's preload helper
  /Loading (CSS )?chunk [\w-]+ failed/i, // webpack-style wording
  /is not a valid JavaScript MIME type/i, // an HTML 404 page served as the chunk
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  if (typeof message !== 'string') return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

export const CHUNK_RELOAD_KEY = 'subutai_chunk_reload_at';
/** A failure this soon after the automatic reload is not retried. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether an automatic reload may be tried now. Without session storage
 * there is no way to tell a first failure from a loop, so no.
 */
export function canAutoReload(now: number, storage: StorageLike | null = sessionStore()): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    return !(Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < CHUNK_RELOAD_WINDOW_MS);
  } catch {
    return false;
  }
}

/** Records the attempt; false when it could not be recorded (then do not reload). */
export function markAutoReload(now: number, storage: StorageLike | null = sessionStore()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return storage.getItem(CHUNK_RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
}
