import { session } from '../session/session';
import { beatComboOnEvents } from './beatCombo';

// The services that react to what happens in the game: each one listens to
// the session's events instead of watching the board change. Started once,
// before the first render (main.tsx).

let started = false;

export function startSessionServices(): void {
  if (started) return;
  started = true;
  session.onEvents(beatComboOnEvents);
}
