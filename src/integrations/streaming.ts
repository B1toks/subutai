import { session } from '../session/session';
import { beatComboOnEvents } from '../services/beatCombo';
import { startBoardPulse } from './music/boardPulse';
import { twitchGame } from './twitch/game';

/**
 * The streaming integrations, loaded only with STREAMING_UI and only after
 * the first load (./index.ts loads this module). What the app uses of
 * them is here; MusicDock and TwitchPanel, lazy themselves, import the
 * rest directly.
 */
export { moveVoting } from './twitch/moveVoting';
export { beatEngine } from './music/beatEngine';
export { beatMode } from './music/beatMode';
export { eqSettings } from './music/eqSettings';
export { micEq } from './music/micEqualizer';
export { vizMode } from './music/vizMode';
export { BeatCombo } from './music/BeatCombo';
export { MusicScorePanel } from './music/MusicScorePanel';
export { PerimeterEqualizer } from '../components/PerimeterEqualizer';

let connected = false;

/** Hooks the integrations to the game, once: the beat combo scores the
 *  moves made here, the board pulses on the beat, and chat's game (its
 *  result calls and leaderboard) follows the game on the board. */
export function connect(): void {
  if (connected) return;
  connected = true;
  session.onEvents(beatComboOnEvents);
  startBoardPulse();
  twitchGame.follow(session);
}
