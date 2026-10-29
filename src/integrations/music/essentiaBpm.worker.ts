/**
 * M.22 — essentia.js beat tracking, worker side.
 *
 * RhythmExtractor2013 ("multifeature") is the industrial-grade DSP beat
 * tracker from the Essentia library (MTG/UPF), compiled to WASM. It runs
 * multiple onset features + tempo induction — far more robust than our
 * interval histogram on shuffle, breakdowns and weak-onset material.
 * Heavy (seconds of compute), so it lives in a worker; the WASM is inlined
 * in the ES build, so this whole chunk lazy-loads on first use only.
 *
 * M.28 — TempoCNN (deeptemp-k16) joins as the tempo second opinion.
 * A request may carry the same window resampled to 11025 Hz plus a TFJS
 * model URL; the worker then also runs Schreiber's TempoCNN: mel patches
 * (40 bands × 256 frames, see tcnnMelFrames for the extraction chain)
 * → softmax over 256 tempo classes (30..285 BPM, class = BPM). The NN
 * reads spectral rhythm patterns, not kick onsets — it holds tempo on the
 * genres where multifeature drifts (ambient, swing, weak onsets). tfjs and
 * the model load lazily on the first such request and stay warm; any
 * failure (old browser, model 404) permanently disables the NN for the
 * session and the reply degrades to rhythm-only — never breaks the pass.
 */

import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import type * as tfType from '@tensorflow/tfjs';

interface AnalyzeRequest {
  pcm: Float32Array;
  /** Must be 44100 — RhythmExtractor2013 assumes it. */
  sampleRate: number;
  /** M.28 — same audio at 11025 Hz; presence (with modelUrl) enables TempoCNN. */
  pcm11k?: Float32Array;
  /** M.28 — absolute URL of the deeptemp TFJS graph model. */
  modelUrl?: string;
}

export interface TempoCnnResult {
  /** Parabolic-interpolated peak of the tempo distribution, BPM. */
  bpm: number;
  /** Peak probability mass (class ± 1 neighbour), 0..1. */
  prob: number;
}

let essentia: InstanceType<typeof Essentia> | null = null;

// ── M.28 — TempoCNN ──
const TCNN_FRAME = 1024;
const TCNN_HOP = 512;
const TCNN_PATCH = 256; // frames per patch (~11.9s @ 11025 Hz)
const TCNN_BANDS = 40;
const TCNN_FIRST_BPM = 30; // class 0 = 30 BPM, class 255 = 285 BPM

let tcnnLoad: Promise<{ tf: typeof tfType; model: tfType.GraphModel }> | null = null;
let tcnnDead = false; // permanent for the session — no retry storms
let tcnnError: string | null = null; // why it died — surfaced in replies

async function loadTcnn(modelUrl: string) {
  const tf = await import('@tensorflow/tfjs');
  // webgl works in workers via OffscreenCanvas on modern browsers; the
  // model is tiny (~300k params) so the cpu backend is a fine fallback.
  if (!(await tf.setBackend('webgl').catch(() => false))) await tf.setBackend('cpu');
  await tf.ready();
  const model = await tf.loadGraphModel(modelUrl);
  return { tf, model };
}

function del(v: unknown): void {
  (v as { delete?: () => void }).delete?.();
}

/** 40-band mel frames the TempoCNN models were trained on.
 *
 * The essentia.js 0.1.3 WASM predates the dedicated
 * TensorflowInputTempoCNN algorithm, so this replicates it 1:1 from the
 * building blocks it wraps (essentia src/algorithms/spectral/
 * tensorflowinputtempocnn.cpp): hann windowing without normalization →
 * magnitude spectrum → 40 slaney-mel bands, 20..5000 Hz, linear
 * weighting, unit_tri normalization, NO log — the models start with a
 * BatchNorm layer that absorbs the input scale.
 *
 * Frames are cut in JS, NOT with essentia's FrameGenerator: that one
 * silently DROPS near-silent frames, and a tempo patch must be a gapless
 * time grid — one dropped quiet bar and every later frame lands on the
 * wrong tick (verified: a sparse kick track lost 2/3 of its frames). */
