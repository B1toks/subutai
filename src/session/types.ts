import type { BoardState, Color, Move, PieceType, SquareId } from '../engine';
import type { GameLog } from '../recording/log';
import type { MoveAnalysis } from '../analysis/classify';
import type { DrawTable } from '../utils/drawOffer';
import type { GameMode, GameStatus } from '../shared/game';
import type { MatchDoc } from '../firebase/matches';
import type { OnlineState } from './online';

// The game on the board as one value. Everything a solo or hot-seat game
// knows about itself lives here; who is clicking, what is lit up and what
// is animating does not. step() is the only thing that makes a new one.

export type TerminalStatus = Exclude<GameStatus, 'active'>;

/**
 * Who made a move: a player at this device, the bot, Twitch chat — or
 * nobody now: 'replay' is a move shown again because a game was put on the
 * board (a replay frame). Only the board's sound and effects react to a
 * replayed move; whatever counts or records play ignores it. 'remote' is
 * a move of an online match, read off its match document (either side's:
 * mine too comes back from it).
 */
export type Actor = 'human' | 'bot' | 'chat' | 'replay' | 'remote';

export interface LastMove {
  readonly from?: SquareId;
  readonly to?: SquareId;
}

/** Roulette: the spun bag of the side to move and what is left of it. */
export interface RouletteBag {
  readonly slots: readonly PieceType[];
  /** Indexes into `slots` already spent this turn. */
  readonly used: readonly number[];
  readonly actionsLeft: number;
}

/**
 * Roulette: a bag landing on the panel, one slot every 400 ms (v1.1.6).
 * The roll is made when the wheel starts; while it lands nobody may act
 * (no turn opens, players/turns.ts) and the bag is not the side's yet.
 * session/reveal.ts times it: a 'spinSlot' per slot, then 'spinLand'.
 * `of`: whose spin it is, which decides what landing does with the bag
 * ('online': a fresh bag of the match document, landing only shows it).
 */
export interface RouletteReveal {
  readonly since: number;
  readonly slots: readonly PieceType[];
  /** Slots landed so far. */
  readonly shown: number;
  readonly of: 'spin' | 'botSpin' | 'online';
}

export interface RouletteState {
  /** null until the side to move has spun this turn. */
  readonly bag: RouletteBag | null;
  /** The spin landing now (the session's own game), if any. */
  readonly reveal: RouletteReveal | null;
  /** Spins this game, both sides: the first three favour pawns. */
  readonly spins: number;
  /** The first spin of a game is a click; after it the spins run by themselves. */
  readonly firstSpinDone: boolean;
}

/**
 * Where the game stands. One tag at a time, so a promotion cannot be
 * pending in a game that has ended, and a wheel cannot be turning while
 * a pawn waits for its piece.
 *
 * A standing draw offer is not a phase: while it stands the other side
 * may still move (which retires it), spin, or pick a promotion piece, so
 * it sits beside the phase in `draw`.
 */
export type Phase =
  /** A fresh board: nothing played, nothing spun. */
  | { readonly tag: 'setup' }
  | { readonly tag: 'playing' }
  /** A pawn reached the far row; the mover is choosing its piece. */
  | { readonly tag: 'promotion'; readonly from: SquareId; readonly to: SquareId }
  /** Roulette: the side to move's wheel is turning. */
  | { readonly tag: 'rouletteSpin'; readonly since: number }
  | { readonly tag: 'ended'; readonly status: TerminalStatus };

export interface SessionState {
  readonly mode: GameMode;
  /** The Chess960 seed of the position (also the log's randomSeed). */
  readonly seed: number;
  readonly initial: BoardState;
  readonly board: BoardState;
  /**
   * The moves the side to move may make, as the board highlights them:
   * every legal move, or in Roulette after a spin only those the bag
   * allows. Kept, not derived, because the game updates it at exactly the
   * moments it always has (a mode switch, for one, leaves it alone).
   */
  readonly legal: readonly Move[];
  readonly log: GameLog;
  readonly lastMove: LastMove | null;
  readonly phase: Phase;
  readonly roulette: RouletteState;
  /**
   * Hot-seat draw offers (src/utils/drawOffer.ts), keyed by the game they
   * belong to: a table for another log id reads as no offers at all (see
   * drawTableOf), and comes back if that game is put back on the board.
   */
  readonly draw: { readonly logId: string; readonly table: DrawTable<Color> };
  /** Thinking time each side has used, in ms. Starts with the first move. */
  readonly clock: { readonly white: number; readonly black: number };
  /** Solo time control in seconds, or null for free play. */
  readonly timeControlSec: number | null;
  /** The chance stream (see rng.ts). */
  readonly rng: number;
  /**
   * The online match on the board, if one is (session/online.ts): its
   * document as last read, and the game it makes here. It sits beside the
   * solo game, which it leaves as it was: the board shows this one while
   * it is set, and the solo game again once it is gone.
   */
  readonly online: OnlineState | null;
}

/** A board and the history that leads to it, put on the table whole. */
export interface LoadedGame {
  readonly board: BoardState;
  readonly log: GameLog;
  /** Defaults to the current one (a replay seek keeps the start). */
  readonly initial?: BoardState;
  readonly seed?: number;
  /** Defaults to 'active'. */
  readonly status?: GameStatus;
  readonly lastMove?: LastMove | null;
  /** Defaults to every legal move of `board` under the current mode. */
  readonly legal?: readonly Move[];
}

