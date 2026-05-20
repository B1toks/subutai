import { useEffect } from 'react';
import type { BeatClock } from '../hooks/useBeatClock';

interface Props {
  clock: BeatClock;
}

export function BeatCalibrator({ clock }: Props) {
  const { bpm, isRunning, tapBeat, start, stop, reset } = clock;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.code === 'Space' && e.shiftKey) {
        e.preventDefault();
        tapBeat();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tapBeat]);

  return (
    <div className="beat-calibrator">
      <div className="bpm-display">
        BPM: <strong>{bpm > 0 ? bpm : '—'}</strong>
        {isRunning && <span className="beat-running-dot" aria-hidden />}
      </div>
      <div className="beat-calibrator-actions">
        <button
          type="button"
          className="tap-btn"
          onClick={tapBeat}
          title="Tap in time with the music (Shift+Space also works)"
        >
          TAP
        </button>
        {bpm > 0 && !isRunning && (
          <button type="button" className="beat-start-btn" onClick={start}>
            Start
          </button>
        )}
        {isRunning && (
          <button type="button" className="beat-stop-btn" onClick={stop}>
            Stop
          </button>
        )}
        {bpm > 0 && (
          <button type="button" className="beat-reset-btn" onClick={reset} title="Clear tempo">
            Reset
          </button>
        )}
      </div>
      <div className="beat-calibrator-hint">
        Tap 4+ times in rhythm to lock BPM.
      </div>
    </div>
  );
}
