// Sprint M.3 — microphone-driven equalizer. Opens the system mic via
// getUserMedia, runs an FFT, and downsamples the bins into N bars.
//
// M.4 upgrades:
//   • GainNode boost (default 3×) — laptop mics are notoriously quiet.
//   • Auto-gain: tracks a rolling peak history and nudges the gain so
//     the visualizer sits at ~70% of full-scale on average. Capped at
//     [1, 8] so we never clip the analyser or amplify pure noise into
//     a static-fed shimmer.
//   • Logarithmic frequency mapping — bass gets more bars than treble,
//     matching how music actually distributes energy.
//   • Power curve (γ=0.7) — lifts mid-amplitude bars without crushing
//     the silent floor, so quiet music still produces visible motion.
//
// Critically: the analyser is NOT connected to ctx.destination, so the
// captured audio never plays back through the speakers (no feedback).

export type BandsListener = (bands: number[]) => void;

const BAND_COUNT = 60;
const FFT_SIZE = 256;             // 128 frequency bins post-FFT
const SMOOTHING = 0.82;           // analyser-side smoothing
const UPDATE_INTERVAL_MS = 33;    // ~30fps emit cap

// Auto-gain calibration knobs.
const INITIAL_GAIN = 3.0;
const MIN_GAIN = 1.0;
const MAX_GAIN = 8.0;
const PEAK_HISTORY_SIZE = 60;
const PEAK_HISTORY_MIN_FOR_ADJUST = 30;
const TARGET_PEAK_LOW = 80;       // below this, boost
const TARGET_PEAK_HIGH = 200;     // above this, attenuate
const GAIN_STEP_UP = 1.05;
const GAIN_STEP_DOWN = 0.95;
const POWER_CURVE_GAMMA = 0.7;

export type AudioSource = 'mic' | 'display';

export type MicStartResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'denied' | 'no-device' | 'insecure' | 'no-audio-track' | 'unsupported' | 'unknown';
      message?: string;
    };

