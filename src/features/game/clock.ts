// The tournament clock: the face it shows, and an online match's clocks,
// which both players work out on their own from the move timestamps.

/**
 * V1 — fixed-width MM:SS for the tournament clock face.
 *
 * This used to be a "m:ss" formatter, which is fine in a sentence but
 * wrong on a clock: the digits shift sideways the moment the tens column
 * drops, and the unlit "88:88" ghost behind them stops lining up. Pads to
 * two, and grows past 99 minutes rather than truncating.
 */
export function formatClockFace(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface MatchClocks {
  white: number;
  black: number;
  /** Counting down against a time control; only then can a flag fall. */
  countdown: boolean;
}

/** Each side's clock in an online match at `now`. `live` charges the time
 *  since the last move to the side on turn. */
export function matchClocks(
  moves: readonly { timestamp?: number }[],
  timeControlSec: number | null,
  incrementSec: number | null | undefined,
  live: boolean,
  now: number,
): MatchClocks {
  // R13 — Fischer increment: every completed move credits its mover.
  const incMs = (incrementSec ?? 0) * 1000;
  let usedWhite = 0;
  let usedBlack = 0;
  for (let i = 1; i < moves.length; i++) {
    const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
    // Mover of entry i: entries alternate starting with white (rotations
    // consume the turn too, so parity holds in classic).
    if (i % 2 === 0) usedWhite += dt;
    else usedBlack += dt;
  }
  if (live && moves.length > 0) {
    const elapsed = Math.max(0, now - (moves[moves.length - 1].timestamp ?? now));
    if (moves.length % 2 === 0) usedWhite += elapsed;
    else usedBlack += elapsed;
  }
  // No time control: just show what each side has spent. Same numbers,
  // counted up instead of down, and nothing can flag.
  if (!timeControlSec) {
    return { white: usedWhite, black: usedBlack, countdown: false };
  }
  // Completed-move counts: entries alternate W,B,W,B… so white made
  // ceil(n/2) of them and black the rest.
  const whiteMoves = Math.ceil(moves.length / 2);
  const blackMoves = Math.floor(moves.length / 2);
  const total = timeControlSec * 1000;
  return {
    white: Math.max(0, total + whiteMoves * incMs - usedWhite),
    black: Math.max(0, total + blackMoves * incMs - usedBlack),
    countdown: true,
  };
}
