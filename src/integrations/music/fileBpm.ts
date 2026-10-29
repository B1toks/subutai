/**
 * SP-9 — offline beat detection for local audio files.
 *
 * When the audio is OURS (a file the user picked), we have the raw
 * decoded signal — so we can do proper offline analysis instead of a
 * 30fps live estimate: low-pass to isolate the kick, build an energy
 * envelope, pick onsets, and read the tempo off the inter-onset
 * interval histogram (octave-folded). We also recover the PHASE — where
 * beat 1 sits — so the grid is sample-accurate from the first beat with
 * no tapping.
 *
 * This is the version of the idea that "just works": no DRM, no API, no
 * OAuth, and we own the playback clock so sync is exact.
 */

export interface FileBpmResult {
  bpm: number;
  /** Milliseconds from the file start to the nearest beat (the phase). */
  offsetMs: number;
  confidence: number;
}

const BPM_LO = 70;
const BPM_HI = 200; // M.12 — covers hardstyle / fast genres
const HOP_SEC = 0.01; // 10 ms envelope resolution
const LOWPASS_HZ = 150;

/** Render the buffer through a low-pass filter (isolate kick/bass) and
 *  return mono samples. */
async function lowpassMono(buffer: AudioBuffer): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = LOWPASS_HZ;
  lp.Q.value = 1;
  src.connect(lp).connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Energy envelope at HOP_SEC resolution (RMS per hop window). */
function energyEnvelope(samples: Float32Array, sampleRate: number): { env: Float32Array; hopMs: number } {
  const hop = Math.max(1, Math.floor(sampleRate * HOP_SEC));
  const frames = Math.floor(samples.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    env[f] = Math.sqrt(sum / hop);
  }
  return { env, hopMs: (hop / sampleRate) * 1000 };
}

/** Onset times (ms) via positive energy flux past an adaptive threshold. */
function detectOnsets(env: Float32Array, hopMs: number): number[] {
  const onsets: number[] = [];
  let avg = 0;
  let prev = 0;
  let lastOnsetMs = -Infinity;
  const refractoryMs = 120; // ≤500 BPM
  for (let f = 0; f < env.length; f++) {
    const flux = Math.max(0, env[f] - prev);
    prev = env[f];
    avg = avg * 0.95 + flux * 0.05;
    const t = f * hopMs;
    if (flux > avg * 1.5 && flux > 0.005 && t - lastOnsetMs > refractoryMs) {
      onsets.push(t);
      lastOnsetMs = t;
    }
  }
  return onsets;
}

