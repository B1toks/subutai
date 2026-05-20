import {
  playBlunder,
  playBrilliant,
  playCapture,
  playCheck,
  playCheckmate,
  playClick,
  playMove,
  playPromotion,
} from './synths';

export type SfxName =
  | 'move'
  | 'capture'
  | 'check'
  | 'checkmate'
  | 'brilliant'
  | 'blunder'
  | 'promotion'
  | 'click';

type AudioConstructor = typeof AudioContext;

interface WindowWithWebkit extends Window {
  webkitAudioContext?: AudioConstructor;
}

const ENABLED_KEY = 'subutai_audio_enabled';
const VOLUME_KEY = 'subutai_audio_volume';

/**
 * Sprint 3.7 — singleton wrapping a Web Audio context. Lazily creates
 * the context on first user-gesture playback (browsers block until
 * then), persists the on/off + volume preferences in localStorage,
 * and dispatches synth fns from ./synths. Default OFF so first-visit
 * users don't get surprised.
 */
class AudioControllerImpl {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean;
  private volume: number;

  constructor() {
    this.enabled = this.readEnabledFromStorage();
    this.volume = this.readVolumeFromStorage();
  }

  private readEnabledFromStorage(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ENABLED_KEY) === '1';
  }

  private readVolumeFromStorage(): number {
    if (typeof window === 'undefined') return 0.5;
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (!raw) return 0.5;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed));
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    try {
      const Ctor: AudioConstructor | undefined =
        window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('[audio] Web Audio unsupported', e);
      this.ctx = null;
    }
    return this.ctx;
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    try {
      window.localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
    } catch {
      /* private mode / quota — no-op */
    }
    if (value) this.ensureContext();
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    try {
      window.localStorage.setItem(VOLUME_KEY, this.volume.toString());
    } catch {
      /* private mode / quota — no-op */
    }
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  play(name: SfxName) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    // Browsers can leave the context in a "suspended" state if it was
    // created before the very first user gesture. Resume() is safe to
    // call repeatedly.
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const out = this.masterGain;
    switch (name) {
      case 'move':       playMove(ctx, out); break;
      case 'capture':    playCapture(ctx, out); break;
      case 'check':      playCheck(ctx, out); break;
      case 'checkmate':  playCheckmate(ctx, out); break;
      case 'brilliant':  playBrilliant(ctx, out); break;
      case 'blunder':    playBlunder(ctx, out); break;
      case 'promotion':  playPromotion(ctx, out); break;
      case 'click':      playClick(ctx, out); break;
    }
  }
}

export const audio = new AudioControllerImpl();
