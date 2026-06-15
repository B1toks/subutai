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
const HISTORY_SEC = 8;
const MIN_ONSETS = 12;
const REFRACTORY_MS = 120; // ≤500 BPM — ignore double-triggers
const EMIT_THROTTLE_MS = 1000;
const BPM_LO = 70;
const BPM_HI = 200; // M.12 — was 180; covers hardstyle / fast genres

type BpmListener = (bpm: number, confidence: number) => void;

class LiveBpmDetector {
  private off: (() => void) | null = null;
  private onsets: number[] = [];
  private prevBass = 0;
  private fluxAvg = 0;
  private bpm = 0;
  private confidence = 0;
  private lastEmit = 0;
  private listeners = new Set<BpmListener>();
  /** Injectable clock so the detector is testable without a real mic. */
  private nowMs: () => number = () => performance.now();

  isRunning(): boolean {
    return this.off !== null;
  }

  getBpm(): number {
    return this.bpm;
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
  }

  /** Process one equalizer frame (60 bands, 0..1, ~30fps). */
  private feed(bands: number[]): void {
    let bass = 0;
    const n = Math.min(BASS_BANDS, bands.length);
    for (let i = 0; i < n; i++) bass += bands[i];
    bass /= n || 1;

    const flux = Math.max(0, bass - this.prevBass);
    this.prevBass = bass;
    // Slow-moving baseline; an onset is a flux spike well above it.
    this.fluxAvg = this.fluxAvg * 0.95 + flux * 0.05;

    const now = this.nowMs();
    if (flux > this.fluxAvg * 1.6 && flux > 0.02) {
      const last = this.onsets[this.onsets.length - 1];
      if (last === undefined || now - last > REFRACTORY_MS) {
        this.onsets.push(now);
      }
    }

    const cutoff = now - HISTORY_SEC * 1000;
    while (this.onsets.length && this.onsets[0] < cutoff) this.onsets.shift();

    if (this.onsets.length >= MIN_ONSETS && now - this.lastEmit > EMIT_THROTTLE_MS) {
      this.lastEmit = now;
      const est = this.estimate();
      if (est) {
        this.bpm = est.bpm;
        this.confidence = est.confidence;
        this.listeners.forEach((cb) => {
          try {
            cb(est.bpm, est.confidence);
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

    // M.12 — octave-error fix for fast genres (hardstyle etc.). A 150 BPM
    // kick is often heard as 75 (half-time) by the histogram. If the
    // detected tempo is in the slow band and DOUBLE it has comparable
    // support and lands in range, prefer the faster reading.
    if (best < 100) {
      const dbl = best * 2;
      if (dbl <= BPM_HI) {
        const dblCount =
          (bins.get(dbl - 1) ?? 0) + (bins.get(dbl) ?? 0) + (bins.get(dbl + 1) ?? 0);
        if (dblCount >= bestCount * 0.6) {
          return { bpm: dbl, confidence: (bestCount + dblCount) / total };
        }
      }
    }
    return { bpm: best, confidence: bestCount / total };
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
