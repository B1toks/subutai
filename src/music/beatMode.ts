/**
 * SP-3 — Beat Mode store.
 *
 * A dedicated, opt-in mode (separate from plain music playback): when
 * ON and a beat grid is running, a human move "snaps" to the beat —
 * its commit is held until the next beat lands, so the piece moves in
 * time with the track. Game STATE is never altered, only the timing of
 * the visual+state commit is delayed; the move that's played is exactly
 * the one chosen.
 *
 * Lives outside React as a singleton: the dock toggles it, App reads
 * `snapDelayMs()` at commit time. Persisted so the choice survives a
 * reload, but defaults OFF (it adds latency by design).
 */

import { beatEngine } from './beatEngine';

const KEY = 'subutai_beat_mode';
/** Don't bother snapping if the next beat is basically now — avoids a
 *  pointless 1-frame timeout and feels instant near the beat. */
const SNAP_FLOOR_MS = 60;

type Listener = (enabled: boolean) => void;

class BeatModeStore {
  private enabled: boolean;
  private listeners = new Set<Listener>();

  constructor() {
    let initial = false;
    try {
      initial = localStorage.getItem(KEY) === '1';
    } catch { /* private mode */ }
    this.enabled = initial;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  set(enabled: boolean) {
    this.enabled = enabled;
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0');
    } catch { /* private mode */ }
    this.listeners.forEach((cb) => {
      try {
        cb(enabled);
      } catch { /* listener errors must not propagate */ }
    });
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Milliseconds to hold a move so it lands on the next beat. 0 when
   *  the mode is off, no grid is running, or the beat is imminent. */
  snapDelayMs(): number {
    if (!this.enabled || !beatEngine.isRunning()) return 0;
    const ms = beatEngine.msToNextBeat();
    return ms >= SNAP_FLOOR_MS ? ms : 0;
  }

  /**
   * M.14 — snap PLAN so the piece *glides into place exactly on the beat*
   * instead of the slide starting on the beat (which arrived a slide-
   * length late and felt laggy).
   *   landMs — when the beat lands (ring fills over this; piece arrives).
   *   holdMs — when to COMMIT the move so a `slideMs` glide ends on the
   *            beat (= landMs - slideMs for a gliding move, else landMs).
   * Picks a beat far enough away to fit the glide; null when off.
   */
  snapPlan(slideMs: number): { holdMs: number; landMs: number } | null {
    if (!this.enabled || !beatEngine.isRunning()) return null;
    const interval = beatEngine.getIntervalMs();
    if (interval <= 0) return null;
    let land = beatEngine.msToNextBeat();
    // Too close to the beat → no satisfying snap, play it now.
    if (land < SNAP_FLOOR_MS && slideMs === 0) return null;
    // Ensure there's room for the glide to land ON a beat (not before).
    const need = slideMs + 50;
    while (land < need) land += interval;
    return { holdMs: Math.max(0, Math.round(land - slideMs)), landMs: Math.round(land) };
  }
}

export const beatMode = new BeatModeStore();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __beatMode?: BeatModeStore }).__beatMode = beatMode;
}
