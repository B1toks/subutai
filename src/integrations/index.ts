import { useSyncExternalStore } from 'react';
import { STREAMING_UI } from '../featureFlags';
import { localData, LOCAL_KEYS } from '../infra/localData';

/**
 * The streaming integrations (src/integrations/music, src/integrations/twitch)
 * as the rest of the app reaches them: loaded once, after the first load,
 * and only with STREAMING_UI (?streaming=1). Without the flag nothing of
 * them is downloaded, and every caller here acts as they did with the
 * flag off: no beat grid runs, no vote round opens, nothing is scored.
 */
export type Streaming = typeof import('./streaming');

let loaded: Streaming | null = null;
let loading: Promise<Streaming> | null = null;
const listeners = new Set<() => void>();

/** Starts loading the integrations (main.tsx, at startup); null without the flag. */
export function loadStreaming(): Promise<Streaming> | null {
  if (!STREAMING_UI) {
    // The dev console seams (__twitchChat, __moveVoting, __beatEngine...)
    // are set as their modules load, so a dev build loads them anyway,
    // without connecting them to the game.
    if (import.meta.env.DEV) void import('./streaming');
    return null;
  }
  loading ??= import('./streaming').then((m) => {
    m.connect();
    loaded = m;
    for (const l of listeners) l();
    return m;
  });
  return loading;
}

/** The integrations once loaded; null before, and always without the flag. */
export function streaming(): Streaming | null {
  return loaded;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** streaming() for a render: re-renders once they have loaded. */
export function useStreaming(): Streaming | null {
  return useSyncExternalStore(subscribe, streaming, () => null);
}

/** The music dock's "sound grid" background, as saved (vizMode reads the
 *  same key). It shows without the flag too: it was saved when the dock
 *  was on everyone's screen (before v1.1.4). */
export function savedBgGrid(): boolean {
  try {
    return localData.get(LOCAL_KEYS.bgGrid) === '1';
  } catch {
    return false;
  }
}
