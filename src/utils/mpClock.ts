import type { MatchDoc } from '../firebase/matches';

/**
 * B8 / R13 — an online match's clocks, read from the move stamps alone.
 *
 * White's first move is free (no reliable "game started" epoch in the
 * doc); every later entry charges the time since the previous entry to its
 * mover, and with a Fischer increment every completed move credits its
 * mover. Only the side to move has a running clock, charged from the last
 * stamp; `at()` adds that charge for a given moment.
 *
 * This used to be computed in App from a `mpNow` state ticked every 500 ms,
 * which re-rendered the whole App twice a second and stepped the digits on
 * an arbitrary phase. The state below changes only when the match doc does;
 * the faces and the flag check tick on their own.
 */
export interface MpClockState {
  /** Each side's time without the running charge: left on a countdown,
   *  spent on an elapsed clock. A countdown can read below zero here. */
  white: number;
  black: number;
  /** A time control is set: the clocks count down and can flag. */
  countdown: boolean;
  /** The side whose clock runs (the match is live and a move was made). */
  running: 'white' | 'black' | null;
  /** The stamp the running clock is charged from. */
  since: number;
}

/** `timeControlSec` is the match's time control, or null when the clocks
 *  only count up (no control, or roulette). `live`: the match is active
 *  and has no outcome. */
export function mpClockState(
  match: Pick<MatchDoc, 'log' | 'timeIncrementSec'>,
  timeControlSec: number | null,
  live: boolean,
): MpClockState {
  const moves = match.log.moves;
  const incMs = (match.timeIncrementSec ?? 0) * 1000;
  let usedWhite = 0;
  let usedBlack = 0;
  for (let i = 1; i < moves.length; i++) {
    const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
    // Mover of entry i: entries alternate starting with white (rotations
    // consume the turn too, so parity holds in classic).
    if (i % 2 === 0) usedWhite += dt;
    else usedBlack += dt;
  }
  const last = moves[moves.length - 1]?.timestamp;
  const running = live && moves.length > 0 && typeof last === 'number'
    ? (moves.length % 2 === 0 ? 'white' : 'black')
    : null;
  const since = running ? last! : 0;
  if (!timeControlSec) {
    return { white: usedWhite, black: usedBlack, countdown: false, running, since };
  }
  // Completed-move counts: entries alternate W,B,W,B… so white made
  // ceil(n/2) of them and black the rest.
  const total = timeControlSec * 1000;
  return {
    white: total + Math.ceil(moves.length / 2) * incMs - usedWhite,
    black: total + Math.floor(moves.length / 2) * incMs - usedBlack,
    countdown: true,
    running,
    since,
  };
}

/** The time a side's clock shows at `now` (same clock as the stamps):
 *  left (never below 0) on a countdown, spent otherwise. */
export function mpClockAt(c: MpClockState, side: 'white' | 'black', now: number): number {
  const live = c.running === side ? Math.max(0, now - c.since) : 0;
  return c.countdown ? Math.max(0, c[side] - live) : c[side] + live;
}

/** How long until `side`'s clock starts to move at `now`: a stamp ahead
 *  of this device's clock (the mover's clock ahead of mine) holds it still
 *  until then. 0 once it runs, or when it does not run. */
export function mpClockHeldFor(c: MpClockState, side: 'white' | 'black', now: number): number {
  return c.running === side ? Math.max(0, c.since - now) : 0;
}

/** How long until a running face shows a different second. A countdown
 *  shows whole seconds rounded UP, so 00:00 appears exactly when the time
 *  is gone (the moment the flag falls), not a second before it; an
 *  elapsed clock rounds down. */
export function msToNextSecond(ms: number, roundUp: boolean): number {
  if (roundUp) return ms <= 0 ? Infinity : ((ms - 1) % 1000) + 1;
  return 1000 - (ms % 1000);
}

/**
 * V1 — fixed-width MM:SS for the tournament clock face.
 *
 * This used to be a "m:ss" formatter, which is fine in a sentence but
 * wrong on a clock: the digits shift sideways the moment the tens column
 * drops, and the unlit "88:88" ghost behind them stops lining up. Pads to
 * two, and grows past 99 minutes rather than truncating. `roundUp` shows
 * a countdown's partial second as a whole one, so 00:00 means the time is
 * gone.
 */
export function formatClockFace(ms: number, roundUp = false): string {
  const totalSec = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
