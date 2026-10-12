import type { BoardState, Color, Move, SquareId } from '../engine';
import { applyMove, findKing, isInCheck } from '../engine/moves';
import { applyPassMove, applyRotationMove } from '../engine/auxetic';
import {
  appendMove,
  attachSearchScoreToLastMove,
  computeSAN,
  createGameLog,
  updateMoveAnalysisAt,
} from '../recording/log';
import {
  ROULETTE_MAX_ACTIONS,
  consumeSlotIndex,
  getActivePieceTypes,
  spinRoulette,
} from '../features/game/roulette';
import { gameEnding } from '../features/game/position';
import {
  NO_DRAW_OFFERS,
  canAnswerDraw,
  canOfferDraw,
  declineDraw,
  drawTableAfterMove,
  offerDraw,
  type DrawTable,
} from '../utils/drawOffer';
import type { GameMode, GameStatus } from '../shared/game';
import { rngCursor, rngFromSeed } from './rng';
import {
  legalMovesFor,
  otherColor,
  playableRouletteMoves,
  rotationKeepsKingSafe,
  sameMove,
} from './rules';
import type {
  Action,
  Phase,
  RouletteBag,
  SessionEvent,
  SessionState,
  StepResult,
  TerminalStatus,
} from './types';

// step(state, action, now-in-the-action) -> the next state and what
// happened. Pure: no clock but the `now` an action carries, no chance but
// the stream in state.rng, no React, no DOM. Each branch is the rule the
// game has always played by; the comments name the handler in App it
// came from, so the two can be read side by side in the history.
//
// An action that does not apply (a move that is not legal now, a spin
// while one is turning, anything after the end) returns the state
// unchanged, the same object, with no events.

const NO_ROULETTE = { bag: null, spins: 0, firstSpinDone: false } as const;
const ZERO_CLOCK = { white: 0, black: 0 } as const;

/** A session for a board nobody has touched. */
export function createSession(opts: {
  initial: BoardState;
  seed: number;
  now: number;
  mode?: GameMode;
  timeControlSec?: number | null;
}): SessionState {
  const mode = opts.mode ?? 'classic';
  const log = createGameLog(`game-${opts.seed}`, opts.initial, opts.seed, opts.now);
  return {
    mode,
    seed: opts.seed,
    initial: opts.initial,
    board: opts.initial,
    legal: legalMovesFor(mode, opts.initial),
    log,
    lastMove: null,
    phase: { tag: 'setup' },
    roulette: NO_ROULETTE,
    draw: { logId: '', table: NO_DRAW_OFFERS },
    clock: ZERO_CLOCK,
    timeControlSec: opts.timeControlSec ?? null,
    rng: rngFromSeed(opts.seed),
  };
}

/** 'active' until the game has ended, then how it ended. */
export function statusOf(s: SessionState): GameStatus {
  return s.phase.tag === 'ended' ? s.phase.status : 'active';
}

/** The draw offers of the game on the board. */
export function drawTableOf(s: SessionState): DrawTable<Color> {
  return s.draw.logId === s.log.id ? s.draw.table : NO_DRAW_OFFERS;
}

export function step(s: SessionState, a: Action): StepResult {
  const out = reduce(s, a);
  if (out.state === s) return out;
  // The clocks belong to a game: a different log starts them from zero.
  if (out.state.log.id !== s.log.id && (out.state.clock.white !== 0 || out.state.clock.black !== 0)) {
    return { state: { ...out.state, clock: ZERO_CLOCK }, events: out.events };
  }
  return out;
}

const SAME = (s: SessionState): StepResult => ({ state: s, events: [] });

function isLive(p: Phase): boolean {
  return p.tag === 'setup' || p.tag === 'playing';
}

