import { session } from '../session/session';
import { statusOf } from '../session/step';
import { beatComboOnEvents } from './beatCombo';
import { boardEvents } from './boardEvents';

// The services that react to what happens in the game: each one listens to
// the session's events instead of watching the board change. Started once,
// before the first render (main.tsx).

let started = false;

export function startSessionServices(): void {
  if (started) return;
  started = true;
  session.onEvents(beatComboOnEvents);
  // The board's sound and effects hear the session's events through the
  // board-events bus, which online play feeds too (onlineEvents.ts); they
  // act after the render that shows the move (useBoardEventsAfterCommit).
  session.onEvents((events, state) => boardEvents.emit(events, statusOf(state)));
}
