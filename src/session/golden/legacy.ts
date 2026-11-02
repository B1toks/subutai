/**
 * The game as App played it before the session existed, frozen for the
 * golden tests: each method is a handler of src/App.tsx at 0f41ac3 (or of
 * the hook it had moved into), with React's state replaced by plain
 * fields. Reads go through `r` — the render the handler ran in — and
 * writes through setters that queue updaters, exactly like useState: a
 * handler never sees its own writes, and `prev =>` updaters run in order.
 *
 * Do not "fix" anything here. It is the reference step() is held to; a
 * difference between the two is either a step() bug or a deliberate
 * change that has to be argued for.
 *
 * Math.random became a parameter (`random`) so both sides of a test can
 * draw the same spins. Date.now() became `now`. Nothing else changed.
 *
 * Where step() deliberately differs (the tests compare around these):
 *   · a game that ends (resign, flag) while the Roulette wheel turns stays
 *     ended: the old 2300 ms timeout still drew a bag onto the finished
 *     board;
 *   · a promotion picker open when the game ends closes (its pick used to
 *     play a move after the end);
 *   · after a game has ended, the bot's king-capture branch no longer
 *     leaves the previous legal list behind (nothing reads it then).
 */
import type { BoardState, Color, Move, PieceType, SquareId } from '../../engine';
import { applyMove, findKing, generateLegalMoves, isSquareAttacked } from '../../engine/moves';
import { applyPassMove, applyRotationMove, toggleTopology } from '../../engine/auxetic';
import {
  appendMove,
  attachSearchScoreToLastMove,
  computeSAN,
  createGameLog,
  updateMoveAnalysisAt,
  type GameLog,
} from '../../recording/log';
import type { MoveAnalysis } from '../../analysis/classify';
import {
  ROULETTE_MAX_ACTIONS,
  consumeSlotIndex,
  getActivePieceTypes,
  isPieceMovableInRoulette,
  spinRoulette,
} from '../../features/game/roulette';
import { gameEnding } from '../../features/game/position';
import {
  NO_DRAW_OFFERS,
  canAnswerDraw,
  canOfferDraw,
  declineDraw,
  drawTableAfterMove,
  offerDraw,
  type DrawTable,
} from '../../utils/drawOffer';
import type { GameMode, GameStatus } from '../../shared/game';

export interface LegacyWorld {
  seed: number;
  stateLocal: BoardState;
  initialState: BoardState;
  legalMovesLocal: Move[];
  logLocal: GameLog;
  gameStatus: GameStatus;
  lastMoveLocal: { from?: SquareId; to?: SquareId } | null;
  pendingPromotion: { from: SquareId; to: SquareId } | null;
  gameModeLocal: GameMode;
  allowedPieceTypesLocal: PieceType[] | null;
  isRouletteSpinning: boolean;
  rouletteActionsLeftLocal: number;
  usedRouletteSlotsLocal: number[];
  firstRouletteSpinDoneLocal: boolean;
  rouletteSpinCountLocal: number;
  localDraw: { logId: string; table: DrawTable<Color> };
  clockMs: { white: number; black: number };
  soloTcSec: number | null;
}

type Updater<T> = T | ((prev: T) => T);

export class LegacyApp {
  w: LegacyWorld;
  private queue: Array<() => void> = [];

  constructor(world: LegacyWorld) {
    this.w = world;
  }

  /** Runs a handler against one render, then commits its writes in order
   *  (and the clock-reset effects useGameClocks runs after the commit). */
  act(handler: (r: Readonly<LegacyWorld>) => void): void {
    const r = { ...this.w };
    handler(r);
    for (const q of this.queue) q();
    this.queue = [];
    // useGameClocks: a new log id zeroes the clocks.
    if (this.w.logLocal.id !== r.logLocal.id) this.w.clockMs = { white: 0, black: 0 };
    // ...and so does a time control picked before the first move.
    if (this.w.soloTcSec !== r.soloTcSec && this.w.logLocal.moves.length === 0) {
      this.w.clockMs = { white: 0, black: 0 };
    }
  }

