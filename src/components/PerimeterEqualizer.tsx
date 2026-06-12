import { memo, useEffect, useRef } from 'react';
import { micEq } from '../audio/micEqualizer';

/* SP — perimeter equalizer ring, ported from the music-beat-sync
 * branch (M.3/M.4) and rewritten to be self-driving: instead of the
 * parent re-rendering 30×/s with a `bands` prop, the component
 * subscribes to micEq itself and pushes amplitudes straight into the
 * bar elements' --amplitude custom props. React renders the 60 spans
 * exactly once; everything after that is imperative style writes.
 *
 * Renders inside .board-with-coords (the ring is absolutely
 * positioned at inset −48px) and also drives the parent's
 * --bass-amplitude for the board halo. */

const BARS_PER_SIDE = 15;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const PEAK_THRESHOLD = 0.75;
const BASS_BANDS = 8;

function PerimeterEqualizerImpl() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const bars = root.querySelectorAll<HTMLElement>('.eq-bar');
    const parent = root.parentElement;
    parent?.classList.add('has-viz');

    const off = micEq.onUpdate((bands) => {
      const n = bands.length || 1;
      bars.forEach((bar, i) => {
        const amplitude = bands[i % n] ?? 0;
        bar.style.setProperty('--amplitude', amplitude.toFixed(3));
        bar.classList.toggle('is-peak', amplitude > PEAK_THRESHOLD);
      });
      if (parent) {
        let bass = 0;
        for (let i = 0; i < BASS_BANDS && i < bands.length; i++) bass += bands[i];
        parent.style.setProperty(
          '--bass-amplitude',
          (bass / Math.max(1, Math.min(BASS_BANDS, bands.length))).toFixed(3),
        );
      }
    });

    return () => {
      off();
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
