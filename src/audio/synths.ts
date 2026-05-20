/**
 * Sprint 3.7 — short Web Audio SFX. Every voice synthesised on the
 * fly from oscillators + envelopes; no sample files, no external
 * library. Each function fires-and-forgets: schedules a few nodes
 * that auto-disconnect once the oscillator stops, so there's no
 * lifecycle to manage on the call site.
 */

function envelope(
  param: AudioParam,
  ctx: AudioContext,
  attackMs: number,
  holdMs: number,
  releaseMs: number,
  peak: number,
) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attackMs / 1000);
  param.setValueAtTime(peak, t + (attackMs + holdMs) / 1000);
  param.linearRampToValueAtTime(0, t + (attackMs + holdMs + releaseMs) / 1000);
}

/** Light wooden tick — every ordinary move. */
export function playMove(ctx: AudioContext, out: GainNode) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 380;
  osc.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + 0.05);
  envelope(gain.gain, ctx, 2, 10, 60, 0.25);
  osc.connect(gain).connect(out);
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
}

/** Deeper thump + filtered noise crunch — capture / en-passant. */
export function playCapture(ctx: AudioContext, out: GainNode) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 140;
  osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
  envelope(gain.gain, ctx, 3, 30, 100, 0.4);
  osc.connect(gain).connect(out);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);

  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  noise.buffer = buffer;
  const noiseGain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  envelope(noiseGain.gain, ctx, 1, 8, 50, 0.2);
  noise.connect(filter).connect(noiseGain).connect(out);
  noise.start();
}

/** Two-tone alert — opponent put in check. */
export function playCheck(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  [440, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    const startAt = t + i * 0.08;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.2, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.15);
    osc.connect(gain).connect(out);
    osc.start(startAt);
    osc.stop(startAt + 0.2);
  });
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

/** Ascending sparkle in the high register — brilliant move (!!). */
export function playBrilliant(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const notes = [1320, 1760, 2640]; // E6 / A6 / E7
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const startAt = t + i * 0.07;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.12, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.35);
    osc.connect(gain).connect(out);
    osc.start(startAt);
    osc.stop(startAt + 0.4);
  });
}

/** Descending sigh in the low register — blunder (??). */
export function playBlunder(ctx: AudioContext, out: GainNode) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 300;
  osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.6);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
  osc.connect(gain).connect(out);
  osc.start();
  osc.stop(ctx.currentTime + 0.75);
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
