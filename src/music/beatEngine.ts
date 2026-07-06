/**
 * SP-2 — beat engine with two time bases.
 *
 *   wall  — beats live on performance.now(); the M.0 behaviour. Used
 *           when there's no embed controller (external speakers, mic
 *           only, any non-Spotify source).
 *   track — beats live on the TRACK clock. The Spotify IFrame API
 *           streams playback_update {position, isPaused}; we estimate
 *           the live position between updates and fire beats when it
 *           crosses grid points. Pause freezes the estimate → beats
 *           stop by construction; resume/seek keep the grid aligned
 *           because phase is anchored in track-time, not wall-time.
 *
 * Tap-tempo works in both bases: taps record the current source-time;
 * 4+ taps lock BPM from the mean interval and phase from the last tap.
 */

export type BeatScore = 'perfect' | 'good' | 'off';
export type BeatListener = (index: number) => void;

const MAX_TAPS = 8;
const TAPS_FOR_BPM = 4;
const TAP_TIMEOUT_MS = 2500;
const PERFECT_MS = 90;
const GOOD_MS = 170;
const MIN_BPM = 40;
const MAX_BPM = 220;

const OFFSET_KEY = 'subutai_beat_offset';
const MAX_OFFSET_MS = 400;

export class BeatEngine {
  private base: 'wall' | 'track' = 'wall';
  private bpm = 0;
  private intervalMs = 0;
  /** A beat sits at phaseMs + k·intervalMs in source-time. */
  private phaseMs = 0;
  /** M.25 — user sync offset. Output latency (Bluetooth: 100-300ms) is
   *  unmeasurable from JS, so even a perfect detected grid can FEEL
   *  early/late. This constant shifts every beat-derived moment (pulse,
   *  score, snap) by the same amount; positive = beats fire later.
   *  Persisted — it's a property of the user's audio setup, not a track. */
  private userOffsetMs = 0;
  private running = false;
  private taps: number[] = [];
  private listeners = new Set<BeatListener>();
  private rafId: number | null = null;
  /** Coarse fallback alongside rAF: browsers freeze rAF entirely in
   *  hidden/headless tabs, but the music keeps playing — the interval
   *  keeps beats (and the score grid) alive there. Idempotent with the
   *  rAF path via lastFiredIdx. */
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFiredIdx = -1;

  // track base: latest playback snapshot.
  private trackPos = 0;
  private trackPosAt = 0; // performance.now() of the snapshot
  private trackPaused = true;