  private set<K extends keyof LegacyWorld>(key: K, v: Updater<LegacyWorld[K]>): void {
    this.queue.push(() => {
      this.w[key] =
        typeof v === 'function' ? (v as (p: LegacyWorld[K]) => LegacyWorld[K])(this.w[key]) : v;
    });
  }

  // ── helpers App defined per render ────────────────────────────────

  private getLegalMoves(r: LegacyWorld, s: BoardState): Move[] {
    return generateLegalMoves(s, { allowSelfCheck: r.gameModeLocal === 'roulette' });
  }

  private playableRouletteMoves(r: LegacyWorld, boardState: BoardState, allowed: PieceType[], used: number[]): Move[] {
    return this.getLegalMoves(r, boardState).filter((m) => {
      if (!m.from) return false;
      const p = boardState.pieces[m.from];
      if (!p) return false;
      return isPieceMovableInRoulette(p.type, boardState, 'roulette', allowed, used);
    });
  }

  private endGameWith(status: Exclude<GameStatus, 'active'>) {
    this.set('gameStatus', (prev) => (prev === 'active' ? status : prev));
  }

  private checkGameOver(r: LegacyWorld, nextState: BoardState, lastMoveWasRotation = false) {
    const ending = gameEnding(r.gameModeLocal, nextState, lastMoveWasRotation);
    if (ending) this.endGameWith(ending);
  }

  private noteDrawMove(r: LegacyWorld, mover: Color) {
    this.set('localDraw', (prev) =>
      prev.logId === r.logLocal.id ? { ...prev, table: drawTableAfterMove(prev.table, mover) } : prev,
    );
  }

  private localDrawTable(r: LegacyWorld): DrawTable<Color> {
    return r.localDraw.logId === r.logLocal.id ? r.localDraw.table : NO_DRAW_OFFERS;
  }

  private resetGameEndState() {
    this.set('allowedPieceTypesLocal', null);
    this.set('isRouletteSpinning', false);
    this.set('rouletteActionsLeftLocal', 0);
    this.set('usedRouletteSlotsLocal', []);
    this.set('firstRouletteSpinDoneLocal', false);
    this.set('rouletteSpinCountLocal', 0);
  }

  // ── handlers ──────────────────────────────────────────────────────

  /** startNewGame (formation unlocked). */
  startNewGame(initial: BoardState, now: number) {
    this.act((r) => {
      const newSeed = now;
      this.set('seed', newSeed);
      this.set('stateLocal', initial);
      this.set('initialState', initial);
      this.set('legalMovesLocal', this.getLegalMoves(r, initial));
      this.set('logLocal', createGameLog(`game-${newSeed}`, initial, newSeed, now));
      this.set('gameStatus', 'active');
      this.set('lastMoveLocal', null);
      this.resetGameEndState();
    });
  }

  /** The mode cards (disabled={modeToggleLocked}, so a locked click never lands).
   *  v1.1.7: a click while a bag lands cancels it with its timers
   *  (cancelRouletteReveal); v1.1.6 landed it after the switch. */
  setMode(mode: GameMode) {
    this.act((r) => {
      if (r.logLocal.moves.length > 0 || r.stateLocal.fullmoveNumber > 1) return;
      if (r.gameModeLocal === mode) return;
      this.set('gameModeLocal', mode);
      this.set('allowedPieceTypesLocal', null);
      this.pendingSpin = null;
      this.set('isRouletteSpinning', false);
      this.set('rouletteActionsLeftLocal', 0);
      this.set('usedRouletteSlotsLocal', []);
    });
  }

  setTimeControl(sec: number | null) {
    this.act(() => this.set('soloTcSec', sec));
  }

  /** useGameClocks' interval (gameStatus active, armed by the first move). */
  clockTick(dt: number) {
    this.act((r) => {
      if (r.gameStatus !== 'active' || r.logLocal.moves.length === 0) return;
      const side = r.stateLocal.sideToMove;
      this.set('clockMs', (c) => ({ ...c, [side]: c[side] + dt }));
    });
  }