export type Action =
  /** New game (New game, a 960 code). `seed` names the position and the
   *  log; without it the log is named after `now` and the seed is kept. */
  | { readonly type: 'newGame'; readonly initial: BoardState; readonly now: number; readonly seed?: number }
  /** Put a game on the board: a replay frame, a restored backup, an
   *  imported log, a Memory resume. `fresh` also clears the last game's
   *  Roulette turn, as starting a new game does; `settle` then checks
   *  whether the loaded board is already over. `replayStep` marks a
   *  watched replay moving one move on: that move plays out as events
   *  (actor 'replay'); no other load makes any. */
  | {
      readonly type: 'load';
      readonly game: LoadedGame;
      readonly fresh?: boolean;
      readonly settle?: { readonly lastWasRotation: boolean };
      readonly replayStep?: boolean;
    }
  | { readonly type: 'setMode'; readonly mode: GameMode }
  | { readonly type: 'setTimeControl'; readonly sec: number | null }
  /** `dt` ms of thinking time for the side to move. */
  | { readonly type: 'clockTick'; readonly dt: number }
  | { readonly type: 'flag'; readonly side: Color }
  /** A move from the legal list. `settle: false` leaves the end-of-game
   *  check to a later 'settle' (the bot checks after its move is
   *  classified, as it always has). */
  | { readonly type: 'move'; readonly move: Move; readonly actor: Actor; readonly now: number; readonly settle?: boolean }
  | { readonly type: 'rotate'; readonly actor: Actor; readonly now: number }
  /** Roulette: the bot found nothing to do with its bag. */
  | { readonly type: 'pass' }
  /** Is `board` (the one a move produced) over? Only ends an active game,
   *  and only the game the move was played in (`logId`) while that move is
   *  still its last (`plies`, the log's length after it): a verdict that
   *  comes after a new game, a Load replay or Watch changes nothing. */
  | {
      readonly type: 'settle';
      readonly board: BoardState;
      readonly lastWasRotation: boolean;
      readonly logId: string;
      readonly plies: number;
    }
  | { readonly type: 'requestPromotion'; readonly from: SquareId; readonly to: SquareId }
  | { readonly type: 'cancelPromotion' }
  /** The promotion piece, picked at this device. */
  | { readonly type: 'promote'; readonly piece: PieceType; readonly now: number }
  /** Roulette: the wheel starts and the bag is drawn; it lands slot by
   *  slot (RouletteReveal). `manual` is the Spin button (first spin). */
  | { readonly type: 'spinStart'; readonly now: number; readonly manual: boolean }
  /** Roulette: the bot's spin, landing the same way. */
  | { readonly type: 'botSpin'; readonly now: number }
  /** Roulette: the next slot of the reveal begun at `since` lands. */
  | { readonly type: 'spinSlot'; readonly since: number }
  /** Roulette: the reveal begun at `since` has landed whole: the bag is
   *  the side's (or a spin with nothing to do passes the turn). */
  | { readonly type: 'spinLand'; readonly since: number }
  | { readonly type: 'resign'; readonly side: Color }
  | { readonly type: 'offerDraw'; readonly side: Color }
  | { readonly type: 'answerDraw'; readonly side: Color; readonly accept: boolean }
  /** The classifier's verdict on move `index` (of game `logId`, if given). */
  | { readonly type: 'analysis'; readonly index: number; readonly analysis: MoveAnalysis; readonly logId?: string }
  /** Self-play: a search score for the last move. */
  | { readonly type: 'searchScore'; readonly scoreFromWhite: number }
  /** The online match's document as just read (null: no match on the
   *  board any more), for the player `myUid` here; `now` stamps it. */
  | { readonly type: 'follow'; readonly doc: MatchDoc | null; readonly myUid: string | null; readonly now: number };

/** What happened, for whoever wants to react to it (sound, effects, saves). */
export type SessionEvent =
  | { readonly type: 'move'; readonly move: Move; readonly san: string; readonly by: Color; readonly actor: Actor; readonly index: number }
  | { readonly type: 'capture'; readonly square: SquareId; readonly piece: PieceType; readonly enPassant: boolean }
  | { readonly type: 'check'; readonly side: Color }
  | { readonly type: 'rotation'; readonly by: Color; readonly promoted: readonly SquareId[] }
  | { readonly type: 'promotion'; readonly square: SquareId; readonly piece: PieceType }
  | { readonly type: 'rouletteSpin'; readonly by: Color; readonly slots: readonly PieceType[] | null }
  /** A slot of a reveal has landed (the "bam"); `last`: the fourth. */
  | { readonly type: 'rouletteSlot'; readonly index: number; readonly last: boolean }
  | { readonly type: 'drawOffer'; readonly by: Color; readonly answer?: 'accepted' | 'declined' }
  | { readonly type: 'gameEnd'; readonly status: TerminalStatus }
  | { readonly type: 'flagFall'; readonly side: Color };

export interface StepResult {
  readonly state: SessionState;
  readonly events: readonly SessionEvent[];
}
