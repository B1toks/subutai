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
 *
 * M.28 — TempoCNN as the tempo arbiter. The same window also goes to the
 * deeptemp-k16 net (see the worker) whose verdict settles the TEMPO:
 * when it lands on a harmonic of the DSP tempo (×2, ×1/2, ×3...) the DSP
 * value is octave-corrected but keeps its decimal precision; on a genuine
 * disagreement with a confident net, the net wins outright. Phase still
 * comes from the DSP beat ticks (the net has no notion of phase) and the
 * PLL keeps gluing it between passes.
 */

import { micEq } from '../audio/micEqualizer';
import type { TempoCnnResult } from './essentiaBpm.worker';

export interface LiveBeatResult {
  bpm: number;
  /** Normalised 0..1 (multifeature reports 0..5.32). */
  confidence: number;
  /** Wall-clock (performance.now) time of the most recent beat tick. */
  lastBeatWallMs: number;
}

type Listener = (r: LiveBeatResult) => void;

// M.26 — twice the correction cadence: 6s cycle over a 14s window (was
// 12s/20s). Drops and tempo changes get confirmed in seconds, not a
// half-cycle later. Devices where one pass takes >2.5s fall back to the
// old 12s cadence automatically — accuracy is not worth a hot phone.
const FIRST_AFTER_MS = 10_500;
const ANALYZE_EVERY_MS = 6_000;
const SLOW_DEVICE_EVERY_MS = 12_000;
const SLOW_PASS_MS = 2_500;
const WINDOW_SEC = 14;
const MIN_BUFFER_SEC = 10;
const TARGET_SR = 44100;
const WORKER_TIMEOUT_MS = 20_000;

// M.28 — TempoCNN. Class width is 1 BPM, so "same tempo" tolerance is a
// few classes; harmonics cover the octave/triplet confusions both
// detectors are prone to (each candidate must stay in the sane range).
const TCNN_SR = 11025;
const TCNN_MODEL_URL = new URL(
  `${import.meta.env.BASE_URL}models/deeptemp-k16-3/model.json`,
  typeof location !== 'undefined' ? location.href : 'http://localhost/',
).href;
const TCNN_MIN_PROB = 0.25; // consider the net's opinion at all
const TCNN_OVERRIDE_PROB = 0.5; // let it overrule the DSP outright
const TCNN_HARMONICS = [1 / 3, 1 / 2, 2 / 3, 1, 4 / 3, 3 / 2, 2, 3];
const TCNN_MATCH_BPM = 3;
const BPM_MIN = 40;
const BPM_MAX = 210;

async function resample(
  pcm: Float32Array,
  srIn: number,
  srOut: number,
): Promise<Float32Array> {
  if (srIn === srOut) return pcm;
  const buf = new AudioBuffer({ length: pcm.length, sampleRate: srIn, numberOfChannels: 1 });
  // getRecentPcm always returns a fresh ArrayBuffer-backed copy; the
  // generic Float32Array<ArrayBufferLike> type is just wider.
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const off = new OfflineAudioContext(1, Math.ceil((pcm.length / srIn) * srOut), srOut);
  const s = off.createBufferSource();
  s.buffer = buf;
  s.connect(off.destination);
  s.start(0);
  return (await off.startRendering()).getChannelData(0);
}

/** M.28 — settle the tempo between the DSP tracker and the net.
 *
 * Harmonic agreement (net lands on ×2, ×1/2, ×3... of the DSP tempo):
 * octave-correct the DSP value but keep its decimal precision — the net's
 * classes are 1 BPM wide, the DSP interval estimate is finer. Downward
 * corrections (k<1) re-anchor the grid on what may be an off-beat tick,
 * so they additionally require override-grade confidence. A genuine
 * disagreement with a confident net: the net wins — that's the exact
 * failure mode (ambient, swing, weak onsets) it was brought in for.
 */
function mergeTempo(
  dspBpm: number,
  dspConf: number,
  tcnn: TempoCnnResult | null,
): { bpm: number; confidence: number } {
  if (!tcnn || tcnn.prob < TCNN_MIN_PROB) return { bpm: dspBpm, confidence: dspConf };
  let bestK = 1;
  let bestErr = Math.abs(dspBpm - tcnn.bpm);
  for (const k of TCNN_HARMONICS) {
    const cand = dspBpm * k;
    if (cand < BPM_MIN || cand > BPM_MAX) continue;
    if (k < 1 && tcnn.prob < TCNN_OVERRIDE_PROB) continue;
    const err = Math.abs(cand - tcnn.bpm);
    if (err < bestErr) {
      bestErr = err;
      bestK = k;
    }
  }
  let bpm = dspBpm;
  let confidence = dspConf;
  if (bestErr <= TCNN_MATCH_BPM) {
    bpm = dspBpm * bestK;
    confidence = Math.max(dspConf, tcnn.prob);
  } else if (tcnn.prob >= TCNN_OVERRIDE_PROB && tcnn.bpm >= BPM_MIN && tcnn.bpm <= BPM_MAX) {
    bpm = tcnn.bpm;
    confidence = tcnn.prob;
  }
  if (bpm !== dspBpm) {
    console.info(
      `[bpm/live] tempocnn ${tcnn.bpm.toFixed(1)} (p=${tcnn.prob.toFixed(2)}) ` +
        `corrected rhythm ${dspBpm.toFixed(1)} → ${bpm.toFixed(1)}`,
    );
  }
  return { bpm, confidence };
}

class LiveEssentiaTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private worker: Worker | null = null;
  private busy = false;
  private lastAnalyzeMs = 0;
  /** M.26 — the last pass took long: this device gets the relaxed cadence. */
  private slowDevice = false;
  private listeners = new Set<Listener>();

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(FIRST_AFTER_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
  }

  /** M.26 — self-scheduling chain (not setInterval): the next pass is
   *  planned only after the previous one finished, with the cadence
   *  adapted to how heavy the pass was on this device. */
  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      const t0 = performance.now();
      await this.analyze();
      this.slowDevice = performance.now() - t0 > SLOW_PASS_MS;
      this.schedule(this.slowDevice ? SLOW_DEVICE_EVERY_MS : ANALYZE_EVERY_MS);
    }, delayMs);
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
      // M.28 — TempoCNN eats the same window at its native 11025 Hz.
      const pcm11k = await resample(grab.pcm, grab.sampleRate, TCNN_SR);
      if (sr !== TARGET_SR) {
        pcm = await resample(pcm, sr, TARGET_SR);
        sr = TARGET_SR;
      }
      const w = this.ensureWorker();
      const res = await new Promise<{
        bpm: number;
        confidence: number;
        ticks: number[];
        tcnn: TempoCnnResult | null;
      } | null>((resolve) => {
        const t = setTimeout(() => resolve(null), WORKER_TIMEOUT_MS);
        w.onmessage = (e) => {
          clearTimeout(t);
          resolve(e.data.ok ? e.data : null);
        };
        w.onerror = () => {
          clearTimeout(t);
          resolve(null);
        };
        w.postMessage({ pcm, sampleRate: sr, pcm11k, modelUrl: TCNN_MODEL_URL });
      });
      if (!res || !(res.bpm > 0) || !res.ticks.length) return;
      const { bpm, confidence } = mergeTempo(
        res.bpm,
        Math.min(1, res.confidence / 5.32),
        res.tcnn,
      );
      const windowDurMs = (pcm.length / sr) * 1000;
      const windowStartWall = grab.endWallMs - windowDurMs;
      const result: LiveBeatResult = {
        bpm: Math.round(bpm * 10) / 10,
        confidence,
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
