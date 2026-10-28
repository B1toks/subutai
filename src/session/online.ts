import type { BoardState, Move, PieceType } from '../engine';
import { generateLegalMoves } from '../engine/moves';
import type { MatchDoc } from '../firebase/matches';
import type { GameLog } from '../recording/log';
import type { GameMode } from '../shared/game';
import { deriveMpLastMove, deriveMpLog, rebuildBoardFromMatch } from '../features/online/matchLog';
import type { LastMove, RouletteReveal } from './types';

/**
 * An online match as the board shows it, read off its match document for
 * the player at this device. The document is the game (the opponent's
 * moves arrive in it, and so do mine once written); this is what the
 * board, the log and the Roulette strip make of it.
 */
export interface OnlineGame {
  /** The board the match's log makes (rebuildBoardFromMatch). */
  readonly base: BoardState;
  /** `base`, with my colour to move while my Roulette turn has actions
   *  left: the log's last entry hands the move over after every action,
   *  the match does not until the turn ends. */
  readonly board: BoardState;
  readonly log: GameLog;
  readonly legal: readonly Move[];
  readonly lastMove: LastMove | null;
  readonly mode: GameMode;
  /** Roulette, as the match document holds it; classic: none. */
  readonly slots: readonly PieceType[] | null;
  readonly actionsLeft: number;
  readonly used: readonly number[];
  /** Have I spun in this match yet (the first spin is a click). */
  readonly firstSpinDone: boolean;
}

/** The match on the board: its document, whose it is here, and the game
 *  it makes for them (none until someone is signed in). */
export interface OnlineState {
  readonly doc: MatchDoc;
  readonly myUid: string | null;
  readonly game: OnlineGame | null;
  /** A fresh bag of the document landing on both screens (v1.1.6): set
   *  when the bag goes from none to one, then timed like a solo spin. */
  readonly reveal: RouletteReveal | null;
}

const NO_USED: readonly number[] = [];

/** `doc` as the board shows it to `myUid`. `now` stamps the log. */
export function gameOfMatch(doc: MatchDoc, myUid: string, now: number): OnlineGame {
  const base = rebuildBoardFromMatch(doc);
  const isMyTurn = doc.status === 'active' && doc.currentTurn === myUid;
  const myColor = doc.host.uid === myUid ? doc.host.color : doc.guest?.color ?? 'white';
  const roulette = doc.gameMode === 'roulette';
  const actionsLeft = roulette ? doc.rouletteActionsLeft ?? 0 : 0;
  // Q.D.3: in MP roulette an action mid-turn flips boardState.sideToMove
  // (the engine doesn't know we're keeping the same player on the clock
  // for a second action); clamped here so the legal moves are MY pieces'
  // for action 2 instead of the opponent's.
  const board =
    roulette && isMyTurn && actionsLeft > 0 && base.sideToMove !== myColor
      ? { ...base, sideToMove: myColor }
      : base;
  return {
    base,
    board,
    log: deriveMpLog(doc, now),
    legal: generateLegalMoves(board, { allowSelfCheck: roulette }),
    lastMove: deriveMpLastMove(doc),
    mode: roulette ? 'roulette' : 'classic',
    slots: roulette ? doc.rouletteSlots ?? null : null,
    actionsLeft,
    used: roulette ? doc.usedRouletteSlots ?? NO_USED : NO_USED,
    firstSpinDone: (doc.rouletteSpinsByPlayer?.[myUid] ?? 0) > 0,
  };
}