  /** useSoloFlagFall: the side whose time is gone, or null. */
  flaggedSide(): Color | null {
    const r = this.w;
    if (r.soloTcSec === null) return null;
    if (r.gameStatus !== 'active' || r.logLocal.moves.length === 0) return null;
    const tc = r.soloTcSec;
    return (['white', 'black'] as const).find((side) => tc * 1000 - r.clockMs[side] <= 0) ?? null;
  }

  flag(side: Color) {
    this.act(() => this.set('gameStatus', side === 'white' ? 'timeout_white' : 'timeout_black'));
  }

  /**
   * onSquareClick, from the second click on (`selected` → `square`), solo.
   * Returns false where the handler bailed out before a move.
   */
  clickMove(selected: SquareId, square: SquareId, now: number): boolean {
    let moved = false;
    this.act((r) => {
      const state = r.stateLocal;
      const gameMode = r.gameModeLocal;
      if (r.gameStatus !== 'active') return;
      if (gameMode === 'roulette' && r.allowedPieceTypesLocal === null) return;
      if (gameMode === 'roulette' && r.rouletteActionsLeftLocal <= 0) return;
      const activeMoves: Move[] =
        gameMode === 'roulette'
          ? this.getLegalMoves(r, state).filter((m) => {
              if (!m.from) return false;
              const p = state.pieces[m.from];
              if (!p) return false;
              return isPieceMovableInRoulette(p.type, state, gameMode, r.allowedPieceTypesLocal, r.usedRouletteSlotsLocal);
            })
          : r.legalMovesLocal;
      let move = activeMoves.find((m) => m.from === selected && m.to === square);
      if (!move) {
        move = activeMoves.find((m) => m.from === selected && m.kind === 'castle' && m.castleRookFrom === square);
      }
      if (!move) return;
      if (move.kind === 'promotion' && move.from && move.to && gameMode !== 'roulette') {
        this.set('pendingPromotion', { from: move.from, to: move.to });
        moved = true;
        return;
      }
      const resolvedMove: Move =
        gameMode === 'roulette' && move.kind === 'promotion' && !move.promotion
          ? { ...move, promotion: 'queen' }
          : move;
      this.commitMove(r, resolvedMove, now);
      moved = true;
    });
    return moved;
  }

  private commitMove(r: LegacyWorld, resolvedMove: Move, now: number) {
    const state = r.stateLocal;
    const gameMode = r.gameModeLocal;
    const san = computeSAN(state, resolvedMove);
    const moverType = state.pieces[resolvedMove.from!]!.type;
    const afterMove = applyMove(state, resolvedMove);
    this.set('logLocal', (prev) => appendMove(prev, resolvedMove, san, state.topologyState, undefined, now));
    this.noteDrawMove(r, state.sideToMove);
    this.set('lastMoveLocal', { from: resolvedMove.from, to: resolvedMove.to });

    if (gameMode !== 'roulette') {
      this.set('stateLocal', afterMove);
      this.set('legalMovesLocal', this.getLegalMoves(r, afterMove));
      this.checkGameOver(r, afterMove);
      return;
    }

    const allowed = r.allowedPieceTypesLocal!;
    const slotIdx = consumeSlotIndex(allowed, r.usedRouletteSlotsLocal, moverType);
    const newUsed = slotIdx >= 0 ? [...r.usedRouletteSlotsLocal, slotIdx] : r.usedRouletteSlotsLocal;
    const actionsAfter = r.rouletteActionsLeftLocal - 1;
    const kingCaptured = !findKing(afterMove, 'white') || !findKing(afterMove, 'black');

    let stayOnTurn = false;
    let nextPlayable: Move[] = [];
    if (!kingCaptured && actionsAfter > 0) {
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      nextPlayable = this.playableRouletteMoves(r, clamped, allowed, newUsed);
      stayOnTurn = nextPlayable.length > 0 || !clamped.lastMoveWasRotation;
    }

    if (stayOnTurn) {
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      this.set('stateLocal', clamped);
      this.set('usedRouletteSlotsLocal', newUsed);
      this.set('rouletteActionsLeftLocal', actionsAfter);
      this.set('legalMovesLocal', nextPlayable);
    } else {
      this.set('stateLocal', afterMove);
      this.set('usedRouletteSlotsLocal', []);
      this.set('rouletteActionsLeftLocal', 0);
      this.set('allowedPieceTypesLocal', null);
      this.set('legalMovesLocal', this.getLegalMoves(r, afterMove));
    }
    this.checkGameOver(r, afterMove);
  }

