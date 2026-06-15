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
  // Compare each onset to the next few (not just the immediate next) so
  // a missed beat doesn't break the interval chain.
  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j <= i + 4 && j < onsets.length; j++) {
      const iv = onsets[j] - onsets[i];
      if (iv <= 0) continue;
      let bpm = 60000 / iv;
      while (bpm < BPM_LO) bpm *= 2;
      while (bpm > BPM_HI) bpm /= 2;
      const q = Math.round(bpm);
      bins.set(q, (bins.get(q) ?? 0) + 1);
      total++;
    }
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
  // M.12 — half-time octave-error fix for fast genres (hardstyle etc.).
  if (best < 100) {
    const dbl = best * 2;
    if (dbl <= BPM_HI) {
      const dblCount = (bins.get(dbl - 1) ?? 0) + (bins.get(dbl) ?? 0) + (bins.get(dbl + 1) ?? 0);
      if (dblCount >= bestCount * 0.6) {
        return { bpm: dbl, confidence: (bestCount + dblCount) / total };
      }
    }
  }
  return { bpm: best, confidence: bestCount / total };
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
