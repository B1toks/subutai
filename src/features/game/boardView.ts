import type { BoardState } from '../../engine';
import type { GameLog } from '../../recording/log';
import type { SessionState } from '../../session/types';

/**
 * The game on the board as App reads it (App.tsx: `online`, `state`,
 * `log`): an online match's game while this page plays one
 * (isMultiplayer, which is mpSync, not session state), else the solo
 * game. Selectors for useSession(selector) in the components App renders,
 * so they show the same game App does; each returns a piece of the state
 * as it is.
 */
export const boardOf = (isMultiplayer: boolean) => (s: SessionState): BoardState =>
  isMultiplayer && s.online?.game ? s.online.game.board : s.board;

export const logOf = (isMultiplayer: boolean) => (s: SessionState): GameLog =>
  isMultiplayer && s.online?.game ? s.online.game.log : s.log;
