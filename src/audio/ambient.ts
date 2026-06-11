/**
 * Sprint 3.8 — per-theme ambient drone. Each theme gets a small stack
 * of always-running oscillators wired through optional low-pass
 * filters with a slow LFO sweep, fed into a master gain that fades
 * in / out smoothly. Switching themes hands over with no perceptible
 * gap. Volume capped at 0.4 (master gain) so the drone sits below
 * the SFX layer.
 */

export type AmbientTheme = 'wood' | 'wood-light' | 'cyberpunk' | 'fantasy';

interface LayerOpts {
  detune?: number;
  gainMul?: number;
  filterFreq?: number;
  filterQ?: number;
  /** LFO rate in Hz to sweep the filter cutoff. */
  lfoRate?: number;
}

interface ActiveLayer {
  osc: OscillatorNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
}

const MAX_VOLUME = 0.4;

/* M.5 — per-theme root note for the tension stack. Matches the drone's
 * tonal center so the dissonant layers clash *against* it rather than
 * just sounding like noise. */
const TENSION_ROOT: Record<AmbientTheme, number> = {
  wood: 110,         // A2
  'wood-light': 147, // D3 (drone is D4/A4)
  cyberpunk: 55,     // A1
  fantasy: 98,       // G2
};

export type StingerKind = 'danger' | 'sacrifice';

