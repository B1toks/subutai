import { useEffect, useRef, useState } from 'react';
import type { BeatClock } from '../hooks/useBeatClock';

// Sprint M.1 — concentric radiating rings emanating from the board's
// centre on each beat. Sits as a viewport-fixed overlay so the wave
// reads as a global vibe pulse rather than a local board affordance.
//
// Each beat spawns a `.beat-ripple` div positioned at the board's
// centre; CSS handles the expansion + fadeout, and we GC the element
// after the animation duration to keep the DOM bounded.

interface Props {
  clock: BeatClock;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const RIPPLE_LIFE_MS = 1600;
const BOARD_SELECTOR = '.board';

export function BeatPulseOverlay({ clock }: Props) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const { isRunning, onBeat } = clock;

  useEffect(() => {
    if (!isRunning) return;

    const unsubscribe = onBeat(() => {
      const board = document.querySelector(BOARD_SELECTOR);
      if (!board) return;
      const rect = board.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const id = nextIdRef.current++;
      setRipples((prev) => [...prev, { id, x, y }]);
      const timer = setTimeout(() => {
        setRipples((prev) => prev.filter((p) => p.id !== id));
        timersRef.current.delete(timer);
      }, RIPPLE_LIFE_MS);
      timersRef.current.add(timer);
    });

    return unsubscribe;
  }, [isRunning, onBeat]);

  if (ripples.length === 0) return null;

  return (
    <div className="beat-pulse-overlay" aria-hidden>
      {ripples.map((p) => (
        <div
          key={p.id}
          className="beat-ripple"
          style={{ left: p.x, top: p.y }}
        />
      ))}
    </div>
  );
}
