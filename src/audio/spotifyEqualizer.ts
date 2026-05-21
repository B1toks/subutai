// Sprint M.3 — pseudo-equalizer driven by Spotify audio-analysis
// segments. The Spotify Web Playback SDK keeps its raw PCM behind DRM,
// so we can't FFT the actual audio. Instead we interpolate the
// pre-baked segments[].pitches (12 chroma values 0..1) and modulate
// them with loudness_max, producing a 40-bar visual that "feels" like
// the song without ever touching its samples.

import type { AudioAnalysis, SpotifySegment } from '../spotify/analysis';

export type BandsListener = (bands: number[]) => void;

// M.4 — bumped from 40 to 60 to match the new perimeter ring (15
// bars per side) and let bass / mid / treble actually split.
const BAND_COUNT = 60;
const SMOOTHING = 0.7;          // 0 = no smoothing, ~0.85 = sluggish
const UPDATE_INTERVAL_MS = 33;  // ~30fps emit rate to keep React happy
const LOUDNESS_FLOOR_DB = -60;

export class SpotifyEqualizer {
  private segments: SpotifySegment[] = [];
  private trackStartedAt = 0;
  private segmentCursor = 0;
  private rafId: number | null = null;
  private bands: number[] = new Array(BAND_COUNT).fill(0);
  private listeners = new Set<BandsListener>();
  private lastEmitAt = 0;

  setAnalysis(analysis: AudioAnalysis, startOffsetSec: number) {
    this.segments = analysis.segments;
    this.segmentCursor = 0;
    this.trackStartedAt = performance.now() - startOffsetSec * 1000;
    if (this.segments.length === 0) return;
    this.startTicking();
  }

  onUpdate(cb: BandsListener): () => void {
    this.listeners.add(cb);
    cb(this.bands);
    return () => {
      this.listeners.delete(cb);
    };
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.segments = [];
    this.bands = new Array(BAND_COUNT).fill(0);
    this.listeners.forEach((cb) => cb(this.bands));
  }

  private startTicking() {
    if (this.rafId !== null) return;
    const tick = () => {
      this.computeFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private computeFrame() {
    const now = performance.now();
    const elapsedSec = (now - this.trackStartedAt) / 1000;

    // Cursor-based segment lookup — segments are time-ordered, so we
    // advance once per frame at most. Falls back to a linear scan only
    // if we land off the cursor (seek, mid-song start, large gap).
    let seg: SpotifySegment | null = null;
    while (
      this.segmentCursor < this.segments.length &&
      this.segments[this.segmentCursor].start +
        this.segments[this.segmentCursor].duration <
        elapsedSec
    ) {
      this.segmentCursor += 1;
    }
    if (this.segmentCursor < this.segments.length) {
      const cand = this.segments[this.segmentCursor];
      if (cand.start <= elapsedSec) seg = cand;
    }
    if (!seg) {
      // Either before the first segment or past the last — decay bars.
      this.bands = this.bands.map((v) => v * SMOOTHING);
      this.maybeEmit(now);
      return;
    }

    // loudness_max is in dB, roughly [-60, 0]. Normalise to 0..1.
    const loudnessNorm = Math.max(
      0,
      Math.min(1, (seg.loudness_max - LOUDNESS_FLOOR_DB) / -LOUDNESS_FLOOR_DB),
    );

    const next = new Array(BAND_COUNT);
    for (let i = 0; i < BAND_COUNT; i++) {
      const pitchIdx = i % 12;
      const pitchValue = seg.pitches[pitchIdx] ?? 0;
      // Pitch drives shape, loudness drives amplitude; small noise gives
      // the bars some life-like jitter (Spotify segments are coarse —
      // ~20-100ms apart — so without jitter the same band would just
      // tick from one value to another).
      const jitter = (Math.random() - 0.5) * 0.05;
      const value = pitchValue * loudnessNorm + jitter;
      next[i] = Math.max(0, Math.min(1, value));
    }

    // Per-band exponential smoothing so abrupt segment transitions
    // don't pop. The same SMOOTHING factor decays the bars when
    // there's no current segment (seek, end of track).
    this.bands = this.bands.map(
      (prev, i) => prev * SMOOTHING + next[i] * (1 - SMOOTHING),
    );

    this.maybeEmit(now);
  }

  private maybeEmit(now: number) {
    if (now - this.lastEmitAt < UPDATE_INTERVAL_MS) return;
    this.lastEmitAt = now;
    this.listeners.forEach((cb) => {
      try {
        cb(this.bands);
      } catch {
        // a misbehaving subscriber must not crash the eq loop
      }
    });
  }
}

export const spotifyEq = new SpotifyEqualizer();