export class MicEqualizer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private bands: number[] = new Array(BAND_COUNT).fill(0);
  private listeners = new Set<BandsListener>();
  private lastEmitAt = 0;
  private peakHistory: number[] = [];
  private autoGainEnabled = true;
  // SP — run-state listeners so UI (perimeter ring mount) can follow
  // start/stop without polling.
  private stateListeners = new Set<(running: boolean) => void>();
  // SP-8 — which capture is active (mic vs tab/system audio).
  private activeSource: AudioSource | null = null;

  isRunning(): boolean {
    return this.ctx !== null;
  }

  getSource(): AudioSource | null {
    return this.activeSource;
  }

  onState(cb: (running: boolean) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.isRunning());
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  private emitState(running: boolean) {
    this.stateListeners.forEach((cb) => {
      try {
        cb(running);
      } catch {
        // listener errors must not break the equalizer
      }
    });
  }

  async start(): Promise<MicStartResult> {
    if (this.ctx) return { ok: true };

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return { ok: false, reason: 'insecure' };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'no-device' };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      const err = e as DOMException;
      const reason =
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'denied'
          : err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError'
            ? 'no-device'
            : 'unknown';
      return { ok: false, reason, message: err.message };
    }

    this.wireStream(this.stream, 'mic');
    return { ok: true };
  }

  /**
   * SP-8 — capture TAB / SYSTEM audio via getDisplayMedia instead of the
   * mic. This taps the actual digital audio (the Spotify embed, a
   * YouTube tab, anything playing), so:
   *   • it works on headphones — no speakers needed (internal audio)
   *   • no mic processing / AEC ducking that degraded playback
   *   • no room noise — clean signal for the live BPM detector
   *
   * The browser shows a picker; the user must tick "Share tab/system
   * audio". We request video too (Chrome won't do audio-only display
   * capture) but immediately drop the video track.
   */
  async startDisplay(): Promise<MicStartResult> {
    if (this.ctx) return { ok: true };
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return { ok: false, reason: 'insecure' };
    }
    const md = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    };
    if (!md.getDisplayMedia) {
      return { ok: false, reason: 'unsupported' };
    }

    let stream: MediaStream;
    try {
      stream = await md.getDisplayMedia({ audio: true, video: true });
    } catch (e) {
      const err = e as DOMException;
      return {
        ok: false,
        reason: err.name === 'NotAllowedError' ? 'denied' : 'unknown',
        message: err.message,
      };
    }

    // Drop the video track — we only want the audio.
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      return { ok: false, reason: 'no-audio-track' };
    }
    this.stream = stream;
    this.wireStream(stream, 'display');
    return { ok: true };
  }

  /** Shared AudioContext + analyser wiring for any capture stream. */
  private wireStream(stream: MediaStream, source: AudioSource) {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    // Display capture is already line-level/loud; the mic needs the boost.
    this.gain.gain.value = source === 'display' ? 1.0 : INITIAL_GAIN;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = SMOOTHING;

    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.gain).connect(this.analyser);
    // Intentionally NOT connected to ctx.destination — no playback,
    // no feedback. The user already hears the audio from its own source.

    // If the user stops the share from the browser's own UI, tear down.
    stream.getAudioTracks().forEach((t) => {
      t.addEventListener('ended', () => this.stop());
    });

    this.activeSource = source;
    this.peakHistory = [];
    this.startTicking();
    this.emitState(true);
  }

  setAutoGain(enabled: boolean) {
    this.autoGainEnabled = enabled;
  }

  getGain(): number {
    return this.gain?.gain.value ?? INITIAL_GAIN;
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
    try {
      this.source?.disconnect();
      this.gain?.disconnect();
    } catch {
      // already disconnected
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.source = null;
    this.stream = null;
    this.activeSource = null;
    this.peakHistory = [];
    this.bands = new Array(BAND_COUNT).fill(0);
    this.listeners.forEach((cb) => cb(this.bands));
    this.emitState(false);
  }

  private startTicking() {
    const analyser = this.analyser;
    if (!analyser) return;
    const binCount = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(binCount);

    const tick = () => {
      const a = this.analyser;
      const g = this.gain;
      if (!a || !g) return;
      a.getByteFrequencyData(dataArray);

      // Auto-gain: track the per-frame peak across the spectrum, then
      // adjust the gain to land the rolling average near the target
      // band. Bounded so a totally silent room can't ramp up forever.
      let currentPeak = 0;
      for (let i = 0; i < binCount; i++) {
        if (dataArray[i] > currentPeak) currentPeak = dataArray[i];
      }
      this.peakHistory.push(currentPeak);
      if (this.peakHistory.length > PEAK_HISTORY_SIZE) this.peakHistory.shift();

      if (
        this.autoGainEnabled &&
        this.peakHistory.length >= PEAK_HISTORY_MIN_FOR_ADJUST
      ) {
        const avgPeak =
          this.peakHistory.reduce((a2, b2) => a2 + b2, 0) /
          this.peakHistory.length;
        const cur = g.gain.value;
        if (avgPeak < TARGET_PEAK_LOW && cur < MAX_GAIN) {
          g.gain.value = Math.min(MAX_GAIN, cur * GAIN_STEP_UP);
        } else if (avgPeak > TARGET_PEAK_HIGH && cur > MIN_GAIN) {
          g.gain.value = Math.max(MIN_GAIN, cur * GAIN_STEP_DOWN);
        }
      }

      // Logarithmic band mapping. t^2.5 stretches the low end of the
      // bin range across more bars — a 60-band linear mapping wastes
      // half the bars on inaudible >10kHz bins; log mapping puts them
      // where music lives. The averaging window (span) smooths between
      // adjacent bins so neighbouring bars don't pop independently.
      const next = new Array(BAND_COUNT);
      const span = Math.max(1, Math.floor(binCount / BAND_COUNT));
      for (let i = 0; i < BAND_COUNT; i++) {
        const t = i / BAND_COUNT;
        const logIdx = Math.pow(t, 2.5) * binCount;
        const idx = Math.floor(logIdx);
        let sum = 0;
        let n = 0;
        for (let j = 0; j < span && idx + j < binCount; j++) {
          sum += dataArray[idx + j];
          n += 1;
        }
        const value = n > 0 ? sum / n / 255 : 0;
        // Power curve lifts mid-range without clipping.
        next[i] = Math.min(1, Math.pow(value, POWER_CURVE_GAMMA));
      }
      this.bands = next;

      const now = performance.now();
      if (now - this.lastEmitAt >= UPDATE_INTERVAL_MS) {
        this.lastEmitAt = now;
        this.listeners.forEach((cb) => {
          try {
            cb(this.bands);
          } catch {
            // listener errors must not break the loop
          }
        });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}

export const micEq = new MicEqualizer();