  /** handlePromotion (solo). */
  promote(pieceType: PieceType, now: number) {
    this.act((r) => {
      const pending = r.pendingPromotion;
      if (!pending) return;
      const state = r.stateLocal;
      const move = r.legalMovesLocal.find(
        (m) => m.from === pending.from && m.to === pending.to && m.kind === 'promotion' && m.promotion === pieceType,
      );
      if (!move) return;
      const san = computeSAN(state, move);
      const next = applyMove(state, move);
      this.set('stateLocal', next);
      this.set('legalMovesLocal', this.getLegalMoves(r, next));
      this.set('pendingPromotion', null);
      this.set('logLocal', (prev) => appendMove(prev, move, san, state.topologyState, undefined, now));
      this.noteDrawMove(r, state.sideToMove);
      this.set('lastMoveLocal', { from: move.from, to: move.to });
      this.checkGameOver(r, next);
    });
  }

  cancelPromotion() {
    this.act(() => this.set('pendingPromotion', null));
  }

  /** handleRotate (solo; currentPlayer is the human). */
  rotate(now: number) {
    this.act((r) => {
      const state = r.stateLocal;
      if (state.lastMoveWasRotation) return;
      if (r.gameStatus !== 'active') return;
      const toggled = toggleTopology(state);
      if (r.gameModeLocal !== 'roulette') {
        const ourKing = findKing(toggled, state.sideToMove);
        if (!ourKing) return;
        const opponent = state.sideToMove === 'white' ? 'black' : 'white';
        if (isSquareAttacked(toggled, ourKing, opponent, toggled.topologyState)) return;
        const next = applyRotationMove(state);
        this.set('stateLocal', next);
        this.set('legalMovesLocal', this.getLegalMoves(r, next));
        const toggleMove: Move = { kind: 'topologyToggle' };
        const toggleSan = computeSAN(state, toggleMove);
        this.set('logLocal', (prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState, undefined, now));
        this.noteDrawMove(r, state.sideToMove);
        this.set('lastMoveLocal', null);
        this.checkGameOver(r, next, true);
        return;
      }
      if (r.allowedPieceTypesLocal === null || r.rouletteActionsLeftLocal < 1) return;
      const rotated = applyRotationMove(state);
      const toggleMove: Move = { kind: 'topologyToggle' };
      const toggleSan = computeSAN(state, toggleMove);
      this.set('logLocal', (prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState, undefined, now));
      this.noteDrawMove(r, state.sideToMove);
      this.set('lastMoveLocal', null);
      const actionsAfter = r.rouletteActionsLeftLocal - 1;
      if (actionsAfter === 0) {
        this.set('stateLocal', rotated);
        this.set('allowedPieceTypesLocal', null);
        this.set('isRouletteSpinning', false);
        this.set('rouletteActionsLeftLocal', 0);
        this.set('usedRouletteSlotsLocal', []);
        this.set('legalMovesLocal', this.getLegalMoves(r, rotated));
        this.checkGameOver(r, rotated, true);
        return;
      }
      const clamped: BoardState = { ...rotated, sideToMove: state.sideToMove };
      const nextPlayable = this.playableRouletteMoves(r, clamped, r.allowedPieceTypesLocal, r.usedRouletteSlotsLocal);
      if (nextPlayable.length === 0) {
        this.set('stateLocal', rotated);
        this.set('allowedPieceTypesLocal', null);
        this.set('isRouletteSpinning', false);
        this.set('rouletteActionsLeftLocal', 0);
        this.set('usedRouletteSlotsLocal', []);
        this.set('legalMovesLocal', this.getLegalMoves(r, rotated));
        this.checkGameOver(r, rotated, true);
        return;
      }
      this.set('stateLocal', clamped);
      this.set('rouletteActionsLeftLocal', actionsAfter);
      this.set('legalMovesLocal', nextPlayable);
      this.checkGameOver(r, clamped, true);
    });
  }

