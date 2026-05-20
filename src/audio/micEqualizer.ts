// Sprint M.3 — microphone-driven equalizer. Opens the system mic via
// getUserMedia, runs an FFT, and downsamples the bins into 40 bars.
//
// Critically: the analyser is NOT connected to ctx.destination, so the
// captured audio never plays back through the speakers. That avoids a
// feedback loop (mic → speaker → mic) which on devices with even
// modest gain immediately howls.
//
// Works on any audible source — Spotify in another tab, a phone next
// to the laptop, a TV across the room. The browser handles permission
// state; we surface failures via the start() return value.

export type BandsListener = (bands: number[]) => void;

const BAND_COUNT = 40;
const FFT_SIZE = 128;             // 64 frequency bins post-FFT
const SMOOTHING = 0.85;           // analyser-side smoothing
const UPDATE_INTERVAL_MS = 33;    // ~30fps emit cap, matches spotifyEq

export type MicStartResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'no-device' | 'insecure' | 'unknown'; message?: string };

export class MicEqualizer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private bands: number[] = new Array(BAND_COUNT).fill(0);
  private listeners = new Set<BandsListener>();
  private lastEmitAt = 0;

  isRunning(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<MicStartResult> {
    if (this.ctx) return { ok: true };

    // Browsers (notably Chrome on mobile) refuse getUserMedia outside
    // a secure context — surface that cleanly rather than as a generic
    // NotAllowedError. localhost is treated as secure.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return { ok: false, reason: 'insecure' };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'no-device' };
    }

    try {
      // Disable the browser's voice processing — we want raw audio.
      // echoCancellation/noiseSuppression chew up music as if it were
      // speech and the visualizer ends up reacting to nothing.
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

    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = SMOOTHING;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    // Intentionally NOT: this.analyser.connect(this.ctx.destination).

    this.startTicking();
    return { ok: true };
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
    } catch {
      // already disconnected
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.stream = null;
    this.bands = new Array(BAND_COUNT).fill(0);
    this.listeners.forEach((cb) => cb(this.bands));
  }

  private startTicking() {
    if (!this.analyser) return;
    const binCount = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(binCount);

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);

      // Down-sample binCount bins → BAND_COUNT bars. Linear stride is
      // simple but gives a slightly bass-heavy bias; that's actually
      // desirable here since most music has more energy in the low end.
      const next = new Array(BAND_COUNT);
      for (let i = 0; i < BAND_COUNT; i++) {
        const binIdx = Math.floor((i / BAND_COUNT) * binCount);
        next[i] = dataArray[binIdx] / 255;
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
