/**
 * Sprint 3.8 / M.5.1 — per-theme ambient music.
 *
 * M.5.1 rework after listening feedback ("однообразна, низькочастотна,
 * ріже вухо"): the old design was a static stack of low saw/triangle
 * drones — all the energy sat below 300Hz and never changed. The new
 * design follows the Eno "Music for Airports" brief from the original
 * audio direction:
 *
 *   - a QUIET two-layer drone (filtered, warm) as the floor
 *   - a GENERATIVE note layer: every few seconds a soft mid-register
 *     tone from the theme's pentatonic scale, slow attack / long
 *     release, run through a feedback-delay "space" so notes overlap
 *     and shimmer instead of repeating
 *   - tension (M.5) now also affects WHICH notes play (minor colors)
 *     and HOW OFTEN (denser when the position burns), on top of the
 *     dissonant tension stack + heartbeat
 *
 * Volume capped at 0.4 (master gain) so music sits below the SFX layer.
 */

export type AmbientTheme = 'wood' | 'wood-light' | 'cyberpunk' | 'fantasy';
export type StingerKind = 'danger' | 'sacrifice';

interface DroneSpec {
  freq: number;
  type: OscillatorType;
  gainMul: number;
  filterFreq?: number;
}

interface ThemeSpec {
  drones: DroneSpec[];
  /** Calm generative palette (mid-register pentatonic). */
  scale: number[];
  /** Palette when tension > 0.55 — minor / darker colors. */
  tenseScale: number[];
  noteType: OscillatorType;
  /** Low-pass applied to each generative note. */
  noteFilter: number;
  /** Calm scheduling window between notes, ms. */
  noteIntervalMs: [number, number];
  /** Root for the tension stack + stingers. */
  tensionRoot: number;
}

const THEMES: Record<AmbientTheme, ThemeSpec> = {
  wood: {
    // Warm floor an octave apart, heavily filtered — felt, not heard.
    drones: [
      { freq: 110, type: 'triangle', gainMul: 0.4, filterFreq: 400 },
      { freq: 220, type: 'sine', gainMul: 0.3 },
    ],
    // A major pentatonic, A3–E5: kalimba-ish warmth.
    scale: [220, 246.94, 277.18, 329.63, 369.99, 440, 554.37, 659.26],
    // A harmonic-minor colors for tense positions.
    tenseScale: [220, 261.63, 329.63, 415.3, 440, 523.25],
    noteType: 'triangle',
    noteFilter: 1800,
    noteIntervalMs: [2600, 5600],
    tensionRoot: 220,
  },
  'wood-light': {
    drones: [
      { freq: 293.66, type: 'sine', gainMul: 0.35 },
      { freq: 440, type: 'sine', gainMul: 0.22 },
    ],
    // D major pentatonic, bright bells.
    scale: [293.66, 329.63, 369.99, 440, 493.88, 587.33, 739.99],
    tenseScale: [293.66, 349.23, 440, 466.16, 554.37, 587.33],
    noteType: 'sine',
    noteFilter: 2400,
    noteIntervalMs: [2400, 5200],
    tensionRoot: 293.66,
  },
  cyberpunk: {
    drones: [
      { freq: 55, type: 'sine', gainMul: 0.35 },
      { freq: 110, type: 'triangle', gainMul: 0.25, filterFreq: 500 },
    ],
    // A minor pentatonic blips.
    scale: [220, 261.63, 293.66, 329.63, 392, 440, 523.25],
    tenseScale: [220, 233.08, 293.66, 311.13, 415.3, 440],
    noteType: 'sawtooth',
    noteFilter: 1200,
    noteIntervalMs: [2200, 4800],
    tensionRoot: 220,
  },
  fantasy: {
    drones: [
      { freq: 98, type: 'triangle', gainMul: 0.35, filterFreq: 500 },
      { freq: 196, type: 'sine', gainMul: 0.25 },
    ],
    // G dorian — медієвальний відтінок.
    scale: [196, 220, 233.08, 261.63, 293.66, 349.23, 392],
    tenseScale: [196, 207.65, 246.94, 293.66, 311.13, 392],
    noteType: 'triangle',
    noteFilter: 1600,
    noteIntervalMs: [2800, 6000],
    tensionRoot: 196,
  },
};

