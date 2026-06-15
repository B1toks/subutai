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
// M.14 — was 0.35 (smooth but laggy). 0.5 keeps the wave fluid while
// shaving ~3 frames of latency; the analyser smoothing was also lowered.
const EASE = 0.5;
// M.15 — dynamics expansion. >1 suppresses quiet bands and lets the loud
// hits punch to full reach ("піки вистрілюють, тихе лишається тихим").
const GAMMA = 1.7;

/** Band each bar reads, by its index within its side (0..BARS_PER_SIDE-1).
 *  Middle of the side → low bass band (loud); ends → low-mid bands (still
 *  energetic, but the CSS mask fades them out so corners stay soft). */
function bandForBar(withinSide: number, bandCount: number): number {
  const edge = Math.abs((withinSide / (BARS_PER_SIDE - 1)) * 2 - 1); // 0 mid, 1 corner
  // Keep within the energetic lower third of the spectrum so every bar
  // actually moves; mid-side hugs the sub-bass.
  return Math.min(bandCount - 1, Math.round(edge * Math.min(22, bandCount - 1)));
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
        const edge = Math.abs((within / (BARS_PER_SIDE - 1)) * 2 - 1);
        const tilt = 1 + edge * 0.6;
        // M.15 — gamma: expand dynamics so peaks shoot to full reach while
        // quiet passages stay low (instead of everything floating mid-way).
        const b = Math.min(1, (bands[idx] ?? 0) * tilt);
        raw[i] = Math.min(1, Math.pow(b, GAMMA) * sens);
      }
      // M.14 — spatial pass: 5-tap weighted blend so neighbours melt into
      // one flowing wave (smoother crest) instead of separate sticks.
      for (let i = 0; i < TOTAL; i++) {
        const v2 = raw[(i - 2 + TOTAL) % TOTAL];
        const v1 = raw[(i - 1 + TOTAL) % TOTAL];
        const v0 = raw[i];
        const w1 = raw[(i + 1) % TOTAL];
        const w2 = raw[(i + 2) % TOTAL];
        target[i] = v2 * 0.1 + v1 * 0.2 + v0 * 0.4 + w1 * 0.2 + w2 * 0.1;
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
        display[i] += (target[i] - display[i]) * EASE;
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
