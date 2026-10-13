import { beatBridge } from '../music/beatBridge';
import type { SessionEvent } from '../session/types';

/**
 * Beat combo: a move made at this device or by chat is scored against the
 * beat grid (beatBridge, a no-op when music sync is off). The bot's moves
 * and rotations are not scored; display-only, leaderboard points are
 * untouched.
 */
export function beatComboOnEvents(events: readonly SessionEvent[]): void {
  for (const e of events) {
    if (e.type !== 'move' || e.actor === 'bot' || e.move.kind === 'topologyToggle') continue;
    beatBridge.reportMove();
  }
}
