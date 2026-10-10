/**
 * The Spotify + beat-sync music dock and the Twitch chat panel are finished
 * but not shown yet: their buttons come back in the next big update. The
 * panels are still in the build. `?streaming=1` in the address, or
 * VITE_STREAMING_UI=1 at build time, brings the buttons back for testing.
 */
export const STREAMING_UI: boolean =
  import.meta.env.VITE_STREAMING_UI === '1' ||
  (typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('streaming') === '1');