  /** v1.1.6 doSpinRouletteNow / startRouletteReveal: the bag a spin is
   *  landing, made when the wheel starts; applyAiSpin's too. */
  private pendingSpin: { rolled: PieceType[]; of: 'spin' | 'botSpin' } | null = null;

  /** handleSpinRoulette (manual) or the auto-spin effect: the wheel starts
   *  and the roll is made (v1.1.6), from the pieces the side has. */
  spinStart(manual: boolean, random: () => number) {
    this.act((r) => {
      if (manual) {
        if (r.gameModeLocal !== 'roulette') return;
        if (r.gameStatus !== 'active') return;
        if (r.allowedPieceTypesLocal !== null) return;
        if (!r.firstRouletteSpinDoneLocal) this.set('firstRouletteSpinDoneLocal', true);
      }
      const state = r.stateLocal;
      const activeTypes = getActivePieceTypes(state, state.sideToMove);
      const pawnBoost = r.rouletteSpinCountLocal < 3;
      this.pendingSpin = { rolled: spinRoulette(activeTypes, pawnBoost, random), of: 'spin' };
      this.set('isRouletteSpinning', true);
    });
  }

  /** useBotScheduler.applyAiSpin (v1.1.6): the bot's roll, landing the same way. */
  botSpin(random: () => number) {
    this.act((r) => {
      const bs = r.stateLocal;
      const activeTypes = getActivePieceTypes(bs, bs.sideToMove);
      const pawnBoost = r.rouletteSpinCountLocal < 3;
      this.pendingSpin = { rolled: spinRoulette(activeTypes, pawnBoost, random), of: 'botSpin' };
      this.set('isRouletteSpinning', true);
    });
  }

  /** startRouletteReveal's last timer: the bag has landed. The player's
   *  spin passes when nothing can be done; the bot's bag is kept. */
  spinLand() {
    this.act((r) => {
      const pending = this.pendingSpin;
      if (!pending) return;
      this.pendingSpin = null;
      const state = r.stateLocal;
      const rolled = pending.rolled;
      this.set('rouletteSpinCountLocal', (n) => n + 1);
      const playable = this.playableRouletteMoves(r, state, rolled, []);
      if (pending.of === 'spin' && playable.length === 0 && state.lastMoveWasRotation) {
        const next = applyPassMove(state);
        this.set('stateLocal', next);
        this.set('allowedPieceTypesLocal', null);
        this.set('isRouletteSpinning', false);
        this.set('lastMoveLocal', null);
        this.set('legalMovesLocal', this.getLegalMoves(r, next));
        this.set('rouletteActionsLeftLocal', 0);
        this.set('usedRouletteSlotsLocal', []);
      } else {
        this.set('allowedPieceTypesLocal', rolled);
        this.set('isRouletteSpinning', false);
        this.set('rouletteActionsLeftLocal', ROULETTE_MAX_ACTIONS);
        this.set('usedRouletteSlotsLocal', []);
        this.set('legalMovesLocal', playable);
      }
    });
  }