/** Octave-folded inter-onset-interval histogram → dominant BPM. */
function estimateBpm(onsets: number[]): { bpm: number; confidence: number } | null {
  if (onsets.length < 8) return null;
  const bins = new Map<number, number>();
  let total = 0;
  // M.14 — CONSECUTIVE intervals only. The old i→i+4 comparison reinforced
  // sub-divisions (a 150 BPM track's 2-step + 4-step both land on 75),
  // which systematically mis-read fast genres as half-time. Consecutive
  // intervals give the true beat period; the octave pick below repairs
  // the occasional missed-beat outlier.
  for (let i = 1; i < onsets.length; i++) {
    const iv = onsets[i] - onsets[i - 1];
    if (iv <= 0) continue;
    let bpm = 60000 / iv;
    while (bpm < BPM_LO) bpm *= 2;
    while (bpm > BPM_HI) bpm /= 2;
    const q = Math.round(bpm);
    bins.set(q, (bins.get(q) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;
  let best = -1;
  let bestCount = 0;
  for (const [q] of bins) {
    const c = (bins.get(q - 1) ?? 0) + (bins.get(q) ?? 0) + (bins.get(q + 1) ?? 0);
    if (c > bestCount) {
      bestCount = c;
      best = q;
    }
  }
  if (best < 0) return null;
  // M.14 — octave-robust pick (see liveBpm): strongest support, mild
  // preference for the 120-175 dancefloor band so fast genres (hardstyle
  // ~150) aren't read as half-time (~75).
  // M.21 — the candidate set now also covers METRICAL errors, not just
  // octaves: a syncopated/dotted rhythm floods the histogram with 3/4-beat
  // intervals, and the old pick landed on 3/4 of the true tempo (the
  // reported "random 112-113" on ~150 BPM tracks). Every candidate is
  // validated by VECTOR STRENGTH — how tightly the actual onset times
  // concentrate on one phase of that candidate's beat grid. A wrong
  // fractional tempo scatters the onsets around the circle and dies here;
  // the octave family survives and the support+dancefloor scoring picks
  // within it as before.
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
  const cands = [...new Set(rawCands.map((b) => Math.round(b)))].filter(
    (b) => b >= BPM_LO && b <= BPM_HI,
  );
  let maxVs = 0;
  const vs = new Map<number, number>();
  for (const c of cands) {
    const v = vectorStrength(onsets, c);
    vs.set(c, v);
    if (v > maxVs) maxVs = v;
  }
  const survivors = cands.filter((c) => (vs.get(c) ?? 0) >= maxVs * 0.75);
  let pick = best;
  let pickScore = -1;
  for (const c of survivors.length ? survivors : cands) {
    const pref = c >= 120 && c <= 175 ? 1.3 : 1;
    const sc = support(c) * pref;
    if (sc > pickScore) {
      pickScore = sc;
      pick = c;
    }
  }

  // M.21 — same sub-BPM refinement as liveBpm: sum every interval that
  // fits the picked tempo (k whole beats each) and divide time by beats,
  // cancelling the per-interval quantisation of the 10ms envelope hop.
  const period = 60000 / pick;
  let spanMs = 0;
  let beats = 0;
  for (let i = 1; i < onsets.length; i++) {
    const iv = onsets[i] - onsets[i - 1];
    const k = Math.round(iv / period);
    if (k >= 1 && Math.abs(iv - k * period) < period * 0.15) {
      spanMs += iv;
      beats += k;
    }
  }
  const refined = beats >= 8 && spanMs > 0 ? (60000 * beats) / spanMs : pick;
  // Confidence: histogram support, or the grid-fit itself when the pick
  // was rescued by vector strength (its bin can be empty then — a VS-won
  // half-time pick is still a solid, on-beat grid, not a zero).
  const conf = Math.max(support(pick) / total, (vs.get(pick) ?? 0) * 0.6);
  return { bpm: refined, confidence: Math.min(1, conf) };
}

/** M.21 — vector strength: how tightly onset times concentrate on one
 *  phase of a candidate tempo's grid. 1 = every onset on the same beat
 *  phase, 0 = spread evenly (wrong grid). */
function vectorStrength(onsets: number[], bpm: number): number {
  const interval = 60000 / bpm;
  let sx = 0;
  let sy = 0;
  for (const t of onsets) {
    const a = (2 * Math.PI * (t % interval)) / interval;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return Math.sqrt(sx * sx + sy * sy) / (onsets.length || 1);
}

/** Circular-mean phase of onsets against the beat interval → offsetMs. */
function estimatePhase(onsets: number[], bpm: number): number {
  const interval = 60000 / bpm;
  let sx = 0;
  let sy = 0;
  for (const t of onsets) {
    const angle = (2 * Math.PI * (t % interval)) / interval;
    sx += Math.cos(angle);
    sy += Math.sin(angle);
  }
  let phase = Math.atan2(sy, sx); // [-π, π]
  if (phase < 0) phase += 2 * Math.PI;
  return (phase / (2 * Math.PI)) * interval;
}

/** Analyze a decoded AudioBuffer for tempo + phase. */
export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<FileBpmResult | null> {
  const mono = await lowpassMono(buffer);
  const { env, hopMs } = energyEnvelope(mono, buffer.sampleRate);
  const onsets = detectOnsets(env, hopMs);
  const est = estimateBpm(onsets);
  if (!est) return null;
  const offsetMs = estimatePhase(onsets, est.bpm);
  return { bpm: Math.round(est.bpm * 10) / 10, offsetMs, confidence: est.confidence };
}

// Dev seam (same pattern as __liveBpm): lets manual testing run the
// offline analyzer on synthesized buffers without a file pick.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __analyzeAudioBuffer?: typeof analyzeAudioBuffer }).__analyzeAudioBuffer =
    analyzeAudioBuffer;
}
