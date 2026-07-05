/**
 * M.22 — essentia.js beat tracking, main-thread side.
 *
 * Wraps the worker: resample/mix the decoded file to 44.1k mono, hand the
 * MIDDLE of the track (up to 60s — representative groove, skips long
 * intros) to RhythmExtractor2013, and turn its beat ticks into the same
 * { bpm, offsetMs, confidence } shape fileBpm produces. The circular mean
 * of the ticks gives a phase that's robust to a few bad ticks.
 *
 * Confidence: multifeature reports 0..5.32 (per Essentia docs ≥3.5 is
 * high) — normalised here to 0..1 so callers compare apples to apples.
 */

import type { FileBpmResult } from './fileBpm';

const TARGET_SR = 44100;
const WINDOW_SEC = 60;
const TIMEOUT_MS = 45_000;

async function toMono44k(buffer: AudioBuffer): Promise<{ pcm: Float32Array; startSec: number }> {
  const startSec =
    buffer.duration > WINDOW_SEC ? Math.max(0, buffer.duration / 2 - WINDOW_SEC / 2) : 0;
  const lenSec = Math.min(WINDOW_SEC, buffer.duration - startSec);
  const offline = new OfflineAudioContext(1, Math.ceil(lenSec * TARGET_SR), TARGET_SR);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0, startSec, lenSec);
  const rendered = await offline.startRendering();
  return { pcm: rendered.getChannelData(0), startSec };
}

/** Circular-mean phase of beat ticks (absolute ms) → offset in [0, period). */
function phaseFromTicks(ticksAbsMs: number[], bpm: number): number {
  const period = 60000 / bpm;
  let sx = 0;
  let sy = 0;
  for (const t of ticksAbsMs) {
    const a = (2 * Math.PI * (t % period)) / period;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let phase = Math.atan2(sy, sx);
  if (phase < 0) phase += 2 * Math.PI;
  return (phase / (2 * Math.PI)) * period;
}

export async function analyzeWithEssentia(buffer: AudioBuffer): Promise<FileBpmResult | null> {
  const { pcm, startSec } = await toMono44k(buffer);
  const worker = new Worker(new URL('./essentiaBpm.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const result = await new Promise<{ bpm: number; confidence: number; ticks: number[] } | null>(
      (resolve) => {
        const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          resolve(e.data.ok ? e.data : null);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        // Copy (not transfer): the rendered buffer may be reused by the caller.
        worker.postMessage({ pcm, sampleRate: TARGET_SR });
      },
    );
    if (!result || !(result.bpm > 0)) return null;
    const ticksAbsMs = result.ticks.map((t) => (startSec + t) * 1000);
    const offsetMs = ticksAbsMs.length
      ? phaseFromTicks(ticksAbsMs, result.bpm)
      : 0;
    return {
      bpm: Math.round(result.bpm * 10) / 10,
      offsetMs,
      confidence: Math.min(1, result.confidence / 5.32),
    };
  } finally {
    worker.terminate();
  }
}

// Dev seam (same pattern as __analyzeAudioBuffer).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __analyzeWithEssentia?: typeof analyzeWithEssentia }).__analyzeWithEssentia =
    analyzeWithEssentia;
}
