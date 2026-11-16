import type { BoardState, Move, PieceType } from '../../engine';
import type { GameLog } from '../../recording/log';
import type { LastMove, RouletteReveal, SessionState } from '../../session/types';
import type { GameMode, GameStatus } from '../../shared/game';

/**
 * The game on the board as App reads it (App.tsx: `online`, `state`,
 * `log`): an online match's game while this page plays one
 * (isMultiplayer, which is mpSync, not session state), else the solo
 * game. Selectors for useSession(selector) in the components App renders
 * and in the hooks it calls, so they read the same game App does; each
 * returns a piece of the state as it is.
 */
export const boardOf = (isMultiplayer: boolean) => (s: SessionState): BoardState =>
  isMultiplayer && s.online?.game ? s.online.game.board : s.board;

export const logOf = (isMultiplayer: boolean) => (s: SessionState): GameLog =>
  isMultiplayer && s.online?.game ? s.online.game.log : s.log;

/** The moves the side to move may make (App.tsx: `legalMoves`). */
export const legalMovesOf = (isMultiplayer: boolean) => (s: SessionState): Move[] =>
  (isMultiplayer && s.online?.game ? s.online.game.legal : s.legal) as Move[];

export const lastMoveOf = (isMultiplayer: boolean) => (s: SessionState): LastMove | null =>
  isMultiplayer && s.online?.game ? s.online.game.lastMove : s.lastMove;

// The roulette turn as App reads it (App.tsx: rouletteReveal and the
// aliases after it). While a bag lands it is not the bag yet: online it
// is held back (no slots) until the reveal ends, as App does.

/** The roulette turn's used slots when no bag is spun: one array, so a
 *  hook or component that depends on it sees no change while nothing changes. */
export const NO_SLOTS: number[] = [];

export const modeOf = (isMultiplayer: boolean) => (s: SessionState): GameMode =>
  isMultiplayer && s.online?.game ? s.online.game.mode : s.mode;

export const rouletteRevealOf = (isMultiplayer: boolean) => (s: SessionState): RouletteReveal | null =>
  isMultiplayer ? s.online?.reveal ?? null : s.roulette.reveal;

export const allowedPieceTypesOf = (isMultiplayer: boolean) => (s: SessionState): PieceType[] | null => {
  const online = isMultiplayer ? s.online?.game ?? null : null;
  const reveal = rouletteRevealOf(isMultiplayer)(s);
  return (online ? (reveal ? null : online.slots) : s.roulette.bag?.slots ?? null) as PieceType[] | null;
};

export const isRouletteSpinningOf = (isMultiplayer: boolean) => (s: SessionState): boolean =>
  rouletteRevealOf(isMultiplayer)(s) !== null || s.phase.tag === 'rouletteSpin';

export const rouletteActionsLeftOf = (isMultiplayer: boolean) => (s: SessionState): number =>
  isMultiplayer && s.online?.game ? s.online.game.actionsLeft : s.roulette.bag?.actionsLeft ?? 0;

export const usedRouletteSlotsOf = (isMultiplayer: boolean) => (s: SessionState): number[] =>
  (isMultiplayer && s.online?.game ? s.online.game.used : s.roulette.bag?.used ?? NO_SLOTS) as number[];

/** The first spin of the game is the player's click; later ones are auto. */
export const firstRouletteSpinDoneOf = (isMultiplayer: boolean) => (s: SessionState): boolean =>
  isMultiplayer && s.online?.game ? s.online.game.firstSpinDone : s.roulette.firstSpinDone;

/** statusOf (session/step.ts), read off the phase here: the components that
 *  show the status import this module, not step.ts; an import of step.ts from
 *  them split recording/log.ts into one more first-load file (log.js, 531a987). */
export const gameStatusOf = (s: SessionState): GameStatus => (s.phase.tag === 'ended' ? s.phase.status : 'active');