function tcnnMelFrames(pcm11k: Float32Array): Float32Array[] {
  const es = essentia!;
  const mel: Float32Array[] = [];
  const frame = new Float32Array(TCNN_FRAME); // arrayToVector copies — reusable
  for (let start = 0; start + TCNN_FRAME <= pcm11k.length; start += TCNN_HOP) {
    frame.set(pcm11k.subarray(start, start + TCNN_FRAME));
    const vec = es.arrayToVector(frame);
    const win = es.Windowing(vec, false, TCNN_FRAME, 'hann', 0, true);
    const spec = es.Spectrum(win.frame, TCNN_FRAME);
    const bands = es.MelBands(
      spec.spectrum,
      5000, // highFrequencyBound
      TCNN_FRAME / 2 + 1, // inputSize
      false, // log
      20, // lowFrequencyBound
      'unit_tri',
      TCNN_BANDS,
      11025, // sampleRate
      'magnitude',
      'slaneyMel',
      'linear', // weighting
    );
    mel.push(es.vectorToArray(bands.bands));
    del(vec);
    del(win.frame);
    del(spec.spectrum);
    del(bands.bands);
  }
  return mel;
}

async function runTempoCnn(pcm11k: Float32Array, modelUrl: string): Promise<TempoCnnResult | null> {
  if (tcnnDead) return null;
  try {
    const mel = tcnnMelFrames(pcm11k);
    if (mel.length < TCNN_PATCH) return null;
    if (!tcnnLoad) tcnnLoad = loadTcnn(modelUrl);
    const { tf, model } = await tcnnLoad;
    // Up to 3 overlapping patches across the window; softmax is averaged
    // over them (the aggregation TempoCNN was evaluated with).
    const last = mel.length - TCNN_PATCH;
    const starts = [...new Set([0, Math.floor(last / 2), last])];
    // Model input layout is [batch, melBands, frames, 1] (bands-major).
    const data = new Float32Array(starts.length * TCNN_BANDS * TCNN_PATCH);
    starts.forEach((s, p) => {
      const base = p * TCNN_BANDS * TCNN_PATCH;
      for (let t = 0; t < TCNN_PATCH; t++) {
        const row = mel[s + t];
        for (let m = 0; m < TCNN_BANDS; m++) data[base + m * TCNN_PATCH + t] = row[m];
      }
    });
    const probsTensor = tf.tidy(() => {
      const input = tf.tensor4d(data, [starts.length, TCNN_BANDS, TCNN_PATCH, 1]);
      return (model.execute(input) as tfType.Tensor).mean(0);
    });
    const p = (await probsTensor.data()) as Float32Array;
    probsTensor.dispose();
    let idx = 0;
    for (let i = 1; i < p.length; i++) if (p[i] > p[idx]) idx = i;
    // Sub-BPM: parabolic interpolation around the winning 1-BPM class.
    let bpm = TCNN_FIRST_BPM + idx;
    if (idx > 0 && idx < p.length - 1) {
      const denom = p[idx - 1] - 2 * p[idx] + p[idx + 1];
      if (denom < 0) bpm += 0.5 * ((p[idx - 1] - p[idx + 1]) / denom);
    }
    const prob = p[idx] + (idx > 0 ? p[idx - 1] : 0) + (idx < p.length - 1 ? p[idx + 1] : 0);
    return { bpm, prob: Math.min(1, prob) };
  } catch (err) {
    tcnnDead = true;
    tcnnError = String(err);
    console.warn('[bpm/tempocnn] disabled for this session:', err);
    return null;
  }
}

self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  try {
    if (!essentia) essentia = new Essentia(EssentiaWASM);
    const vec = essentia.arrayToVector(e.data.pcm);
    const res = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
    const ticks = Array.from(essentia.vectorToArray(res.ticks));
    (vec as { delete?: () => void }).delete?.();
    const tcnn =
      e.data.pcm11k && e.data.modelUrl
        ? await runTempoCnn(e.data.pcm11k, e.data.modelUrl)
        : null;
    self.postMessage({ ok: true, bpm: res.bpm, confidence: res.confidence, ticks, tcnn, tcnnError });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