interface ActiveLayer {
  osc: OscillatorNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  lfo?: OscillatorNode;
}

const MAX_VOLUME = 0.4;

export class AmbientPlayer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private layers: ActiveLayer[] = [];
  private currentTheme: AmbientTheme | null = null;
  private volume: number;

  // Generative note layer.
  private noteBus: GainNode | null = null;
  private delaySend: GainNode | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private delayNodes: AudioNode[] = [];

  // M.5 — adaptive tension sub-stack.
  private tensionGain: GainNode | null = null;
  private tensionLayers: ActiveLayer[] = [];
  private tensionTremolo: OscillatorNode | null = null;
  private tension = 0;

  constructor(ctx: AudioContext, output: AudioNode, initialVolume: number) {
    this.ctx = ctx;
    this.volume = Math.max(0, Math.min(MAX_VOLUME, initialVolume));
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(output);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(MAX_VOLUME, v));
    if (this.currentTheme === null) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 0.3);
  }

  getCurrentTheme(): AmbientTheme | null {
    return this.currentTheme;
  }

  /** Start the music for `theme`, fading in over 2s. Calling with the
   *  current theme is a no-op; a different theme hands over smoothly. */
  play(theme: AmbientTheme) {
    if (this.currentTheme === theme) return;
    this.stop();
    this.currentTheme = theme;
    const spec = THEMES[theme];
    this.buildDrone(spec);
    this.buildNoteSpace();
    this.buildTensionStack(spec);
    this.scheduleNextNote();

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 2);
    // Re-apply whatever tension the game last reported so theme hops
    // mid-battle don't drop the drama.
    if (this.tension > 0) this.applyTension(this.tension, 0.5);
  }

  /** Fade out and tear down everything. Safe to call when idle. */
  stop() {
    if (this.layers.length === 0 && this.currentTheme === null) return;
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
      this.noteTimer = null;
    }
    const now = this.ctx.currentTime;
    const currentValue = this.masterGain.gain.value;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(currentValue, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.5);

    const teardown = [...this.layers, ...this.tensionLayers];
    const tremolo = this.tensionTremolo;
    const delayNodes = this.delayNodes;
    this.layers = [];
    this.tensionLayers = [];
    this.tensionTremolo = null;
    this.tensionGain = null;
    this.noteBus = null;
    this.delaySend = null;
    this.delayNodes = [];
    this.currentTheme = null;
    setTimeout(() => {
      teardown.forEach((l) => {
        try { l.osc.stop(); } catch { /* already stopped */ }
        try { l.lfo?.stop(); } catch { /* already stopped */ }
      });
      try { tremolo?.stop(); } catch { /* already stopped */ }
      delayNodes.forEach((n) => {
        try { n.disconnect(); } catch { /* already disconnected */ }
      });
    }, 600);
  }

  // ─── M.5: adaptive tension ─────────────────────────────────────────

  /** Position drama on a 0..1 scale. Ramps ~1.2s so eval jitter doesn't
   *  pump the music. Also darkens the note palette + densifies the
   *  generative layer (read by the scheduler on each note). */
  setTension(t: number) {
    const clamped = Math.max(0, Math.min(1, t));
    if (Math.abs(clamped - this.tension) < 0.05 && clamped !== 0) return;
    this.tension = clamped;
    if (!this.tensionGain) return; // music off — remembered for play()
    this.applyTension(clamped, 1.2);
  }

  getTension(): number {
    return this.tension;
  }

  private applyTension(t: number, rampSec: number) {
    if (!this.tensionGain) return;
    const now = this.ctx.currentTime;
    // Perceptual curve + tamed ceiling (0.3): the clash should color the
    // music, not bury it.
    const g = t * t * 0.3;
    this.tensionGain.gain.cancelScheduledValues(now);
    this.tensionGain.gain.setValueAtTime(this.tensionGain.gain.value, now);
    this.tensionGain.gain.linearRampToValueAtTime(g, now + rampSec);
    if (this.tensionTremolo) {
      // Heartbeat speeds up with the stakes: 1.5Hz calm → 6Hz panic.
      this.tensionTremolo.frequency.cancelScheduledValues(now);
      this.tensionTremolo.frequency.setValueAtTime(this.tensionTremolo.frequency.value, now);
      this.tensionTremolo.frequency.linearRampToValueAtTime(1.5 + t * 4.5, now + rampSec);
    }
  }

  /** One-shot dramatic accent, mixed at music volume. */
  playStinger(kind: StingerKind) {
    if (this.currentTheme === null) return;
    const root = THEMES[this.currentTheme].tensionRoot;
    const now = this.ctx.currentTime;

    if (kind === 'danger') {
      // Rising growl an octave below the root, kept tame (lp ≤ 1000).
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(root / 4, now);
      osc.frequency.linearRampToValueAtTime(root / 2, now + 1.1);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(200, now);
      filter.frequency.linearRampToValueAtTime(1000, now + 1.0);
      filter.Q.value = 1.5;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.5);
      gain.gain.linearRampToValueAtTime(0, now + 1.4);
      osc.connect(filter).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.5);

      const sub = this.ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = Math.max(root / 4, 55);
      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0, now);
      subGain.gain.linearRampToValueAtTime(0.4, now + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      sub.connect(subGain).connect(this.masterGain);
      sub.start(now);
      sub.stop(now + 0.8);
      return;
    }

    // sacrifice — slow minor-triad swell (root, minor third, fifth).
    const freqs = [root, root * 1.189, root * 1.498];
    for (const [i, f] of freqs.entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = i % 2 === 0 ? 4 : -5;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now);
      filter.frequency.linearRampToValueAtTime(1600, now + 1.2);
      filter.frequency.linearRampToValueAtTime(600, now + 2.0);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.9);
      gain.gain.linearRampToValueAtTime(0, now + 2.1);
      osc.connect(filter).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 2.2);
    }
  }

  // ─── internals ─────────────────────────────────────────────────────

  private buildDrone(spec: ThemeSpec) {
    for (const d of spec.drones) {
      const osc = this.ctx.createOscillator();
      osc.type = d.type;
      osc.frequency.value = d.freq;
      osc.detune.value = Math.random() * 6 - 3;

      const gain = this.ctx.createGain();
      gain.gain.value = d.gainMul * 0.4;

      // Very slow gain LFO (8–20s period) so the floor breathes instead
      // of sitting dead-static — the "однообразність" fix at the
      // texture level.
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05 + Math.random() * 0.07;
      const lfoDepth = this.ctx.createGain();
      lfoDepth.gain.value = d.gainMul * 0.12;
      lfo.connect(lfoDepth).connect(gain.gain);
      lfo.start();

      let lastNode: AudioNode = osc;
      let filter: BiquadFilterNode | undefined;
      if (d.filterFreq) {
        filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = d.filterFreq;
        lastNode.connect(filter);
        lastNode = filter;
      }
      lastNode.connect(gain).connect(this.masterGain);
      osc.start();
      this.layers.push({ osc, gain, filter, lfo });
    }
  }

  /** Note bus + a stereo-ish feedback delay pair ("space"). Notes go
   *  dry→master and send→delays; the delays cross-feed at 0.35 so each
   *  tone echoes into the next few seconds. */
  private buildNoteSpace() {
    this.noteBus = this.ctx.createGain();
    this.noteBus.gain.value = 0.5;
    this.noteBus.connect(this.masterGain);

    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.value = 0.4;

    const delayA = this.ctx.createDelay(2);
    delayA.delayTime.value = 0.42;
    const delayB = this.ctx.createDelay(2);
    delayB.delayTime.value = 0.61;
    const fbA = this.ctx.createGain();
    fbA.gain.value = 0.35;
    const fbB = this.ctx.createGain();
    fbB.gain.value = 0.3;
    // Cross-feedback: A → B → A, both tapped into the note bus.
    this.delaySend.connect(delayA);
    delayA.connect(fbA).connect(delayB);
    delayB.connect(fbB).connect(delayA);
    delayA.connect(this.noteBus);
    delayB.connect(this.noteBus);
    this.delayNodes = [delayA, delayB, fbA, fbB, this.delaySend];
  }

  private scheduleNextNote() {
    if (!this.currentTheme) return;
    const spec = THEMES[this.currentTheme];
    const [lo, hi] = spec.noteIntervalMs;
    // Tension densifies the layer: at t=1 notes come ~2.5× faster.
    const scale = 1 - this.tension * 0.6;
    const wait = (lo + Math.random() * (hi - lo)) * scale;
    this.noteTimer = setTimeout(() => {
      this.playGenerativeNote();
      this.scheduleNextNote();
    }, wait);
  }

  private playGenerativeNote() {
    if (!this.currentTheme || !this.noteBus || !this.delaySend) return;
    const spec = THEMES[this.currentTheme];
    const palette = this.tension > 0.55 ? spec.tenseScale : spec.scale;
    const freq = palette[Math.floor(Math.random() * palette.length)];
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = spec.noteType;
    osc.frequency.value = freq;
    osc.detune.value = Math.random() * 8 - 4;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.noteFilter;

    // Slow swell in, long tail out — pad-like, never percussive.
    const attack = 0.6 + Math.random() * 0.9;
    const release = 2.5 + Math.random() * 2;
    const peak = 0.16 + Math.random() * 0.08;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attack + release);

    osc.connect(filter).connect(gain);
    gain.connect(this.noteBus);
    gain.connect(this.delaySend);
    osc.start(now);
    osc.stop(now + attack + release + 0.1);
  }

  /** Dissonant companion stack, silent until setTension() opens it.
   *  M.5.1: clash voiced an octave UP from the old version (less rumble)
   *  and through tighter filters — color, not mud. */
  private buildTensionStack(spec: ThemeSpec) {
    const root = spec.tensionRoot;
    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.masterGain);

    const mk = (
      freq: number,
      type: OscillatorType,
      gainMul: number,
      filterFreq?: number,
    ): ActiveLayer => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.value = gainMul;
      let lastNode: AudioNode = osc;
      let filter: BiquadFilterNode | undefined;
      if (filterFreq) {
        filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        lastNode.connect(filter);
        lastNode = filter;
      }
      lastNode.connect(gain).connect(this.tensionGain!);
      osc.start();
      return { osc, gain, filter };
    };

    // Semitone clash against the root — triangle, not saw.
    this.tensionLayers.push(mk(root * 1.0595, 'triangle', 0.4, 900));
    // Tritone — diabolus in musica, quiet sine.
    this.tensionLayers.push(mk(root * 1.4142, 'sine', 0.25));

    // Sub pulse with tremolo'd gain (heartbeat), clamped ≥ 55Hz.
    const sub = mk(Math.max(root / 4, 55), 'sine', 0.4);
    const tremolo = this.ctx.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 1.5;
    const tremDepth = this.ctx.createGain();
    tremDepth.gain.value = 0.35;
    tremolo.connect(tremDepth).connect(sub.gain.gain);
    tremolo.start();
    this.tensionTremolo = tremolo;
    this.tensionLayers.push(sub);
  }
}
