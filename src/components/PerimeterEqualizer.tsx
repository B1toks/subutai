import { memo, useEffect, useRef } from 'react';
import { micEq } from '../audio/micEqualizer';
import { eqSettings } from '../music/eqSettings';

/* M.14 — perimeter equalizer, "behind the board" edition.
 *
 * Self-driving: subscribes to micEq and writes amplitudes straight into
 * the bars' --amplitude vars (React renders the spans once). Three steps:
 *   • map    — each bar samples an ENERGETIC band by its position on the
 *              side: loud bass in the middle, fading to quiet treble at
 *              the corners. (The old straight 0..TOTAL→band mapping dumped
 *              the near-silent treble bins onto the left side, so the left
 *              looked dead — this fixes that and keeps all four sides
 *              equally alive, with no hard corner Ls.)
 *   • spatial — each bar blends with its neighbours (5-tap) → one wave.
 *   • temporal — the displayed value eases toward the target each frame.
 * The CSS now renders many thin GREY sticks BEHIND the board, so the
 * wave peeks out from under the board edges.
 *
 * Perf: per-frame cost is just N var writes; no per-bar box-shadow. */

const BARS_PER_SIDE = 28;
const TOTAL = BARS_PER_SIDE * 4;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const PEAK_THRESHOLD = 0.82;
const BASS_BANDS = 8;
// M.15 — asymmetric easing: SNAP up on a hit, ease DOWN smoothly. This is
// the classic "alive VU meter" trick — every beat/note punches instantly,
// then falls gracefully, instead of a symmetric blur that feels stuck.
const ATTACK = 0.92; // toward the target when rising (snap up on a hit)
// M.16 — was 0.16 (too slow → bars hung high and looked frozen). Faster fall
// so each bar visibly DROPS between hits and leaps back = "пригали скакали".
const RELEASE = 0.4;
// M.16 — response curve, take 3. The old gamma+tanh made every band SATURATE
// at high sensitivity → a flat line of equal bars ("рівні полоси"). New shape:
//   1. NOISE GATE — subtract a floor so quiet bands drop to 0. This is what
//      keeps the wave's peaks-and-valleys visible (contrast) at ANY gain,
//      instead of a uniformly-raised flat band.
//   2. gain = sensitivity (linear).
//   3. SOFT KNEE — gentle compression v/(1+v/KNEE) that never hard-clips and,
//      crucially, keeps loud bands spread apart (a tanh wall flattened them).
const NOISE_FLOOR = 0.05;
// M.16.1 — GENTLE knee so the soft ceiling is only reached near the TOP of
// the sensitivity range, not at ~1.4. No baseline gain: sensitivity is the
// sole multiplier, so the slider spans from tiny bars (min) to full-overshoot
// (max) across its whole length instead of saturating early.
const KNEE = 3.6;

/** M.16 — band each bar reads, swept across the energetic low-mid spectrum
 *  so EVERY bar reads a DIFFERENT band. Adjacent bars then differ and the
 *  wave jumps like a spectrum analyser, instead of the old mapping where the
 *  whole middle of each side hugged the same sub-bass band and read flat. */
function bandForBar(withinSide: number, bandCount: number): number {
  const span = Math.min(30, bandCount - 1);
  return Math.round((withinSide / (BARS_PER_SIDE - 1)) * span);
}

