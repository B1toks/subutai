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
  // M.14 — octave-robust pick (see liveBpm): half / detected / double,
  // strongest support, mild preference for the 120-175 dancefloor band
  // so fast genres (hardstyle ~150) aren't read as half-time (~75).
  const support = (b: number) =>
    (bins.get(b - 1) ?? 0) + (bins.get(b) ?? 0) + (bins.get(b + 1) ?? 0);
  const cands = [Math.round(best / 2), best, best * 2].filter((b) => b >= BPM_LO && b <= BPM_HI);
  let pick = best;
  let pickScore = -1;
  for (const c of cands) {
    const pref = c >= 120 && c <= 175 ? 1.3 : 1;
    const sc = support(c) * pref;
    if (sc > pickScore) {
      pickScore = sc;
      pick = c;
    }
  }
  return { bpm: pick, confidence: support(pick) / total };
}

/** M.16 — onset-strength envelope: positive flux of the energy envelope.
 *  Autocorrelating THIS exposes the beat period even on melodic tracks
 *  where discrete onset-picking misses (no clean kick transients). */
function onsetEnvelope(env: Float32Array): Float32Array {
  const n = env.length;
  const flux = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    flux[i] = Math.max(0, env[i] - prev);
    prev = env[i];
  }
  return flux;
}

/** M.16 — autocorrelation tempo. The lag (→BPM) with the strongest self-
 *  similarity in the onset envelope. Independent of onset DETECTION, so it
 *  catches tempos the histogram misses; `strength` (peak ÷ mean) measures
 *  how clear the periodicity is. */
function autocorrTempo(
  onsetEnv: Float32Array,
  hopMs: number,
): { bpm: number; strength: number } | null {
  const n = onsetEnv.length;
  if (n < 64) return null;
  const minLag = Math.max(1, Math.floor(60000 / BPM_HI / hopMs));
  const maxLag = Math.min(n - 1, Math.ceil(60000 / BPM_LO / hopMs));
  if (maxLag <= minLag) return null;

  let energy = 0;
  for (let i = 0; i < n; i++) energy += onsetEnv[i] * onsetEnv[i];
  if (energy <= 0) return null;

  const ac = new Float32Array(maxLag + 1);
  let meanAc = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += onsetEnv[i] * onsetEnv[i - lag];
    ac[lag] = sum / (n - lag); // normalise by overlap so long lags aren't penalised
    meanAc += ac[lag];
  }
  meanAc /= maxLag - minLag + 1;

  let bestLag = -1;
  let bestVal = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (ac[lag] > bestVal) {
      bestVal = ac[lag];
      bestLag = lag;
    }
  }
  if (bestLag < 0) return null;

  // Octave-robust pick over the AC curve (half / detected / double), mild
  // dancefloor preference — same idea as the histogram path.
  const acAt = (bpm: number): number => {
    const lag = Math.round(60000 / bpm / hopMs);
    return lag >= minLag && lag <= maxLag ? ac[lag] : 0;
  };
  const base = 60000 / (bestLag * hopMs);
  const cands = [base / 2, base, base * 2].filter((b) => b >= BPM_LO && b <= BPM_HI);
  let pick = base;
  let pickScore = -1;
  for (const c of cands) {
    const pref = c >= 120 && c <= 175 ? 1.15 : 1;
    const sc = acAt(c) * pref;
    if (sc > pickScore) {
      pickScore = sc;
      pick = c;
    }
  }
  const strength = meanAc > 0 ? bestVal / meanAc : 0;
  return { bpm: pick, strength };
}

/** M.16 — combine the histogram (ours) and autocorrelation estimates.
 *  Agreement → average + high confidence. Octave conflict → the dancefloor
 *  reading. Genuine disagreement → autocorrelation only if its periodicity
 *  is clearly strong; otherwise fall back to the histogram (never lose it). */
function chooseTempo(
  hist: { bpm: number; confidence: number } | null,
  ac: { bpm: number; strength: number } | null,
): { bpm: number; confidence: number } | null {
  if (hist && !ac) return hist;
  if (ac && !hist) return { bpm: ac.bpm, confidence: Math.min(0.85, ac.strength / 4) };
  if (!hist || !ac) return null;

  if (Math.abs(hist.bpm - ac.bpm) <= 3) {
    return { bpm: (hist.bpm + ac.bpm) / 2, confidence: Math.min(1, hist.confidence + 0.25) };
  }
  const ratio = hist.bpm / ac.bpm;
  if (Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.04) {
    const acIsDancefloor = ac.bpm >= 110 && ac.bpm <= 180;
    return acIsDancefloor
      ? { bpm: ac.bpm, confidence: Math.min(0.85, ac.strength / 4) }
      : hist;
  }
  // Real disagreement — trust autocorrelation only when it's clearly periodic.
  if (ac.strength >= 3.2) return { bpm: ac.bpm, confidence: Math.min(0.8, ac.strength / 5) };
  return { bpm: hist.bpm, confidence: hist.confidence * 0.8 };
}

/** M.16 — phase from the onset envelope (fallback when discrete onsets are
 *  too sparse for the circular mean): the beat-phase bin holding the most
 *  onset energy is the downbeat. */
function estimatePhaseFromEnv(onsetEnv: Float32Array, hopMs: number, bpm: number): number {
  const interval = 60000 / bpm;
  const lagFrames = interval / hopMs;
  const BINS = 48;
  const acc = new Float32Array(BINS);
  for (let i = 0; i < onsetEnv.length; i++) {
    const bin = Math.floor(((i % lagFrames) / lagFrames) * BINS) % BINS;
    acc[bin] += onsetEnv[i];
  }
  let bestBin = 0;
  let bestVal = -1;
  for (let b = 0; b < BINS; b++) {
    if (acc[b] > bestVal) {
      bestVal = acc[b];
      bestBin = b;
    }
  }
  return (bestBin / BINS) * interval;
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

/** Analyze a decoded AudioBuffer for tempo + phase.
 *  M.16 — two detectors run side by side: our onset-interval histogram and
 *  an autocorrelation pass. `chooseTempo` reconciles them (agreement wins,
 *  autocorrelation rescues melodic tracks, the histogram is always the
 *  fallback). Phase still comes from the real onsets when there are enough. */
export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<FileBpmResult | null> {
  const mono = await lowpassMono(buffer);
  const { env, hopMs } = energyEnvelope(mono, buffer.sampleRate);

  const onsets = detectOnsets(env, hopMs);
  const hist = estimateBpm(onsets); // method 1 — ours (kept as fallback)
  const onsetEnv = onsetEnvelope(env);
  const ac = autocorrTempo(onsetEnv, hopMs); // method 2 — autocorrelation

  const chosen = chooseTempo(hist, ac);
  if (!chosen) return null;

  const offsetMs =
    onsets.length >= 6
      ? estimatePhase(onsets, chosen.bpm)
      : estimatePhaseFromEnv(onsetEnv, hopMs, chosen.bpm);
  return { bpm: Math.round(chosen.bpm * 10) / 10, offsetMs, confidence: chosen.confidence };
}
