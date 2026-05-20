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

export class AmbientPlayer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private layers: ActiveLayer[] = [];
  private currentTheme: AmbientTheme | null = null;
  private volume: number;

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

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 2);
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
    const teardown = this.layers;
    this.layers = [];
    this.currentTheme = null;
    setTimeout(() => {
      teardown.forEach((l) => {
        try { l.osc.stop(); } catch { /* already stopped */ }
        try { l.lfo?.stop(); } catch { /* already stopped */ }
      });
    }, 600);
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