  /** executeAiRouletteAction with the bot's choice made: `choice` null
   *  is the no-playable branch (rotate if that opens moves, else pass). */
  botRouletteAction(choice: Move | null, now: number) {
    this.act((r) => {
      const bs = r.stateLocal;
      const rolled = r.allowedPieceTypesLocal!;
      const used = r.usedRouletteSlotsLocal;
      const actionsLeft = r.rouletteActionsLeftLocal;
      if (choice === null) {
        const canRotate = !bs.lastMoveWasRotation;
        if (canRotate) {
          const rotatedPreview = toggleTopology(bs);
          if (this.playableRouletteMoves(r, rotatedPreview, rolled, used).length > 0) {
            this.botRouletteRotation(r, bs, rolled, used, actionsLeft, now);
            return;
          }
        }
        const passed = applyPassMove(bs);
        this.set('stateLocal', passed);
        this.set('allowedPieceTypesLocal', null);
        this.set('usedRouletteSlotsLocal', []);
        this.set('rouletteActionsLeftLocal', 0);
        this.set('legalMovesLocal', this.getLegalMoves(r, passed));
        this.set('lastMoveLocal', null);
        return;
      }
      const mv: Move = choice.kind === 'promotion' && !choice.promotion ? { ...choice, promotion: 'queen' } : choice;
      const moverType = bs.pieces[mv.from!]!.type;
      const slotIdx = consumeSlotIndex(rolled, used, moverType);
      const newUsed = slotIdx >= 0 ? [...used, slotIdx] : used;
      const newActions = actionsLeft - 1;
      const san = computeSAN(bs, mv);
      const afterMove = applyMove(bs, mv);
      this.set('logLocal', (prev) => appendMove(prev, mv, san, bs.topologyState, undefined, now));
      this.set('lastMoveLocal', { from: mv.from, to: mv.to });
      const kingCaptured = !findKing(afterMove, 'white') || !findKing(afterMove, 'black');
      if (kingCaptured) {
        this.set('stateLocal', afterMove);
        this.set('allowedPieceTypesLocal', null);
        this.set('usedRouletteSlotsLocal', []);
        this.set('rouletteActionsLeftLocal', 0);
        this.checkGameOver(r, afterMove);
        return;
      }
      const noMoreActions = newActions <= 0;
      const clampedNext: BoardState = { ...afterMove, sideToMove: bs.sideToMove };
      const nextPlayable = noMoreActions ? [] : this.playableRouletteMoves(r, clampedNext, rolled, newUsed);
      const canContinue = nextPlayable.length > 0 || !clampedNext.lastMoveWasRotation;
      if (noMoreActions || !canContinue) {
        this.set('stateLocal', afterMove);
        this.set('allowedPieceTypesLocal', null);
        this.set('usedRouletteSlotsLocal', []);
        this.set('rouletteActionsLeftLocal', 0);
        this.set('legalMovesLocal', this.getLegalMoves(r, afterMove));
        return;
      }
      this.set('stateLocal', clampedNext);
      this.set('usedRouletteSlotsLocal', newUsed);
      this.set('rouletteActionsLeftLocal', newActions);
      this.set('legalMovesLocal', nextPlayable);
    });
  }

  private botRouletteRotation(r: LegacyWorld, bs: BoardState, rolled: PieceType[], used: number[], actionsLeft: number, now: number) {
    const rotated = applyRotationMove(bs);
    const toggleMove: Move = { kind: 'topologyToggle' };
    const san = computeSAN(bs, toggleMove);
    this.set('logLocal', (prev) => appendMove(prev, toggleMove, san, bs.topologyState, undefined, now));
    this.set('lastMoveLocal', null);
    const actionsAfter = actionsLeft - 1;
    if (actionsAfter === 0) {
      this.set('stateLocal', rotated);
      this.set('allowedPieceTypesLocal', null);
      this.set('usedRouletteSlotsLocal', []);
      this.set('rouletteActionsLeftLocal', 0);
      this.set('legalMovesLocal', this.getLegalMoves(r, rotated));
      return;
    }
    const clamped: BoardState = { ...rotated, sideToMove: bs.sideToMove };
    const nextPlayable = this.playableRouletteMoves(r, clamped, rolled, used);
    if (nextPlayable.length === 0) {
      this.set('stateLocal', rotated);
      this.set('allowedPieceTypesLocal', null);
      this.set('usedRouletteSlotsLocal', []);
      this.set('rouletteActionsLeftLocal', 0);
      this.set('legalMovesLocal', this.getLegalMoves(r, rotated));
      return;
    }
    this.set('stateLocal', clamped);
    this.set('rouletteActionsLeftLocal', actionsAfter);
    this.set('legalMovesLocal', nextPlayable);
  }

