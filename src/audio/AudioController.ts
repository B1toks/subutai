import {
  playBlunder,
  playBrilliant,
  playCapture,
  playCheck,
  playCheckmate,
  playClick,
  playMove,
  playPromotion,
  playRouletteSpin,
} from './synths';
import { AmbientPlayer, type AmbientTheme } from './ambient';

export type { AmbientTheme };

export type SfxName =
  | 'move'
  | 'capture'
  | 'check'
  | 'checkmate'
  | 'brilliant'
  | 'blunder'
  | 'promotion'
  | 'click'
  | 'rouletteSpin';

type AudioConstructor = typeof AudioContext;

interface WindowWithWebkit extends Window {
  webkitAudioContext?: AudioConstructor;
}

const ENABLED_KEY = 'subutai_audio_enabled';
const VOLUME_KEY = 'subutai_audio_volume';
const MUSIC_ENABLED_KEY = 'subutai_music_enabled';
const MUSIC_VOLUME_KEY = 'subutai_music_volume';

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
  // Sprint 3.8 — ambient music drone, separate sub-system. Lives in
  // its own AmbientPlayer with its own gain so SFX volume / music
  // volume can be tuned independently. Default OFF.
  private ambient: AmbientPlayer | null = null;
  private musicEnabled: boolean;
  private musicVolume: number;
  private pendingMusicTheme: AmbientTheme | null = null;

  constructor() {
    this.enabled = this.readEnabledFromStorage();
    this.volume = this.readVolumeFromStorage();
    this.musicEnabled = this.readMusicEnabledFromStorage();
    this.musicVolume = this.readMusicVolumeFromStorage();
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

  private readMusicEnabledFromStorage(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(MUSIC_ENABLED_KEY) === '1';
  }

  private readMusicVolumeFromStorage(): number {
    if (typeof window === 'undefined') return 0.15;
    const raw = window.localStorage.getItem(MUSIC_VOLUME_KEY);
    if (!raw) return 0.15;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return 0.15;
    return Math.max(0, Math.min(0.4, parsed));
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
      // Ambient gets its own player wired into the destination directly
      // (not through the SFX masterGain) so SFX / music volumes stay
      // independent.
      this.ambient = new AmbientPlayer(this.ctx, this.ctx.destination, this.musicVolume);
      if (this.musicEnabled && this.pendingMusicTheme) {
        this.ambient.play(this.pendingMusicTheme);
      }
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
      case 'rouletteSpin': playRouletteSpin(ctx, out); break;
    }
  }

  // ─── Sprint 3.8: ambient music drone API ────────────────────────

  setMusicEnabled(value: boolean, theme?: AmbientTheme) {
    this.musicEnabled = value;
    try {
      window.localStorage.setItem(MUSIC_ENABLED_KEY, value ? '1' : '0');
    } catch {
      /* private mode / quota — no-op */
    }
    if (value) {
      this.ensureContext();
      if (theme) this.pendingMusicTheme = theme;
      if (this.ambient && this.pendingMusicTheme) {
        this.ambient.play(this.pendingMusicTheme);
      }
    } else if (this.ambient) {
      this.ambient.stop();
    }
  }

  setMusicTheme(theme: AmbientTheme) {
    this.pendingMusicTheme = theme;
    if (this.musicEnabled && this.ambient) {
      this.ambient.play(theme);
    }
  }

  setMusicVolume(v: number) {
    this.musicVolume = Math.max(0, Math.min(0.4, v));
    try {
      window.localStorage.setItem(MUSIC_VOLUME_KEY, this.musicVolume.toString());
    } catch {
      /* private mode / quota — no-op */
    }
    if (this.ambient) this.ambient.setVolume(this.musicVolume);
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }
}

export const audio = new AudioControllerImpl();