function PerimeterEqualizerImpl() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const bars = Array.from(root.querySelectorAll<HTMLElement>('.eq-bar'));
    const parent = root.parentElement;
    parent?.classList.add('has-viz');

    const display = new Float32Array(TOTAL); // eased values actually shown
    const raw = new Float32Array(TOTAL); // mapped, pre-smoothing
    const target = new Float32Array(TOTAL);
    let raf = 0;

    // M.15 — user "temperature": how hard the wave reacts. Read into a
    // mutable closure var (subscribed) so the per-frame map stays a plain
    // multiply — no React state in the hot path.
    let sens = eqSettings.getSensitivity();
    const offSens = eqSettings.onChange((v) => {
      sens = v;
    });

    // micEq pushes ~30fps; we just stash the smoothed targets here.
    const off = micEq.onUpdate((bands) => {
      const n = bands.length || 1;
      // Map: each bar reads an energetic band by its position on its side
      // (loud mid-side, fading to corners). Mild tilt lifts the corner
      // bars so all four sides stay alive. `sens` scales the punch so hard
      // tracks slam the bars to full reach.
      for (let i = 0; i < TOTAL; i++) {
        const within = i % BARS_PER_SIDE;
        const idx = bandForBar(within, n);
        // Lift higher (naturally quieter) bands so the whole sweep stays
        // lively, not just the bass end.
        const boost = 1 + (idx / n) * 1.6;
        // gate → gain → soft knee. The gate keeps quiet bands at 0 (contrast),
        // the knee stops loud bands pinning into a flat top.
        const gated = Math.max(0, (bands[idx] ?? 0) * boost - NOISE_FLOOR);
        const v = gated * sens;
        raw[i] = v / (1 + v / KNEE);
      }
      // M.16 — LIGHT 3-tap blend only (was a heavy 5-tap that melted every
      // bar into one flat level). Just enough to kill single-frame jitter
      // while keeping each bar independent so they jump.
      for (let i = 0; i < TOTAL; i++) {
        const v1 = raw[(i - 1 + TOTAL) % TOTAL];
        const w1 = raw[(i + 1) % TOTAL];
        target[i] = v1 * 0.16 + raw[i] * 0.68 + w1 * 0.16;
      }
      if (parent) {
        let bass = 0;
        for (let i = 0; i < BASS_BANDS && i < bands.length; i++) bass += bands[i];
        const avg = bass / Math.max(1, Math.min(BASS_BANDS, bands.length));
        // Halo follows the same temperature, capped so it glows hard but
        // doesn't wash the whole board out.
        parent.style.setProperty('--bass-amplitude', Math.min(1.2, avg * sens).toFixed(3));
      }
    });

    // Temporal pass: ease the displayed value toward the target on its
    // own rAF, decoupled from the audio callback, for a fluid wave.
    // M.15 — only touch the DOM when a bar actually moved (≥WRITE_EPS) or
    // crosses the peak threshold. With 112 bars this skips most style
    // writes when the wave is calm/idle — fewer recalcs, same look.
    const written = new Float32Array(TOTAL).fill(-1);
    const peaked = new Uint8Array(TOTAL);
    const WRITE_EPS = 0.0025;
    const tick = () => {
      for (let i = 0; i < TOTAL; i++) {
        const d = target[i] - display[i];
        display[i] += d * (d > 0 ? ATTACK : RELEASE);
        const v = display[i];
        const bar = bars[i];
        if (!bar) continue;
        if (Math.abs(v - written[i]) >= WRITE_EPS) {
          bar.style.setProperty('--amplitude', v.toFixed(3));
          written[i] = v;
        }
        const isPeak = v > PEAK_THRESHOLD ? 1 : 0;
        if (isPeak !== peaked[i]) {
          bar.classList.toggle('is-peak', isPeak === 1);
          peaked[i] = isPeak;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      off();
      offSens();
      cancelAnimationFrame(raf);
      parent?.classList.remove('has-viz');
      parent?.style.removeProperty('--bass-amplitude');
    };
  }, []);

  return (
    <div className="perimeter-eq" ref={rootRef} aria-hidden>
      {SIDES.map((side) => {
        const isVertical = side === 'top' || side === 'bottom';
        return (
          <div key={side} className={`eq-side eq-${side}`}>
            {Array.from({ length: BARS_PER_SIDE }, (_, i) => (
              <span
                key={i}
                className={`eq-bar eq-bar-${isVertical ? 'vertical' : 'horizontal'}`}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export const PerimeterEqualizer = memo(PerimeterEqualizerImpl);