function reduce(s: SessionState, a: Action): StepResult {
  switch (a.type) {
    case 'newGame': {
      // startNewGame / applyFormationCode (+ resetGameEndState).
      const logSeed = a.seed ?? a.now;
      return {
        state: {
          ...s,
          seed: a.seed ?? s.seed,
          initial: a.initial,
          board: a.initial,
          legal: legalMovesFor(s.mode, a.initial),
          log: createGameLog(`game-${logSeed}`, a.initial, logSeed, a.now),
          lastMove: null,
          phase: { tag: 'setup' },
          roulette: NO_ROULETTE,
          rng: rngFromSeed(logSeed),
        },
        events: [],
      };
    }

    case 'load': {
      // startWatching / seekWatchTo / stopWatching / importReplay /
      // resumeGame. `fresh` is resetGameEndState's Roulette half.
      const g = a.game;
      const roulette = a.fresh ? NO_ROULETTE : s.roulette;
      const status = g.status ?? 'active';
      const phase: Phase =
        status !== 'active'
          ? { tag: 'ended', status }
          : g.log.moves.length === 0 && roulette.bag === null
            ? { tag: 'setup' }
            : { tag: 'playing' };
      const loaded: SessionState = {
        ...s,
        seed: g.seed ?? s.seed,
        initial: g.initial ?? s.initial,
        board: g.board,
        legal: g.legal ?? legalMovesFor(s.mode, g.board),
        log: g.log,
        lastMove: g.lastMove ?? null,
        phase,
        roulette,
      };
      if (!a.settle) return { state: loaded, events: [] };
      return settle(loaded, [], g.board, a.settle.lastWasRotation);
    }

    case 'setMode': {
      // The mode cards: only before the first move (modeToggleLocked).
      if (a.mode === s.mode) return SAME(s);
      if (s.log.moves.length > 0 || s.board.fullmoveNumber > 1) return SAME(s);
      if (s.phase.tag === 'ended' || s.phase.tag === 'promotion') return SAME(s);
      return {
        state: {
          ...s,
          mode: a.mode,
          roulette: { ...s.roulette, bag: null },
          phase: s.phase.tag === 'rouletteSpin' ? afterTurnPhase(s) : s.phase,
        },
        events: [],
      };
    }

    case 'setTimeControl': {
      // A control picked before the first move zeroes what had run.
      if (a.sec === s.timeControlSec) return SAME(s);
      return {
        state: {
          ...s,
          timeControlSec: a.sec,
          clock: s.log.moves.length === 0 ? ZERO_CLOCK : s.clock,
        },
        events: [],
      };
    }

    case 'clockTick': {
      // useGameClocks: the side to move is charged, from the first move on.
      if (s.phase.tag === 'ended' || s.log.moves.length === 0) return SAME(s);
      const side = s.board.sideToMove;
      return {
        state: { ...s, clock: { ...s.clock, [side]: s.clock[side] + a.dt } },
        events: [],
      };
    }

    case 'flag': {
      // useSoloFlagFall decides the flag fell; this ends the game on it.
      if (s.phase.tag === 'ended') return SAME(s);
      const status: TerminalStatus = a.side === 'white' ? 'timeout_white' : 'timeout_black';
      return {
        state: { ...s, phase: { tag: 'ended', status } },
        events: [{ type: 'flagFall', side: a.side }, { type: 'gameEnd', status }],
      };
    }

    case 'move': {
      if (a.move.kind === 'topologyToggle') return rotate(s, a.now);
      if (!isLive(s.phase)) return SAME(s);
      if (!s.legal.some((m) => sameMove(m, a.move))) return SAME(s);
      return s.mode === 'roulette'
        ? rouletteMove(s, a.move, a.now)
        : classicMove(s, a.move, a.now, a.settle !== false);
    }

    case 'rotate':
      return rotate(s, a.now);

    case 'pass': {
      // executeAiRouletteAction: a bag the bot can do nothing with.
      if (s.mode !== 'roulette' || !isLive(s.phase) || !s.roulette.bag) return SAME(s);
      const passed = applyPassMove(s.board);
      return {
        state: {
          ...s,
          board: passed,
          roulette: { ...s.roulette, bag: null },
          legal: legalMovesFor(s.mode, passed),
          lastMove: null,
          phase: { tag: 'playing' },
        },
        events: [],
      };
    }

    case 'settle':
      // The bot's checkGameOver, after its move has been classified.
      return settle(s, [], a.board, a.lastWasRotation);

    case 'requestPromotion': {
      if (s.mode !== 'classic' || !isLive(s.phase)) return SAME(s);
      return { state: { ...s, phase: { tag: 'promotion', from: a.from, to: a.to } }, events: [] };
    }

    case 'cancelPromotion': {
      if (s.phase.tag !== 'promotion') return SAME(s);
      return { state: { ...s, phase: afterTurnPhase(s) }, events: [] };
    }

    case 'promote': {
      // handlePromotion.
      const p = s.phase;
      if (p.tag !== 'promotion') return SAME(s);
      const move = s.legal.find(
        (m) => m.from === p.from && m.to === p.to && m.kind === 'promotion' && m.promotion === a.piece,
      );
      if (!move) return SAME(s);
      return classicMove(s, move, a.now, true);
    }

    case 'spinStart': {
      // handleSpinRoulette (manual) / the auto-spin effect.
      if (s.mode !== 'roulette' || !isLive(s.phase) || s.roulette.bag !== null) return SAME(s);
      return {
        state: {
          ...s,
          phase: { tag: 'rouletteSpin', since: a.now },
          roulette: a.manual ? { ...s.roulette, firstSpinDone: true } : s.roulette,
        },
        events: [],
      };
    }

    case 'spinLand': {
      // doSpinRouletteNow's timeout: roll from the pieces the side has.
      if (s.phase.tag !== 'rouletteSpin') return SAME(s);
      const side = s.board.sideToMove;
      const { slots, rng } = roll(s);
      const playable = playableRouletteMoves(s.board, slots, []);
      const spins = s.roulette.spins + 1;
      // Pass only when nothing can be done: no piece move and no rotation.
      if (playable.length === 0 && s.board.lastMoveWasRotation) {
        const passed = applyPassMove(s.board);
        return {
          state: {
            ...s,
            rng,
            board: passed,
            roulette: { ...s.roulette, spins, bag: null },
            lastMove: null,
            legal: legalMovesFor(s.mode, passed),
            phase: { tag: 'playing' },
          },
          events: [{ type: 'rouletteSpin', by: side, slots: null }],
        };
      }
      return {
        state: {
          ...s,
          rng,
          roulette: {
            ...s.roulette,
            spins,
            bag: { slots, used: [], actionsLeft: ROULETTE_MAX_ACTIONS },
          },
          legal: playable,
          phase: { tag: 'playing' },
        },
        events: [{ type: 'rouletteSpin', by: side, slots }],
      };
    }

    case 'botSpin': {
      // applyAiSpin: drawn at once, and kept even if it allows nothing.
      if (s.mode !== 'roulette' || !isLive(s.phase) || s.roulette.bag !== null) return SAME(s);
      const { slots, rng } = roll(s);
      return {
        state: {
          ...s,
          rng,
          roulette: {
            ...s.roulette,
            spins: s.roulette.spins + 1,
            bag: { slots, used: [], actionsLeft: ROULETTE_MAX_ACTIONS },
          },
          legal: playableRouletteMoves(s.board, slots, []),
          phase: { tag: 'playing' },
        },
        events: [{ type: 'rouletteSpin', by: s.board.sideToMove, slots }],
      };
    }

    case 'resign': {
      // confirmResign.
      if (s.phase.tag === 'ended') return SAME(s);
      const status: TerminalStatus = a.side === 'white' ? 'resigned_white' : 'resigned_black';
      return { state: { ...s, phase: { tag: 'ended', status } }, events: [{ type: 'gameEnd', status }] };
    }

    case 'offerDraw': {
      // offerLocalDraw.
      if (s.phase.tag === 'ended') return SAME(s);
      const table = drawTableOf(s);
      const plies = s.log.moves.length;
      if (!canOfferDraw(table, a.side, plies)) return SAME(s);
      return {
        state: { ...s, draw: { logId: s.log.id, table: offerDraw(table, a.side, plies) } },
        events: [{ type: 'drawOffer', by: a.side }],
      };
    }

    case 'answerDraw': {
      // answerLocalDraw.
      if (s.phase.tag === 'ended') return SAME(s);
      const table = drawTableOf(s);
      const plies = s.log.moves.length;
      if (!canAnswerDraw(table.offer, a.side, plies)) return SAME(s);
      const by = otherColor(a.side);
      if (!a.accept) {
        return {
          state: { ...s, draw: { logId: s.log.id, table: declineDraw(table, a.side, plies) } },
          events: [{ type: 'drawOffer', by, answer: 'declined' }],
        };
      }
      return {
        state: { ...s, phase: { tag: 'ended', status: 'draw_agreement' } },
        events: [
          { type: 'drawOffer', by, answer: 'accepted' },
          { type: 'gameEnd', status: 'draw_agreement' },
        ],
      };
    }

    case 'analysis': {
      if (a.logId !== undefined && a.logId !== s.log.id) return SAME(s);
      const log = updateMoveAnalysisAt(s.log, a.index, a.analysis);
      return log === s.log ? SAME(s) : { state: { ...s, log }, events: [] };
    }

    case 'searchScore': {
      const log = attachSearchScoreToLastMove(s.log, a.scoreFromWhite);
      return log === s.log ? SAME(s) : { state: { ...s, log }, events: [] };
    }
  }
}

