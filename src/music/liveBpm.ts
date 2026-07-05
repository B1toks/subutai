/**
 * SP-7 — live tempo detection from the microphone.
 *
 * The universal answer to "where do we get BPM": don't look it up at
 * all — listen. The mic equalizer already runs an FFT; this taps its
 * bass-band stream, detects kick/onset events (positive energy flux
 * past an adaptive threshold), and estimates BPM from the histogram of
 * inter-onset intervals, octave-folded into a musical range. Works for
 * ANY source playing through the speakers — Spotify (full or preview),
 * YouTube, a phone, vinyl — with no API and no per-track analysis.
 *
 * It's approximate by nature (best on steady 4-on-the-floor beats; a
 * rubato ballad won't lock). Treat the result as a strong suggestion
 * the user can accept or override.
 */

import { micEq } from '../audio/micEqualizer';

const BASS_BANDS = 8;
// M.16 — shorter history + fewer min onsets so the estimate REACTS to a
// tempo / track change in a few seconds instead of ~8s of stale onsets
// dragging the average. Emit a bit more often too.
const HISTORY_SEC = 5;
const MIN_ONSETS = 8;
const REFRACTORY_MS = 120; // ≤500 BPM — ignore double-triggers
const EMIT_THROTTLE_MS = 700;
const BPM_LO = 70;
const BPM_HI = 200; // M.12 — was 180; covers hardstyle / fast genres
// M.18 — output stabilisers. The M.17 interval-sum refinement is accurate
// but CONTINUOUS, so every emit differed by fractions of a BPM and the
// readout (and any >N re-lock downstream) wobbled. The deadband keeps the
// published value sticky until the estimate really moves; the octave
// hysteresis keeps borderline tracks from flip-flopping half/double time.
const EMIT_DEADBAND = 0.8;
const OCTAVE_STICKINESS = 1.5; // pref multiplier for staying near the lock
// M.19 — silence is measured on the FULL spectrum, not the bass. A
// filtered build-up / breakdown can have zero low end for 10+ seconds
// while pads and hats keep playing — that's music, not silence, and
// pausing the board pulse there killed the vibe right before the drop.
// Only when the WHOLE spectrum sits near the floor for a while (music
// actually stopped / paused) does the pulse rest.
const SILENCE_MS = 5000;
const QUIET_ABS_FLOOR = 0.006;
const QUIET_REL = 0.06; // of the recent full-spectrum peak
// M.19 — flywheel. During low-energy passages the onset evidence is
// garbage: sparse half-density hits read as half-time and used to flush
// the lock ("бпм занадто сильно дропається" mid-track). Once locked, the
// tempo COASTS while the bass energy sits below this fraction of its
// recent peak — no new estimates are accepted, the grid keeps rolling.
// When the energy returns (the drop), the onset window is trimmed so the
// first fresh estimates come from the drop, not the breakdown tail.
const COAST_BASS_RATIO = 0.3;

type BpmListener = (bpm: number, confidence: number) => void;

class LiveBpmDetector {
  private off: (() => void) | null = null;
  private onsets: number[] = [];
  private prevBass = 0;
  private fluxAvg = 0;
  private bpm = 0;
  private confidence = 0;
  private lastEmit = 0;
  /** M.16.1 — last few raw estimates, for the stability median. */
  private bpmHistory: number[] = [];
  /** M.17 — consecutive out-of-band estimates seen so far. */
  private outlierStreak = 0;
  /** M.18 — last time the bass level was above the quiet floor. */
  private lastLoudMs = 0;
  /** M.19 — ~1s smoothed bass level (instant frames whipsaw between kicks). */
  private bassAvgSlow = 0;
  /** M.19 — slow-decaying peak OF THE SMOOTHED level: the flywheel's
   *  reference. (Comparing the average against the instantaneous kick
   *  peak was wrong scale — a 4-on-the-floor groove averages ~13% of its
   *  kick peak, which read as "low energy" and froze the flywheel on.) */
  private bassAvgPeak = 0.03;
  /** M.19 — slow-decaying FULL-spectrum peak, the silence reference. */
  private overallPeak = 0.04;
  /** M.19 — whether the flywheel was coasting on the previous frame. */
  private coasting = false;
  private listeners = new Set<BpmListener>();
  /** Injectable clock so the detector is testable without a real mic. */
  private nowMs: () => number = () => performance.now();

  isRunning(): boolean {
    return this.off !== null;
  }

