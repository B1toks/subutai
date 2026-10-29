import { session } from '../session/session';
import { statusOf } from '../session/step';
import { boardEvents } from './boardEvents';
import { spinSoundsOnEvents } from './spinSounds';

// The services that react to what happens in the game: each one listens to
// the session's events instead of watching the board change. Started once,
// before the first render (main.tsx). The beat combo (beatCombo.ts) is the
// streaming integrations' and starts with them (src/integrations).

let started = false;

export function startSessionServices(): void {
  if (started) return;
  started = true;
  session.onEvents(spinSoundsOnEvents);
  // The board's sound and effects hear the session's events, an online
  // match's moves too, through the board-events bus; they act after the
  // render that shows the move (useBoardEventsAfterCommit).
  session.onEvents((events, state) => boardEvents.emit(events, statusOf(state)));
}
