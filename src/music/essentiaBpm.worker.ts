/**
 * M.22 — essentia.js beat tracking, worker side.
 *
 * RhythmExtractor2013 ("multifeature") is the industrial-grade DSP beat
 * tracker from the Essentia library (MTG/UPF), compiled to WASM. It runs
 * multiple onset features + tempo induction — far more robust than our
 * interval histogram on shuffle, breakdowns and weak-onset material.
 * Heavy (seconds of compute), so it lives in a worker; the WASM is inlined
 * in the ES build, so this whole chunk lazy-loads on first use only.
 */

import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';

interface AnalyzeRequest {
  pcm: Float32Array;
  /** Must be 44100 — RhythmExtractor2013 assumes it. */
  sampleRate: number;
}

let essentia: InstanceType<typeof Essentia> | null = null;

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  try {
    if (!essentia) essentia = new Essentia(EssentiaWASM);
    const vec = essentia.arrayToVector(e.data.pcm);
    const res = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
    const ticks = Array.from(essentia.vectorToArray(res.ticks));
    (vec as { delete?: () => void }).delete?.();
    self.postMessage({ ok: true, bpm: res.bpm, confidence: res.confidence, ticks });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
