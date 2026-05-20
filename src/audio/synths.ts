/**
 * Sprint 3.7 — short Web Audio SFX. Every voice synthesised on the
 * fly from oscillators + envelopes; no sample files, no external
 * library. Each function fires-and-forgets: schedules a few nodes
 * that auto-disconnect once the oscillator stops, so there's no
 * lifecycle to manage on the call site.
 */

/* Sprint 3.7 (rev 2) — `envelope()` helper removed; the wooden-feel
   refactor inlines its own gain ramps so the move / capture voices
   can layer noise + tonal bodies with independent envelopes. */

/** Sprint 3.7 (rev 2) — wooden tick. Noise burst into a low-pass
 *  filter + sine "body resonance" oscillator at ~200 Hz. Replaces the
 *  bare triangle tone that read as 8-bit. */
export function playMove(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;

  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
  }
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.Q.value = 1.2;

  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'sine';
  bodyOsc.frequency.value = 220;
  bodyOsc.frequency.exponentialRampToValueAtTime(180, t + 0.04);

  const noiseGain = ctx.createGain();
  const bodyGain = ctx.createGain();

  noiseGain.gain.setValueAtTime(0.4, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

  bodyGain.gain.setValueAtTime(0.15, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

  noise.connect(filter).connect(noiseGain).connect(out);
  bodyOsc.connect(bodyGain).connect(out);

  noise.start(t);
  bodyOsc.start(t);
  bodyOsc.stop(t + 0.1);
}

/** Heavier wooden clash — sub-bass thump + band-pass noise at ~800 Hz
 *  for the wood-on-wood crash overtone. */
export function playCapture(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 90;
  sub.frequency.exponentialRampToValueAtTime(55, t + 0.15);

  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.4));
  }
  noise.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 1.5;

  const subGain = ctx.createGain();
  const noiseGain = ctx.createGain();

  subGain.gain.setValueAtTime(0.35, t);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

  noiseGain.gain.setValueAtTime(0.25, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

  sub.connect(subGain).connect(out);
  noise.connect(filter).connect(noiseGain).connect(out);

  sub.start(t);
  sub.stop(t + 0.25);
  noise.start(t);
}

/** Single sharp tonal alert — opponent put in check. Sine sweep
 *  upward from A5 to C#6, no square waves (the old two-tone read as
 *  Pac-Man). */
export function playCheck(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  osc.frequency.exponentialRampToValueAtTime(1100, t + 0.1);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.35);
}

/** Dramatic descending arpeggio — game ended in checkmate. */
export function playCheckmate(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const notes = [880, 660, 440, 220];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const startAt = t + i * 0.12;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.4);
    osc.connect(gain).connect(out);
    osc.start(startAt);
    osc.stop(startAt + 0.5);
  });
}

/** Warm bell arpeggio — brilliant move (!!). Each note is fundamental
 *  + a slightly-quieter 3rd harmonic so the tone reads as bell-like
 *  rather than the bare pure sine that the previous version used.
 *  Pentatonic-ish run (E5 / A5 / D6 / G6). */
export function playBrilliant(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const notes = [659, 880, 1175, 1568];
  notes.forEach((freq, i) => {
    const startAt = t + i * 0.06;
    [1.0, 0.4].forEach((mult, h) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * (h === 0 ? 1 : 3);
      const peakGain = 0.1 * mult;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.6);
      osc.connect(gain).connect(out);
      osc.start(startAt);
      osc.stop(startAt + 0.65);
    });
  });
}

/** Muffled low descending tone — blunder (??). Low-pass filter at
 *  600 Hz removes the harshness of the previous sine sigh. */
export function playBlunder(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = 280;
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.7);

  filter.type = 'lowpass';
  filter.frequency.value = 600;

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.18, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

  osc.connect(filter).connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.85);
}

/** C-major chord — pawn promotion. */
export function playPromotion(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

/** Crisp UI blip — used for toggles and the audio "test" tap. */
export function playClick(ctx: AudioContext, out: GainNode) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1200;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  osc.connect(gain).connect(out);
  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}