  getBpm(): number {
    return this.bpm;
  }

  /** M.15.1 — performance.now() of the most recent detected kick/onset.
   *  Used to PHASE-align the beat grid to real kicks so Beat Mode lands on
   *  the beat with no manual tap (adoptBpm alone picks an arbitrary phase).
   *  0 when nothing detected yet. */
  getLastOnset(): number {
    return this.onsets.length ? this.onsets[this.onsets.length - 1] : 0;
  }

  /** M.18 — true while the capture is running but hears (near-)silence.
   *  App uses this to pause the on-beat board pulse: the grid keeps
   *  time, the visual heartbeat waits for the music to come back. */
  isSilent(): boolean {
    return this.nowMs() - this.lastLoudMs > SILENCE_MS;
  }

  /** M.24.1 — align the detector's published belief with an external
   *  authoritative lock (the essentia tracker). Without this, the sticky
   *  deadband value from BEFORE the correction survives it, reads as a
   *  fake ">8 BPM shift" on the next emit, and reverts essentia's fix.
   *  Clearing the history re-anchors the deadband AND the octave
   *  hysteresis to the corrected tempo. */
  syncTo(bpm: number): void {
    this.bpm = bpm;
    this.bpmHistory = [];
    this.outlierStreak = 0;
  }

  /** M.18.1 — true when the last few published estimates agree within a
   *  few BPM. MusicDock gates grid re-locks on this: while the detector
   *  is thrashing (weak signal, track transition) the grid HOLDS its
   *  current tempo instead of chasing every wild estimate — that chase
   *  was resetting the beat phase every emit, so the board never got a
   *  full beat in and stopped pulsing. */
  isStable(): boolean {
    if (this.bpmHistory.length < 3) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of this.bpmHistory) {
      if (b < lo) lo = b;
      if (b > hi) hi = b;
    }
    // M.20 — was 3: raw refined estimates spread 3-4 BPM on real signal,
    // so re-locks never passed. 5 still rejects a thrash (spread 10+)
    // while letting normal working wobble through.
    return hi - lo < 5;
  }

  start(): void {
    if (this.off) return;
    this.reset();
    this.off = micEq.onUpdate((bands) => this.feed(bands));
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.reset();
  }

  onBpm(cb: BpmListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private reset(): void {
    this.onsets = [];
    this.prevBass = 0;
    this.fluxAvg = 0;
    this.bpm = 0;
    this.confidence = 0;
    this.lastEmit = 0;
    this.bpmHistory = [];
    this.outlierStreak = 0;
    this.lastLoudMs = 0;
    this.bassAvgSlow = 0;
    this.bassAvgPeak = 0.03;
    this.overallPeak = 0.04;
    this.coasting = false;
  }

  /** Process one equalizer frame (60 bands, 0..1, ~30fps). */
  private feed(bands: number[]): void {
    let bass = 0;
    const n = Math.min(BASS_BANDS, bands.length);
    for (let i = 0; i < n; i++) bass += bands[i];
    bass /= n || 1;
    // M.19 — full-spectrum level for silence detection (pads/hats keep a
    // bass-less build-up "loud"; only a truly stopped track goes quiet).
    let overall = 0;
    for (let i = 0; i < bands.length; i++) overall += bands[i];
    overall /= bands.length || 1;

    const flux = Math.max(0, bass - this.prevBass);
    this.prevBass = bass;
    // Slow-moving baseline; an onset is a flux spike well above it.
    this.fluxAvg = this.fluxAvg * 0.95 + flux * 0.05;

    const now = this.nowMs();
    this.overallPeak = Math.max(overall, this.overallPeak * 0.999, 0.015);
    if (overall > Math.max(QUIET_ABS_FLOOR, this.overallPeak * QUIET_REL)) {
      this.lastLoudMs = now;
    }
    // M.19 — flywheel energy tracking + coast transitions.
    this.bassAvgSlow = this.bassAvgSlow * 0.97 + bass * 0.03;
    this.bassAvgPeak = Math.max(this.bassAvgSlow, this.bassAvgPeak * 0.999, 0.02);
    const coastingNow =
      this.bpm > 0 && this.bassAvgSlow < this.bassAvgPeak * COAST_BASS_RATIO;
    if (this.coasting && !coastingNow) {
      // The drop is back — judge the tempo by what's playing NOW, not by
      // the breakdown's sparse tail. History (the held tempo) survives so
      // the octave hysteresis anchors the re-estimate.
      this.onsets = this.onsets.filter((o) => now - o < 1200);
      this.outlierStreak = 0;
    }
    this.coasting = coastingNow;
    if (flux > this.fluxAvg * 1.6 && flux > 0.02) {
      const last = this.onsets[this.onsets.length - 1];
      if (last === undefined || now - last > REFRACTORY_MS) {
        this.onsets.push(now);
        this.lastLoudMs = now; // M.18.1 — hearing kicks ⇒ not silent
      }
    }

    const cutoff = now - HISTORY_SEC * 1000;
    while (this.onsets.length && this.onsets[0] < cutoff) this.onsets.shift();

    // M.19 — while coasting, the held tempo IS the answer: skip estimation
    // entirely so breakdown noise can't dive the readout or flush the lock.
    if (this.coasting) return;

    if (this.onsets.length >= MIN_ONSETS && now - this.lastEmit > EMIT_THROTTLE_MS) {
      this.lastEmit = now;
      const est = this.estimate();
      if (est) {
        // M.16.1 — stability filter. A single raw estimate jitters frame to
        // frame (reads as "weak" / wobbly). Emit the MEDIAN of the last few
        // estimates for a steadier, more accurate lock — but if the newest
        // estimate jumps hard (a real track / tempo change), reset the
        // window so we still react fast (the >3 BPM re-lock catches it).
        const prevMedian = this.bpmHistory.length
          ? [...this.bpmHistory].sort((a, b) => a - b)[this.bpmHistory.length >> 1]
          : est.bpm;
        if (Math.abs(est.bpm - prevMedian) > prevMedian * 0.12) {
          // M.17 — two-strike reset. A single outlier estimate is far more
          // often a glitch (a fill, dropped frames, crowd noise) than a real
          // tempo change, and flushing the history on it made the lock
          // wobble. A REAL change keeps producing outliers, so flush on the
          // second consecutive one — one emit (~0.7s) later, which the
          // >3 BPM re-lock in MusicDock absorbs without drama.
          this.outlierStreak++;
          if (this.outlierStreak >= 2) {
            this.bpmHistory = [est.bpm];
            this.outlierStreak = 0;
          }
        } else {
          this.outlierStreak = 0;
          this.bpmHistory.push(est.bpm);
          if (this.bpmHistory.length > 4) this.bpmHistory.shift();
        }
        const sorted = [...this.bpmHistory].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        // M.18 — deadband: the refined estimate is continuous, so the raw
        // median wobbles by fractions of a BPM every emit. Publish a STICKY
        // value — hold the previous one until the median really moves.
        const stable =
          this.bpm > 0 && Math.abs(median - this.bpm) < EMIT_DEADBAND ? this.bpm : median;
        // Steadier readings ⇒ nudge confidence up so a clean beat stops
        // reading as "weak" once it has held for a couple of windows.
        const conf =
          this.bpmHistory.length >= 3 ? Math.min(1, est.confidence + 0.15) : est.confidence;
        this.bpm = stable;
        this.confidence = conf;
        this.listeners.forEach((cb) => {
          try {
            cb(stable, conf);
          } catch {
            /* listener errors must not break the detector */
          }
        });
      }
    }
  }

  /** Mode of the octave-folded inter-onset-interval BPM histogram. */
  private estimate(): { bpm: number; confidence: number } | null {
    const bins = new Map<number, number>();
    let total = 0;
    for (let i = 1; i < this.onsets.length; i++) {
      const iv = this.onsets[i] - this.onsets[i - 1];
      if (iv <= 0) continue;
      let bpm = 60000 / iv;
      while (bpm < BPM_LO) bpm *= 2;
      while (bpm > BPM_HI) bpm /= 2;
      const q = Math.round(bpm);
      bins.set(q, (bins.get(q) ?? 0) + 1);
      total++;
    }
    if (total === 0) return null;

    // Group neighbouring bins (±1 BPM) so 127/128/129 reinforce.
    let best = -1;
    let bestCount = 0;
    for (const [q] of bins) {
      const count = (bins.get(q - 1) ?? 0) + (bins.get(q) ?? 0) + (bins.get(q + 1) ?? 0);
      if (count > bestCount) {
        bestCount = count;
        best = q;
      }
    }
    if (best < 0 || bestCount < 3) return null;

    // M.14 — octave-robust pick. A 150 BPM hardstyle kick is often heard
    // as 75 (half-time) by a plain histogram. Consider the whole family,
    // keep those in range, and take the strongest-supported with a mild
    // preference for the 120-175 "dancefloor" band where hardstyle / DnB
    // / EDM kicks live — so the faster, correct reading wins.
    // M.21 — the family now includes METRICAL errors (2/3, 3/4, 4/3, 3/2)
    // and every candidate must survive a vector-strength check against
    // the actual onset times (see fileBpm.ts) — a fractional-tempo grid
    // scatters the onsets and is rejected before scoring.
    const support = (b: number) =>
      (bins.get(b - 1) ?? 0) + (bins.get(b) ?? 0) + (bins.get(b + 1) ?? 0);
    const rawCands = [
      best / 2,
      (best * 2) / 3,
      (best * 3) / 4,
      best,
      (best * 4) / 3,
      (best * 3) / 2,
      best * 2,
    ];
    const allCands = [...new Set(rawCands.map((b) => Math.round(b)))].filter(
      (b) => b >= BPM_LO && b <= BPM_HI,
    );
    let maxVs = 0;
    const vsByCand = new Map<number, number>();
    for (const c of allCands) {
      const interval = 60000 / c;
      let sx = 0;
      let sy = 0;
      for (const t of this.onsets) {
        const a = (2 * Math.PI * (t % interval)) / interval;
        sx += Math.cos(a);
        sy += Math.sin(a);
      }
      const v = Math.sqrt(sx * sx + sy * sy) / (this.onsets.length || 1);
      vsByCand.set(c, v);
      if (v > maxVs) maxVs = v;
    }
    const survivors = allCands.filter((c) => (vsByCand.get(c) ?? 0) >= maxVs * 0.7);
    const cands = survivors.length ? survivors : allCands;
    let pick = best;
    let pickScore = -1;
    for (const c of cands) {
      let pref = c >= 120 && c <= 175 ? 1.3 : 1;
      // M.18 — octave hysteresis: a borderline track whose half/double
      // support see-saws frame to frame used to flip-flop 87↔175. Once
      // locked, staying in the same octave needs no extra evidence —
      // LEAVING it does.
      if (this.bpm > 0 && Math.abs(c - this.bpm) < this.bpm * 0.06) pref *= OCTAVE_STICKINESS;
      const sc = support(c) * pref;
      if (sc > pickScore) {
        pickScore = sc;
        pick = c;
      }
    }
    // M.17 — confidence counts the whole octave FAMILY, not just the
    // picked bin. Folding leaves half/double-time intervals in their own
    // bins (a steady 150 BPM kick reads as 75 + 150), so counting only
    // the winner made a perfectly correct lock look "weak" and kept it
    // from passing MusicDock's 0.3 auto-adopt gate. Octave-consistent
    // votes are evidence FOR the lock — count them.
    let familySupport = 0;
    for (const b of new Set([Math.round(pick / 2), pick, pick * 2])) {
      if (b >= BPM_LO && b <= BPM_HI) familySupport += support(b);
    }

    // M.17 — refine the integer bin label with a beat-count fit. Onsets
    // are quantised to ~33ms equalizer frames, so a single 400ms (150 BPM)
    // interval measures as 396 or 429ms and the histogram systematically
    // lands 1-2 BPM off. Summing every interval that fits the picked tempo
    // (k whole beats each — tolerates missed kicks) cancels the per-frame
    // error: total-time / total-beats is only wrong at the two endpoints.
    const period = 60000 / pick;
    let spanMs = 0;
    let beats = 0;
    for (let i = 1; i < this.onsets.length; i++) {
      const iv = this.onsets[i] - this.onsets[i - 1];
      const k = Math.round(iv / period);
      if (k >= 1 && Math.abs(iv - k * period) < period * 0.15) {
        spanMs += iv;
        beats += k;
      }
    }
    const refined =
      beats >= 4 && spanMs > 0 ? Math.round(((60000 * beats) / spanMs) * 10) / 10 : pick;
    return { bpm: refined, confidence: Math.min(1, familySupport / total) };
  }

  /** Test seam: drive the detector with synthetic frames on a fake clock. */
  __testFeed(bands: number[], atMs: number): void {
    this.nowMs = () => atMs;
    this.feed(bands);
  }

  __testResult(): { bpm: number; confidence: number; onsets: number } {
    return { bpm: this.bpm, confidence: this.confidence, onsets: this.onsets.length };
  }
}

export const liveBpm = new LiveBpmDetector();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __liveBpm?: LiveBpmDetector }).__liveBpm = liveBpm;
}
