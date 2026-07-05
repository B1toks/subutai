/**
 * M.23 — live beat tracking with essentia.js over the capture ring buffer.
 *
 * Every ~12s the last ~20s of RAW capture audio (micEq's PCM tap) goes
 * through RhythmExtractor2013 in the shared worker. Unlike the histogram
 * detector this is a full beat tracker: it returns the tempo AND the beat
 * tick times, which we anchor to the wall clock — so each confident result
 * both corrects the tempo and re-phases the grid onto real beats. The
 * histogram detector stays as the instant first-lock (essentia needs ~10s
 * of buffer before its first read) and as the fallback when the worker
 * has nothing confident to say.
 */

import { micEq } from '../audio/micEqualizer';

export interface LiveBeatResult {
  bpm: number;
  /** Normalised 0..1 (multifeature reports 0..5.32). */
  confidence: number;
  /** Wall-clock (performance.now) time of the most recent beat tick. */
  lastBeatWallMs: number;
}

type Listener = (r: LiveBeatResult) => void;

const FIRST_AFTER_MS = 10_000;
const ANALYZE_EVERY_MS = 12_000;
const WINDOW_SEC = 20;
const MIN_BUFFER_SEC = 10;
const TARGET_SR = 44100;
const WORKER_TIMEOUT_MS = 20_000;

class LiveEssentiaTracker {
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private worker: Worker | null = null;
  private busy = false;
  private lastAnalyzeMs = 0;
  private listeners = new Set<Listener>();

  isRunning(): boolean {
    return this.firstTimer !== null || this.timer !== null;
  }

  start(): void {
    if (this.isRunning()) return;
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null;
      void this.analyze();
      this.timer = setInterval(() => void this.analyze(), ANALYZE_EVERY_MS);
    }, FIRST_AFTER_MS);
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
    this.firstTimer = null;
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
  }

  onResult(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** M.24.1 — out-of-cycle analysis: the histogram detector just saw a
   *  big tempo shift (drop / track change) and wants confirmation NOW
   *  instead of waiting out the 12s cadence. Rate-limited so a thrash
   *  can't queue back-to-back multi-second analyses. */
  analyzeNow(): void {
    if (!this.isRunning()) return;
    const now = performance.now();
    if (now - this.lastAnalyzeMs < 5_000) return;
    void this.analyze();
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      // Kept alive across runs — the WASM init cost is paid once.
      this.worker = new Worker(new URL('./essentiaBpm.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  private async analyze(): Promise<void> {
    if (this.busy) return;
    const grab = micEq.getRecentPcm(WINDOW_SEC);
    if (!grab || grab.pcm.length < grab.sampleRate * MIN_BUFFER_SEC) return;
    this.busy = true;
    this.lastAnalyzeMs = performance.now();
    try {
      let pcm = grab.pcm;
      let sr = grab.sampleRate;
      if (sr !== TARGET_SR) {
        const buf = new AudioBuffer({ length: pcm.length, sampleRate: sr, numberOfChannels: 1 });
        // getRecentPcm always returns a fresh ArrayBuffer-backed copy; the
        // generic Float32Array<ArrayBufferLike> type is just wider.
        buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
        const off = new OfflineAudioContext(1, Math.ceil((pcm.length / sr) * TARGET_SR), TARGET_SR);
        const s = off.createBufferSource();
        s.buffer = buf;
        s.connect(off.destination);
        s.start(0);
        pcm = (await off.startRendering()).getChannelData(0);
        sr = TARGET_SR;
      }
      const w = this.ensureWorker();
      const res = await new Promise<{ bpm: number; confidence: number; ticks: number[] } | null>(
        (resolve) => {
          const t = setTimeout(() => resolve(null), WORKER_TIMEOUT_MS);
          w.onmessage = (e) => {
            clearTimeout(t);
            resolve(e.data.ok ? e.data : null);
          };
          w.onerror = () => {
            clearTimeout(t);
            resolve(null);
          };
          w.postMessage({ pcm, sampleRate: sr });
        },
      );
      if (!res || !(res.bpm > 0) || !res.ticks.length) return;
      const windowDurMs = (pcm.length / sr) * 1000;
      const windowStartWall = grab.endWallMs - windowDurMs;
      const result: LiveBeatResult = {
        bpm: Math.round(res.bpm * 10) / 10,
        confidence: Math.min(1, res.confidence / 5.32),
        lastBeatWallMs: windowStartWall + res.ticks[res.ticks.length - 1] * 1000,
      };
      this.listeners.forEach((cb) => {
        try {
          cb(result);
        } catch {
          /* listener errors must not break the tracker */
        }
      });
    } finally {
      this.busy = false;
    }
  }
}

export const liveEssentia = new LiveEssentiaTracker();

// Dev seam (same pattern as __liveBpm).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __liveEssentia?: LiveEssentiaTracker }).__liveEssentia = liveEssentia;
}
