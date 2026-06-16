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

/** Sprint 3.8 — felt-on-wood thud. Pink-noise burst (warmer than the
 *  3.7 white noise) through a softer low-pass at 1.1 kHz, plus a very
 *  quiet 360→240 Hz sine body resonance so the tick lands with a hint
 *  of wooden colour but no crackle. Total ~60 ms. */
export function playMove(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;

  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.025), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastPink = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    lastPink = (lastPink + 0.05 * white) / 1.05;
    data[i] = lastPink * Math.exp(-i / (data.length * 0.18));
  }
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1100;
  filter.Q.value = 0.7;

  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'sine';
  bodyOsc.frequency.value = 360;
  bodyOsc.frequency.exponentialRampToValueAtTime(240, t + 0.025);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.06, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

  noise.connect(filter).connect(noiseGain).connect(out);
  bodyOsc.connect(bodyGain).connect(out);

  noise.start(t);
  bodyOsc.start(t);
  bodyOsc.stop(t + 0.06);
}

/** M.14 — warm wooden "pick up & set down". The old voice ran WHITE
 *  noise through a narrow 800 Hz band-pass, which read as a sharp hiss
 *  ("ципкий/шиплячий"). This is rounder: a soft sub thump for weight,
 *  PINK noise through a gentle low-pass (no resonant whistle) for the
 *  felt-on-wood brush, and two quiet wooden body partials for the
 *  "clack" of a piece landing — all with a soft 4 ms attack so nothing
 *  clicks. Reads as picking a piece up and placing it, not a crack. */
export function playCapture(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;

  // Sub thump — weight, slightly higher & rounder than before.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 110;
  sub.frequency.exponentialRampToValueAtTime(62, t + 0.16);

  // Pink (not white) noise — warmer; low-passed, not band-passed.
  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lastPink = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    lastPink = (lastPink + 0.045 * white) / 1.045;
    d[i] = lastPink * Math.exp(-i / (d.length * 0.32));
  }
  noise.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900; // gentle felt brush, no resonant whistle
  filter.Q.value = 0.6;

  // Two detuned sine partials — the soft wooden "clack" of landing.
  const body1 = ctx.createOscillator();
  body1.type = 'sine';
  body1.frequency.value = 190;
  body1.frequency.exponentialRampToValueAtTime(150, t + 0.09);
  const body2 = ctx.createOscillator();
  body2.type = 'sine';
  body2.frequency.value = 285;
  body2.frequency.exponentialRampToValueAtTime(225, t + 0.09);

  const subGain = ctx.createGain();
  const noiseGain = ctx.createGain();
  const bodyGain = ctx.createGain();

  // Soft attacks (~4 ms) so nothing clicks; gentle exponential tails.
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.linearRampToValueAtTime(0.32, t + 0.004);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

  noiseGain.gain.setValueAtTime(0.0001, t);
  noiseGain.gain.linearRampToValueAtTime(0.13, t + 0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.linearRampToValueAtTime(0.1, t + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

  sub.connect(subGain).connect(out);
  noise.connect(filter).connect(noiseGain).connect(out);
  body1.connect(bodyGain).connect(out);
  body2.connect(bodyGain);

  sub.start(t);
  sub.stop(t + 0.26);
  noise.start(t);
  body1.start(t);
  body1.stop(t + 0.15);
  body2.start(t);
  body2.stop(t + 0.15);
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

/** Sprint 4.1 — roulette wheel, tightened. 20 ticks (was 24 in 4.0,
 *  16 in 3.8) with the same 1.8-power ease-out + a slightly shorter
 *  interval scale, totalling ~2.3s of clicks + chime so the audio
 *  lines up with the 2300ms visual reveal in doSpinRouletteNow. */
export function playRouletteSpin(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const ticks = 20;
  let cumulative = 0;

  for (let i = 0; i < ticks; i++) {
    const progress = i / ticks;
    const interval = 0.04 + Math.pow(progress, 1.8) * 0.13;
    cumulative += interval;

    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    const clickFilter = ctx.createBiquadFilter();

    click.type = 'square';
    click.frequency.value = 750 + Math.random() * 250;

    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 1200;
    clickFilter.Q.value = 2;

    const startAt = t + cumulative;
    clickGain.gain.setValueAtTime(0, startAt);
    clickGain.gain.linearRampToValueAtTime(0.06, startAt + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.025);

    click.connect(clickFilter).connect(clickGain).connect(out);
    click.start(startAt);
    click.stop(startAt + 0.03);
  }

  const chimeStart = t + cumulative + 0.08;
  [1320, 1980].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const startAt = chimeStart + i * 0.04;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.1, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.6);
    osc.connect(gain).connect(out);
    osc.start(startAt);
    osc.stop(startAt + 0.65);
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