  constructor() {
    try {
      const raw = localStorage.getItem(OFFSET_KEY);
      if (raw !== null) {
        const v = Number.parseFloat(raw);
        if (Number.isFinite(v)) {
          this.userOffsetMs = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, v));
        }
      }
    } catch {
      /* private mode */
    }
  }

  getBpm(): number {
    return this.bpm;
  }

  getUserOffset(): number {
    return this.userOffsetMs;
  }

  /** M.25 — see userOffsetMs. Clamped ±400ms, persisted, re-anchored so
   *  the change takes effect on the very next beat. */
  setUserOffset(ms: number) {
    this.userOffsetMs = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, ms));
    try {
      localStorage.setItem(OFFSET_KEY, String(this.userOffsetMs));
    } catch {
      /* private mode */
    }
    this.reanchor();
  }

  /** Effective beat anchor: detected phase shifted by the user offset. */
  private anchorMs(): number {
    return this.phaseMs + this.userOffsetMs;
  }

  /** M.27 — signed distance (ms) from a source-time moment to its
   *  NEAREST beat of the RAW detected grid (user offset intentionally
   *  excluded: the PLL aligns the detected grid to detected onsets in
   *  capture-time; the user offset compensates OUTPUT latency on top and
   *  must never be "corrected away"). Positive = the moment is after the
   *  beat, so the grid should move later to meet it. */
  phaseErrorAt(tMs: number): number {
    if (this.intervalMs <= 0) return 0;
    const p = this.intervalMs;
    const off = (((tMs - this.phaseMs) % p) + p) % p;
    return off > p / 2 ? off - p : off;
  }

  /** M.27 — PLL micro-nudge. Small by contract (clamped ±15ms): a nudge
   *  never crosses more than one beat boundary, so lastFiredIdx stays
   *  coherent without re-anchoring (worst case one beat fires ≤15ms
   *  shifted — inaudible; re-anchoring here could double-fire a beat
   *  right at a boundary). */
  nudgePhase(deltaMs: number) {
    if (this.intervalMs <= 0) return;
    this.phaseMs += Math.max(-15, Math.min(15, deltaMs));
  }

  isRunning(): boolean {
    return this.running;
  }

  getBase(): 'wall' | 'track' {
    return this.base;
  }

  /** Switch time base. Resets calibration — a wall-time phase is
   *  meaningless in track-time and vice versa. */
  setBase(base: 'wall' | 'track') {
    if (base === this.base) return;
    this.base = base;
    this.reset();
  }

  /** Feed from the Spotify IFrame API ('playback_update'). */
  feedPlayback(positionMs: number, isPaused: boolean) {
    this.trackPos = positionMs;
    this.trackPosAt = performance.now();
    this.trackPaused = isPaused;
  }

  /** Current source-time in ms. */
  now(): number {
    if (this.base === 'wall') return performance.now();
    if (this.trackPaused) return this.trackPos;
    return this.trackPos + (performance.now() - this.trackPosAt);
  }

  tap() {
    const t = this.now();
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && t - last > TAP_TIMEOUT_MS) this.taps = [];
    this.taps.push(t);
    if (this.taps.length > MAX_TAPS) this.taps.shift();

    // SP-3 — when the BPM is already known (auto-detected or saved),
    // a SINGLE tap re-anchors the phase: "tap once on any beat". Full
    // 4-tap calibration still recomputes both below.
    if (this.intervalMs > 0 && this.taps.length < TAPS_FOR_BPM) {
      this.phaseMs = t % this.intervalMs;
      this.reanchor(); // M.24 — phase shift moves the beat index too
    }

    if (this.taps.length >= TAPS_FOR_BPM) {
      const intervals: number[] = [];
      for (let i = 1; i < this.taps.length; i++) {
        intervals.push(this.taps[i] - this.taps[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
        this.bpm = bpm;
        this.intervalMs = avg;
        this.phaseMs = this.taps[this.taps.length - 1] % avg;
        this.reanchor(); // M.24
      }
    }
  }

  /** Adopt a previously saved calibration (per-track BPM memory). The
   *  phase still needs a tap or two, but the grid spacing is right. */
  adoptBpm(bpm: number) {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return;
    this.bpm = bpm;
    this.intervalMs = 60000 / bpm;
    this.phaseMs = this.now() % this.intervalMs;
    this.reanchor();
  }

  /** SP-9 — set BOTH tempo and phase explicitly. Used by offline file
   *  analysis, which knows exactly where beat 1 sits (phaseMs is in the
   *  same time base as now() — track-time for a file). No tap needed:
   *  the grid is sample-accurate from the first beat. */
  setGrid(bpm: number, phaseMs: number) {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return;
    this.bpm = bpm;
    this.intervalMs = 60000 / bpm;
    const iv = this.intervalMs;
    this.phaseMs = ((phaseMs % iv) + iv) % iv;
    this.reanchor();
  }

  /** M.24 — re-base the fired-beat index after ANY grid change. The
   *  index is absolute (now/interval); when the tempo drops, the index
   *  computed under the LARGER interval is far smaller than the one
   *  accumulated under the old grid, and checkBeats() (which only fires
   *  on idx > lastFiredIdx) would go silent for minutes until wall time
   *  "caught up" — the reported "BPM падає і дошка перестає стукати".
   *  Re-anchoring makes the very next grid point fire normally. */
  private reanchor() {
    if (this.intervalMs <= 0) return;
    this.lastFiredIdx = Math.floor((this.now() - this.anchorMs()) / this.intervalMs);
  }

  start(): boolean {
    if (this.intervalMs <= 0) return false;
    this.lastFiredIdx = Math.floor((this.now() - this.anchorMs()) / this.intervalMs);
    this.running = true;
    this.tick();
    this.intervalId = setInterval(() => this.checkBeats(), 250);
    return true;
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset() {
    this.stop();
    this.taps = [];
    this.bpm = 0;
    this.intervalMs = 0;
    this.phaseMs = 0;
    this.lastFiredIdx = -1;
  }

  onBeat(cb: BeatListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Milliseconds until the next beat (0 when no grid / not running).
   *  Used by the move-snap delay in Beat Mode. Note: when sitting
   *  exactly on a beat this returns ~intervalMs (a full wait to the
   *  NEXT beat), not 0 — the caller's SNAP_FLOOR handles the
   *  just-before-beat case where the wait is tiny. */
  msToNextBeat(): number {
    if (!this.running || this.intervalMs <= 0) return 0;
    const t = this.now();
    const offset =
      (((t - this.anchorMs()) % this.intervalMs) + this.intervalMs) % this.intervalMs;
    return Math.round(this.intervalMs - offset);
  }

  /** Beat period in ms (0 when no grid). */
  getIntervalMs(): number {
    return this.intervalMs;
  }

  /** Distance from "now" to the nearest beat, scored. */
  scoreNow(): BeatScore {
    if (!this.running || this.intervalMs <= 0) return 'off';
    const t = this.now();
    const offset =
      (((t - this.anchorMs()) % this.intervalMs) + this.intervalMs) % this.intervalMs;
    const dist = Math.min(offset, this.intervalMs - offset);
    if (dist < PERFECT_MS) return 'perfect';
    if (dist < GOOD_MS) return 'good';
    return 'off';
  }

  private checkBeats() {
    if (!this.running) return;
    const idx = Math.floor((this.now() - this.anchorMs()) / this.intervalMs);
    if (idx > this.lastFiredIdx) {
      // Catch up at most a couple of beats after a background-tab stall;
      // a long gap shouldn't machine-gun the visuals.
      const from = Math.max(this.lastFiredIdx + 1, idx - 1);
      for (let i = from; i <= idx; i++) {
        this.listeners.forEach((cb) => {
          try {
            cb(i);
          } catch {
            // listener errors must not break the clock
          }
        });
      }
      this.lastFiredIdx = idx;
    }
  }

  private tick = () => {
    if (!this.running) return;
    this.checkBeats();
    this.rafId = requestAnimationFrame(this.tick);
  };
}

export const beatEngine = new BeatEngine();

// Dev-only hook: lets preview tooling drive the SAME instance the app
// graph uses (dynamic import() in long HMR sessions can resolve to a
// second copy of the module).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __beatEngine?: BeatEngine }).__beatEngine = beatEngine;
}