/** The phase a turn falls back to when nothing is pending. */
function afterTurnPhase(s: SessionState): Phase {
  return s.log.moves.length === 0 && s.roulette.bag === null ? { tag: 'setup' } : { tag: 'playing' };
}

function roll(s: SessionState) {
  const cursor = rngCursor(s.rng);
  const active = getActivePieceTypes(s.board, s.board.sideToMove);
  const slots = spinRoulette(active, s.roulette.spins < 3, cursor.random);
  return { slots, rng: cursor.state() };
}

/** checkGameOver: an ending found on `board` ends an active game, and
 *  never overwrites one already set. */
function settle(
  s: SessionState,
  events: SessionEvent[],
  board: BoardState,
  lastWasRotation: boolean,
): StepResult {
  if (s.phase.tag === 'ended') return { state: s, events };
  const status = gameEnding(s.mode, board, lastWasRotation);
  if (!status) return { state: s, events };
  return {
    state: { ...s, phase: { tag: 'ended', status } },
    events: [...events, { type: 'gameEnd', status }],
  };
}

/** The events of a piece move made by `by` on `before`, landing on `after`. */
function moveEvents(before: BoardState, after: BoardState, move: Move, san: string, index: number): SessionEvent[] {
  const by = before.sideToMove;
  const events: SessionEvent[] = [{ type: 'move', move, san, by, index }];
  const victim = move.to ? before.pieces[move.to] : undefined;
  if (victim && move.to) {
    events.push({ type: 'capture', square: move.to, piece: victim.type, enPassant: false });
  } else if (move.kind === 'enPassant' && move.to) {
    events.push({ type: 'capture', square: move.to, piece: 'pawn', enPassant: true });
  }
  if (move.kind === 'promotion' && move.promotion && move.to) {
    events.push({ type: 'promotion', square: move.to, piece: move.promotion });
  }
  if (findKing(after, after.sideToMove) && isInCheck(after)) {
    events.push({ type: 'check', side: after.sideToMove });
  }
  return events;
}

