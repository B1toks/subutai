import { useEffect, useReducer } from 'react';
import { formatClockFace, mpClockAt, mpClockHeldFor, msToNextSecond, type MpClockState } from '../utils/mpClock';

interface ClockFaceProps {
  side: 'white' | 'black';
  /** The lit half: this side is to move. */
  running: boolean;
  /** Painted in the theme accent (yours) or the opponent accent. */
  mine: boolean;
  /** A countdown: can read low, and online rounds up. */
  countdown: boolean;
  /** Solo: the reading, re-rendered by App as its own clock ticks. */
  ms?: number;
  /** Online: the face reads the match clock itself and, while this side
   *  runs, re-renders on its own exactly when the shown second changes,
   *  so the rest of the app does not re-render with it. `now` is the
   *  clock the move stamps are in. */
  mp?: { clock: MpClockState; now: () => number } | null;
}

/**
 * V1 — one half of the tournament clock: one housing, two faces split by a
 * dashed seam, the running side lit. The readout stays digital (an unlit
 * 88:88 ghost with the live digits burning through it), which is how a DGT
 * reads in the hall.
 */
export function ClockFace({ side, running, mine, countdown, ms, mp }: ClockFaceProps) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = mp ? mp.now() : 0;
  const shown = mp ? mpClockAt(mp.clock, side, now) : ms ?? 0;
  const held = mp ? mpClockHeldFor(mp.clock, side, now) : 0;
  const ticking = !!mp && mp.clock.running === side;
  const roundUp = !!mp && countdown;
  // Re-armed after every render: the next wake is always the next change
  // of the shown second, on whatever phase the clock is.
  useEffect(() => {
    if (!ticking) return;
    const wait = held + msToNextSecond(shown, roundUp);
    if (!Number.isFinite(wait)) return;
    const id = setTimeout(tick, wait + 15);
    return () => clearTimeout(id);
  });
  // Only a real countdown can be "low". An elapsed clock reads low for its
  // first 30 seconds, which would paint every game red at the start.
  // Under 30 shown seconds, whichever way the face rounds.
  const low = countdown && (roundUp ? shown <= 29_000 : shown < 30_000);
  const face = formatClockFace(shown, roundUp);
  return (
    <div
      className={`tc-face tc-face-${side}${running ? ' is-running' : ''}${low ? ' is-low' : ''}${mine ? ' is-mine' : ' is-theirs'}`}
    >
      <span className="tc-readout">
        {/* Every segment of the display, unlit — the live digits sit
            exactly on top, so the glass reads as a real seven-segment
            panel instead of floating text. */}
        <span className="tc-ghost" aria-hidden>
          {face.replace(/\d/g, '8')}
        </span>
        <span className="tc-digits">{face}</span>
      </span>
      <span className="tc-name">
        <span className="tc-lamp" aria-hidden />
        {side === 'white' ? 'White' : 'Black'}
      </span>
    </div>
  );
}