export class AmbientPlayer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private layers: ActiveLayer[] = [];
  private currentTheme: AmbientTheme | null = null;
  private volume: number;
  // M.5 — adaptive tension sub-stack. Always built alongside the drone
  // but muted; setTension() fades it in/out as the position heats up.
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

  /** Start the drone for `theme`, fading in over 2s. Calling with the
   *  current theme is a no-op; calling with a different theme stops
   *  the existing stack first. */
  play(theme: AmbientTheme) {
    if (this.currentTheme === theme) return;
    this.stop();
    this.currentTheme = theme;
    this.buildLayersForTheme(theme);
    this.buildTensionStack(theme);

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 2);
    // Re-apply whatever tension the game last reported so theme hops
    // mid-battle don't drop the drama.
    if (this.tension > 0) this.applyTension(this.tension, 0.5);
  }

  /** Fade out and tear down the oscillator stack. Safe to call when
   *  nothing is playing. */
  stop() {
    if (this.layers.length === 0 && this.currentTheme === null) return;
    const now = this.ctx.currentTime;
    const currentValue = this.masterGain.gain.value;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(currentValue, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 0.5);
    const teardown = [...this.layers, ...this.tensionLayers];
    const tremolo = this.tensionTremolo;
    this.layers = [];
    this.tensionLayers = [];
    this.tensionTremolo = null;
    this.tensionGain = null;
    this.currentTheme = null;
    setTimeout(() => {
      teardown.forEach((l) => {
        try { l.osc.stop(); } catch { /* already stopped */ }
        try { l.lfo?.stop(); } catch { /* already stopped */ }
      });
      try { tremolo?.stop(); } catch { /* already stopped */ }
    }, 600);
  }

  // ─── M.5: adaptive tension ─────────────────────────────────────────

  /** Position drama on a 0..1 scale. 0 = calm drone only; 1 = full
   *  dissonance + racing heartbeat. Ramps smoothly (~1.2s) so eval
   *  jitter between moves doesn't pump the music. */
  setTension(t: number) {
    const clamped = Math.max(0, Math.min(1, t));
    // Ignore sub-5% wiggles — they're search noise, not drama.
    if (Math.abs(clamped - this.tension) < 0.05 && clamped !== 0) return;
    this.tension = clamped;
    if (!this.tensionGain) return; // music not playing — remembered for play()
    this.applyTension(clamped, 1.2);
  }

  getTension(): number {
    return this.tension;
  }

  private applyTension(t: number, rampSec: number) {
    if (!this.tensionGain) return;
    const now = this.ctx.currentTime;
    // Perceptual curve: dissonance stays subtle until ~0.5 then opens up.
    const g = t * t * 0.5;
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

  /** One-shot dramatic accent, mixed at music volume.
   *  - danger: low sawtooth swell + sub thump (king under threat / mate found)
   *  - sacrifice: minor-chord string swell (material thrown into the fire) */
  playStinger(kind: StingerKind) {
    if (this.currentTheme === null) return; // music off — no stingers
    const root = TENSION_ROOT[this.currentTheme];
    const now = this.ctx.currentTime;

    if (kind === 'danger') {
      // Rising low growl: G-ish root gliding up an octave through an
      // opening low-pass, with a sub-bass heartbeat thump underneath.
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(root / 2, now);
      osc.frequency.linearRampToValueAtTime(root, now + 1.1);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(200, now);
      filter.frequency.linearRampToValueAtTime(1400, now + 1.0);
      filter.Q.value = 2;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.5);
      gain.gain.linearRampToValueAtTime(0, now + 1.4);
      osc.connect(filter).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.5);

      const sub = this.ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = root / 3;
      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0, now);
      subGain.gain.linearRampToValueAtTime(0.6, now + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      sub.connect(subGain).connect(this.masterGain);
      sub.start(now);
      sub.stop(now + 0.8);
      return;
    }

    // sacrifice — slow minor-triad swell (root, minor third, fifth),
    // detuned saws through a gentle low-pass: "strings" rising out of
    // the drone and sinking back.
    const freqs = [root, root * 1.189, root * 1.498];
    for (const [i, f] of freqs.entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = i % 2 === 0 ? 4 : -5;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, now);
      filter.frequency.linearRampToValueAtTime(1800, now + 1.2);
      filter.frequency.linearRampToValueAtTime(600, now + 2.0);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.9);
      gain.gain.linearRampToValueAtTime(0, now + 2.1);
      osc.connect(filter).connect(gain).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 2.2);
    }
  }

  /** Dissonant companion stack, silent until setTension() opens it:
   *  semitone clash + tritone over the theme root, plus a tremolo'd
   *  sub pulse whose rate scales with tension (the "heartbeat"). */
  private buildTensionStack(theme: AmbientTheme) {
    const root = TENSION_ROOT[theme];
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

    // Semitone clash against the root — the classic horror rub.
    this.tensionLayers.push(mk(root * 1.0595, 'sawtooth', 0.5, 900));
    // Tritone — diabolus in musica.
    this.tensionLayers.push(mk(root * 1.4142, 'triangle', 0.35));

    // Sub pulse with tremolo'd gain (heartbeat). Base 0.45 ± 0.4 keeps
    // the gain positive so the LFO reads as a pulse, not phase flips.
    const sub = mk(root / 2, 'sine', 0.45);
    const tremolo = this.ctx.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 1.5;
    const tremDepth = this.ctx.createGain();
    tremDepth.gain.value = 0.4;
    tremolo.connect(tremDepth).connect(sub.gain.gain);
    tremolo.start();
    this.tensionTremolo = tremolo;
    this.tensionLayers.push(sub);
  }

  private buildLayersForTheme(theme: AmbientTheme) {
    switch (theme) {
      case 'wood':
        // Warm low drone — A2 detuned pair + E3 quiet companion.
        this.addLayer(110, 'triangle', { detune: 5 });
        this.addLayer(110, 'triangle', { detune: -7 });
        this.addLayer(165, 'sine', { gainMul: 0.5 });
        break;
      case 'wood-light':
        // Bright airy pad — D4 + A4 sine with a very slow LFO sweep.
        this.addLayer(294, 'sine', { detune: 3 });
        this.addLayer(440, 'sine', { detune: -5, gainMul: 0.6 });
        break;
      case 'cyberpunk':
        // Cold synth — A1 sub + A2/A3 sawtooth with filter sweep.
        this.addLayer(55, 'sine', { gainMul: 0.7 });
        this.addLayer(110, 'sawtooth', {
          detune: 7,
          filterFreq: 800,
          filterQ: 4,
          lfoRate: 0.08,
        });
        this.addLayer(220, 'sawtooth', {
          detune: -5,
          filterFreq: 1200,
          gainMul: 0.3,
        });
        break;
      case 'fantasy':
        // Cello-like sustain — G2 saw through low-pass, octave + 5th sines.
        this.addLayer(98, 'sawtooth', {
          detune: 3,
          filterFreq: 600,
          filterQ: 1.5,
          lfoRate: 0.1,
        });
        this.addLayer(196, 'sine', { gainMul: 0.6 });
        this.addLayer(294, 'sine', { detune: 5, gainMul: 0.3 });
        break;
    }
  }

  private addLayer(freq: number, type: OscillatorType, opts: LayerOpts = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (opts.detune) osc.detune.value = opts.detune;

    const gain = this.ctx.createGain();
    gain.gain.value = (opts.gainMul ?? 1) * 0.4;

    let lastNode: AudioNode = osc;
    let filter: BiquadFilterNode | undefined;
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;

    if (opts.filterFreq) {
      filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.filterFreq;
      if (opts.filterQ) filter.Q.value = opts.filterQ;
      lastNode.connect(filter);
      lastNode = filter;

      if (opts.lfoRate) {
        lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = opts.lfoRate;
        lfoGain = this.ctx.createGain();
        lfoGain.gain.value = opts.filterFreq * 0.3;
        lfo.connect(lfoGain).connect(filter.frequency);
        lfo.start();
      }
    }

    lastNode.connect(gain).connect(this.masterGain);
    osc.start();

    this.layers.push({ osc, gain, filter, lfo, lfoGain });
  }
}
