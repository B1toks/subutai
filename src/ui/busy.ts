/**
 * V1 — the busy overlay, as a tiny store that lives outside React's view
 * tree.
 *
 * It used to be a piece of App state rendered inside the game view, which
 * had two problems. The overlay only existed on the board screen, so a
 * transition INTO the leaderboard, the review or the lobby had nowhere to
 * show it. And it was set in the same commit as the heavy work it was
 * meant to explain, so the browser painted it after the stall, not
 * during.
 *
 * `navigate()` fixes the second one: it shows the overlay, lets the
 * browser paint it, and only then runs the transition — so the spinner is
 * on screen for the whole of the freeze. <BusyOverlay/> is mounted once,
 * next to <App/>, and fixes the first.
 *
 * Timers only, never requestAnimationFrame: rAF is paused in a hidden tab,
 * and an overlay waiting on a frame that never comes would cover the app
 * forever — the exact "frozen site" this exists to explain away.
 */

type Listener = (label: string | null) => void;

let current: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => {
    try {
      l(current);
    } catch {
      /* a listener must never break the overlay */
    }
  });
}

/** How long the browser gets to paint the overlay before the work runs. */
const PAINT_GAP_MS = 34;

export const busy = {
  /** Show the overlay for at least `holdMs`. */
  begin(label: string, holdMs = 420): void {
    if (clearTimer) clearTimeout(clearTimer);
    current = label;
    emit();
    clearTimer = setTimeout(() => {
      current = null;
      clearTimer = null;
      emit();
    }, holdMs);
  },

  /**
   * Show the overlay, give the browser a frame to paint it, THEN run the
   * transition. Everything the transition changes must happen inside
   * `run` — splitting it (say, switching the view now and clearing some
   * state later) renders an in-between screen for a frame.
   */
  navigate(label: string, run: () => void): void {
    busy.begin(label, 520);
    setTimeout(run, PAINT_GAP_MS);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  get(): string | null {
    return current;
  },
};