/** commitMove (classic) / handlePromotion / the bot's and chat's moves. */
function classicMove(s: SessionState, move: Move, now: number, settleNow: boolean): StepResult {
  const before = s.board;
  const san = computeSAN(before, move);
  const after = applyMove(before, move);
  const index = s.log.moves.length;
  const next: SessionState = {
    ...s,
    board: after,
    legal: legalMovesFor(s.mode, after),
    log: appendMove(s.log, move, san, before.topologyState, undefined, now),
    lastMove: { from: move.from, to: move.to },
    draw: noteDrawMove(s, before.sideToMove),
    phase: { tag: 'playing' },
  };
  const events = moveEvents(before, after, move, san, index);
  return settleNow ? settle(next, events, after, false) : { state: next, events };
}

/** commitMove's Roulette half / executeAiRouletteAction: one action of
 *  the turn; the side keeps the turn while the bag has actions left. */
function rouletteMove(s: SessionState, move: Move, now: number): StepResult {
  const bag = s.roulette.bag;
  if (!bag || bag.actionsLeft <= 0) return SAME(s);
  const before = s.board;
  const moverType = before.pieces[move.from!]!.type;
  const san = computeSAN(before, move);
  const after = applyMove(before, move);
  const index = s.log.moves.length;
  const slotIdx = consumeSlotIndex([...bag.slots], [...bag.used], moverType);
  const used = slotIdx >= 0 ? [...bag.used, slotIdx] : bag.used;
  const actionsAfter = bag.actionsLeft - 1;
  const kingCaptured = !findKing(after, 'white') || !findKing(after, 'black');

  const clamped: BoardState = { ...after, sideToMove: before.sideToMove };
  let nextPlayable: Move[] = [];
  let stayOnTurn = false;
  if (!kingCaptured && actionsAfter > 0) {
    nextPlayable = playableRouletteMoves(clamped, bag.slots, used);
    stayOnTurn = nextPlayable.length > 0 || !clamped.lastMoveWasRotation;
  }

  const common = {
    ...s,
    log: appendMove(s.log, move, san, before.topologyState, undefined, now),
    lastMove: { from: move.from, to: move.to },
    draw: noteDrawMove(s, before.sideToMove),
    phase: { tag: 'playing' } as const,
  };
  const next: SessionState = stayOnTurn
    ? {
        ...common,
        board: clamped,
        roulette: { ...s.roulette, bag: { slots: bag.slots, used, actionsLeft: actionsAfter } },
        legal: nextPlayable,
      }
    : {
        ...common,
        board: after,
        roulette: { ...s.roulette, bag: null },
        legal: legalMovesFor(s.mode, after),
      };
  return settle(next, moveEvents(before, after, move, san, index), after, false);
}

