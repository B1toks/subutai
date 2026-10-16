import { beatBridge } from '../music/beatBridge';
import type { SessionEvent } from '../session/types';
import { isPlayed } from './played';

/**
 * Beat combo: a move made at this device or by chat is scored against the
 * beat grid (beatBridge, a no-op when music sync is off). The bot's moves,
 * an online match's moves, rotations and replayed moves are not scored;
 * display-only, leaderboard points are untouched.
 */
export function beatComboOnEvents(events: readonly SessionEvent[]): void {
  for (const e of events) {
    if (!isPlayed(e) || e.actor === 'bot' || e.actor === 'remote' || e.move.kind === 'topologyToggle') continue;
    beatBridge.reportMove();
  }
}
