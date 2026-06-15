import { memo, useEffect, useRef } from 'react';
import { micEq } from '../audio/micEqualizer';

/* M.12 — perimeter equalizer, "wave" edition.
 *
 * Self-driving: subscribes to micEq and writes amplitudes straight into
 * the bars' --amplitude vars (React renders the spans once). Two passes
 * smooth the signal into a continuous wave instead of jittery sticks:
 *   • spatial — each bar blends with its neighbours (3-tap)
 *   • temporal — the displayed value eases toward the target each frame
 * Wider, gap-less bars (CSS) + this smoothing read as one flowing band.
 *
 * Perf: the per-frame cost is just N var writes; the expensive
 * amplitude-driven box-shadow was dropped from the CSS, so this stays
 * cheap even at 30fps. */

const BARS_PER_SIDE = 16;
const TOTAL = BARS_PER_SIDE * 4;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const PEAK_THRESHOLD = 0.78;
const BASS_BANDS = 8;
// M.14 — was 0.35 (smooth but laggy). 0.5 keeps the wave fluid while
// shaving ~3 frames of latency; the analyser smoothing was also lowered.
const EASE = 0.5;

function PerimeterEqualizerImpl() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const bars = Array.from(root.querySelectorAll<HTMLElement>('.eq-bar'));
    const parent = root.parentElement;
    parent?.classList.add('has-viz');

    const display = new Float32Array(TOTAL); // eased values actually shown
    const target = new Float32Array(TOTAL);
    let raf = 0;

    // micEq pushes ~30fps; we just stash the smoothed targets here.
    const off = micEq.onUpdate((bands) => {
      const n = bands.length || 1;
      // M.14 — spatial pass: 5-tap weighted blend so neighbours melt into
      // one flowing wave (wider, smoother crest) instead of separate sticks.
      for (let i = 0; i < TOTAL; i++) {
        const v2 = bands[(i - 2 + n) % n] ?? 0;
        const v1 = bands[(i - 1 + n) % n] ?? 0;
        const v0 = bands[i % n] ?? 0;
        const w1 = bands[(i + 1) % n] ?? 0;
        const w2 = bands[(i + 2) % n] ?? 0;
        target[i] = v2 * 0.1 + v1 * 0.2 + v0 * 0.4 + w1 * 0.2 + w2 * 0.1;
      }
      if (parent) {
        let bass = 0;
        for (let i = 0; i < BASS_BANDS && i < bands.length; i++) bass += bands[i];
        parent.style.setProperty(
          '--bass-amplitude',
          (bass / Math.max(1, Math.min(BASS_BANDS, bands.length))).toFixed(3),
        );
      }
    });

    // Temporal pass: ease the displayed value toward the target on its
    // own rAF, decoupled from the audio callback, for a fluid wave.
    const tick = () => {
      for (let i = 0; i < TOTAL; i++) {
        display[i] += (target[i] - display[i]) * EASE;
        const v = display[i];
        const bar = bars[i];
        if (bar) {
          bar.style.setProperty('--amplitude', v.toFixed(3));
          if (v > PEAK_THRESHOLD) bar.classList.add('is-peak');
          else bar.classList.remove('is-peak');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      off();
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