/** handleRotate / executeAiRouletteRotation / the bot's classic rotation. */
function rotate(s: SessionState, now: number): StepResult {
  if (!isLive(s.phase)) return SAME(s);
  const before = s.board;
  if (before.lastMoveWasRotation) return SAME(s);
  let bag: RouletteBag | null = null;
  if (s.mode === 'roulette') {
    // A rotation costs one action and spends no slot.
    bag = s.roulette.bag;
    if (!bag || bag.actionsLeft < 1) return SAME(s);
  } else if (!rotationKeepsKingSafe(before)) {
    return SAME(s);
  }

  const rotated = applyRotationMove(before);
  const toggleMove: Move = { kind: 'topologyToggle' };
  const san = computeSAN(before, toggleMove);
  const index = s.log.moves.length;
  const promoted = (Object.keys(rotated.pieces) as SquareId[]).filter(
    (sq) => before.pieces[sq]?.type === 'pawn' && rotated.pieces[sq]?.type === 'queen',
  );
  const events: SessionEvent[] = [
    { type: 'move', move: toggleMove, san, by: before.sideToMove, index },
    { type: 'rotation', by: before.sideToMove, promoted },
  ];
  if (findKing(rotated, rotated.sideToMove) && isInCheck(rotated)) {
    events.push({ type: 'check', side: rotated.sideToMove });
  }
  const common = {
    ...s,
    log: appendMove(s.log, toggleMove, san, before.topologyState, undefined, now),
    lastMove: null,
    draw: noteDrawMove(s, before.sideToMove),
    phase: { tag: 'playing' } as const,
  };

  if (!bag) {
    const next: SessionState = { ...common, board: rotated, legal: legalMovesFor(s.mode, rotated) };
    return settle(next, events, rotated, true);
  }

  const endTurn = (): StepResult => {
    const next: SessionState = {
      ...common,
      board: rotated,
      roulette: { ...s.roulette, bag: null },
      legal: legalMovesFor(s.mode, rotated),
    };
    return settle(next, events, rotated, true);
  };
  const actionsAfter = bag.actionsLeft - 1;
  if (actionsAfter === 0) return endTurn();
  // First action: the same side keeps the turn on the turned board.
  const clamped: BoardState = { ...rotated, sideToMove: before.sideToMove };
  const nextPlayable = playableRouletteMoves(clamped, bag.slots, bag.used);
  // No second rotation this turn, so nothing left to do ends it.
  if (nextPlayable.length === 0) return endTurn();
  const next: SessionState = {
    ...common,
    board: clamped,
    roulette: { ...s.roulette, bag: { ...bag, actionsLeft: actionsAfter } },
    legal: nextPlayable,
  };
  return settle(next, events, clamped, true);
}

/** Any move retires a standing offer; the mover may offer again. */
function noteDrawMove(s: SessionState, mover: Color): SessionState['draw'] {
  return s.draw.logId === s.log.id
    ? { ...s.draw, table: drawTableAfterMove(s.draw.table, mover) }
    : s.draw;
}