  /** scheduleAiMove's continuation, up to the classification await. */
  botMove(move: Move, now: number): { next: BoardState; rotation: boolean } {
    let result = { next: this.w.stateLocal, rotation: false };
    this.act((r) => {
      const boardState = r.stateLocal;
      const next = move.kind === 'topologyToggle' ? applyRotationMove(boardState) : applyMove(boardState, move);
      this.set('stateLocal', next);
      this.set('legalMovesLocal', this.getLegalMoves(r, next));
      const aiSan = computeSAN(boardState, move);
      this.set('logLocal', (prev) => appendMove(prev, move, aiSan, boardState.topologyState, undefined, now));
      this.set('lastMoveLocal', move.kind === 'topologyToggle' ? null : { from: move.from, to: move.to });
      result = { next, rotation: move.kind === 'topologyToggle' };
      // A rotation is not classified: its checkGameOver runs at once.
      if (move.kind === 'topologyToggle') this.checkGameOver(r, next, true);
    });
    return result;
  }

  /** ...and the checkGameOver after the classification resolved. */
  botSettle(next: BoardState, rotation: boolean) {
    this.act((r) => this.checkGameOver(r, next, rotation));
  }

  /** confirmResign (solo / hot-seat). */
  resign(side: Color) {
    this.act((r) => {
      if (r.gameStatus !== 'active') return;
      this.set('gameStatus', side === 'white' ? 'resigned_white' : 'resigned_black');
    });
  }

  offerDraw(side: Color) {
    this.act((r) => {
      if (r.gameStatus !== 'active') return;
      const table = this.localDrawTable(r);
      if (!canOfferDraw(table, side, r.logLocal.moves.length)) return;
      this.set('localDraw', { logId: r.logLocal.id, table: offerDraw(table, side, r.logLocal.moves.length) });
    });
  }

  answerDraw(side: Color, accept: boolean) {
    this.act((r) => {
      if (r.gameStatus !== 'active') return;
      const table = this.localDrawTable(r);
      if (!canAnswerDraw(table.offer, side, r.logLocal.moves.length)) return;
      if (!accept) {
        this.set('localDraw', { logId: r.logLocal.id, table: declineDraw(table, side, r.logLocal.moves.length) });
        return;
      }
      this.set('gameStatus', 'draw_agreement');
    });
  }

  /** useClassifier.commitAnalysis (non-superseded). */
  analysis(index: number, analysis: MoveAnalysis) {
    this.act(() => this.set('logLocal', (prev) => updateMoveAnalysisAt(prev, index, analysis)));
  }

  searchScore(score: number) {
    this.act(() => this.set('logLocal', (prev) => attachSearchScoreToLastMove(prev, score)));
  }

  /** importReplayFromNotation's state half. */
  loadImported(initial: BoardState, current: BoardState, log: GameLog, lastWasRotation: boolean) {
    this.act((r) => {
      this.set('initialState', initial);
      this.set('stateLocal', current);
      this.set('legalMovesLocal', this.getLegalMoves(r, current));
      this.set('logLocal', log);
      this.set('gameStatus', 'active');
      this.set('lastMoveLocal', null);
      this.resetGameEndState();
      this.checkGameOver(r, current, lastWasRotation);
    });
  }
}

/** The world App's first render starts in. */
export function legacyWorld(initial: BoardState, seed: number, now: number): LegacyWorld {
  return {
    seed,
    stateLocal: initial,
    initialState: initial,
    legalMovesLocal: generateLegalMoves(initial),
    logLocal: createGameLog(`game-${seed}`, initial, seed, now),
    gameStatus: 'active',
    lastMoveLocal: null,
    pendingPromotion: null,
    gameModeLocal: 'classic',
    allowedPieceTypesLocal: null,
    isRouletteSpinning: false,
    rouletteActionsLeftLocal: 0,
    usedRouletteSlotsLocal: [],
    firstRouletteSpinDoneLocal: false,
    rouletteSpinCountLocal: 0,
    localDraw: { logId: '', table: NO_DRAW_OFFERS },
    clockMs: { white: 0, black: 0 },
    soloTcSec: null,
  };
}
