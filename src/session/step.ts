import type { BoardState, Color, Move } from '../engine';
import { applyMove, findKing } from '../engine/moves';
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
import { eventsOfEntry } from './events';
import { gameOfMatch } from './online';
import {
  legalMovesFor,
  otherColor,
  playableRouletteMoves,
  rotationKeepsKingSafe,
  sameMove,
} from './rules';
import type {
  Action,
  Actor,
  Phase,
  RouletteBag,
  RouletteReveal,
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

const NO_ROULETTE = { bag: null, reveal: null, spins: 0, firstSpinDone: false } as const;
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
    online: null,
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

/**
 * The online match, as its document now reads. A move appended within the
 * same match plays out as events (actor 'remote', mine too), against the
 * board shown before it; a match coming on the board, or another one
 * replacing it, plays nothing. The solo game is left alone, and no event
 * ends a game: an online match ends in its document.
 */
function follow(s: SessionState, a: Extract<Action, { type: 'follow' }>): StepResult {
  if (!a.doc) return s.online ? { state: { ...s, online: null }, events: [] } : SAME(s);
  const game = a.myUid ? gameOfMatch(a.doc, a.myUid, a.now) : null;
  const same = s.online?.doc.code === a.doc.code;
  const prev = same ? s.online!.game : null;
  const length = game?.log.moves.length ?? 0;
  const last = game?.log.moves[length - 1];
  const events =
    game && prev && last && length > prev.log.moves.length
      ? eventsOfEntry(prev.board, game.board, last.move, last.san ?? '', 'remote', length - 1)
      : [];
  // v1.1.6: a bag that arrives where there was none lands slot by slot on
  // both screens; one already there when the match is joined or rejoined
  // is shown as it is. A reveal under way survives the next snapshots.
  const reveal: RouletteReveal | null =
    !game || game.slots === null
      ? null
      : prev && prev.slots === null
        ? { since: a.now, slots: game.slots, shown: 0, of: 'online' }
        : same
          ? s.online!.reveal
          : null;
  return { state: { ...s, online: { doc: a.doc, myUid: a.myUid, game, reveal } }, events };
}

/** The bag landing now: the online match's while the session follows one,
 *  else the session's own game's. */
export function revealOf(s: SessionState): RouletteReveal | null {
  return s.online ? s.online.reveal : s.roulette.reveal;
}

function isLive(p: Phase): boolean {
  return p.tag === 'setup' || p.tag === 'playing';
}

function reduce(s: SessionState, a: Action): StepResult {
  switch (a.type) {
    case 'follow':
      return follow(s, a);

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
      const roulette = a.fresh ? NO_ROULETTE : { ...s.roulette, reveal: null };
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
      // A watched replay one move on plays that move out, for the board's
      // sound and effects. A game put back on the board (a Memory resume,
      // Load replay, the end of a replay) is not a move: it plays nothing.
      const step =
        a.replayStep === true &&
        g.log.id === s.log.id &&
        g.log.moves.length === s.log.moves.length + 1;
      const last = g.log.moves[g.log.moves.length - 1];
      const events =
        step && last
          ? eventsOfEntry(s.board, g.board, last.move, last.san ?? '', 'replay', g.log.moves.length - 1)
          : [];
      if (!a.settle) return { state: loaded, events };
      return settle(loaded, events, g.board, a.settle.lastWasRotation);
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
          roulette: { ...s.roulette, bag: null, reveal: null },
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
      if (a.move.kind === 'topologyToggle') return rotate(s, a.actor, a.now);
      if (!isLive(s.phase)) return SAME(s);
      if (!s.legal.some((m) => sameMove(m, a.move))) return SAME(s);
      return s.mode === 'roulette'
        ? rouletteMove(s, a.move, a.actor, a.now)
        : classicMove(s, a.move, a.actor, a.now, a.settle !== false);
    }

    case 'rotate':
      return rotate(s, a.actor, a.now);

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
      // The bot's checkGameOver, after its move has been classified: on
      // the game it moved in, its move still the last one.
      if (a.logId !== s.log.id || a.plies !== s.log.moves.length) return SAME(s);
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
      return classicMove(s, move, 'human', a.now, true);
    }

    case 'spinStart': {
      // handleSpinRoulette (manual) / the auto-spin effect. The roll is
      // made now, from the pieces the side has; it lands slot by slot.
      if (s.mode !== 'roulette' || !isLive(s.phase) || s.roulette.bag !== null) return SAME(s);
      const { slots, rng } = roll(s);
      return {
        state: {
          ...s,
          rng,
          phase: { tag: 'rouletteSpin', since: a.now },
          roulette: {
            ...s.roulette,
            firstSpinDone: a.manual ? true : s.roulette.firstSpinDone,
            reveal: { since: a.now, slots, shown: 0, of: 'spin' },
          },
        },
        events: [],
      };
    }

    case 'botSpin': {
      // applyAiSpin: the bot's roll lands the same way, and the bag is kept
      // even if it allows nothing.
      if (s.mode !== 'roulette' || !isLive(s.phase) || s.roulette.bag !== null) return SAME(s);
      const { slots, rng } = roll(s);
      return {
        state: {
          ...s,
          rng,
          phase: { tag: 'rouletteSpin', since: a.now },
          roulette: { ...s.roulette, reveal: { since: a.now, slots, shown: 0, of: 'botSpin' } },
        },
        events: [],
      };
    }

    case 'spinSlot': {
      const r = revealOf(s);
      if (!r || r.since !== a.since || r.shown >= r.slots.length) return SAME(s);
      const next = { ...r, shown: r.shown + 1 };
      const events: SessionEvent[] = [
        { type: 'rouletteSlot', index: r.shown, last: next.shown === r.slots.length },
      ];
      return s.online
        ? { state: { ...s, online: { ...s.online, reveal: next } }, events }
        : { state: { ...s, roulette: { ...s.roulette, reveal: next } }, events };
    }

    case 'spinLand': {
      // The reveal has landed whole.
      const r = revealOf(s);
      if (!r || r.since !== a.since || r.shown < r.slots.length) return SAME(s);
      if (s.online) return { state: { ...s, online: { ...s.online, reveal: null } }, events: [] };
      if (s.phase.tag !== 'rouletteSpin') return SAME(s);
      const side = s.board.sideToMove;
      const slots = r.slots;
      const spins = s.roulette.spins + 1;
      const playable = playableRouletteMoves(s.board, slots, []);
      // Pass only when nothing can be done: no piece move and no rotation.
      // The bot keeps its bag whatever it allows (its turn decides).
      if (r.of === 'spin' && playable.length === 0 && s.board.lastMoveWasRotation) {
        const passed = applyPassMove(s.board);
        return {
          state: {
            ...s,
            board: passed,
            roulette: { ...s.roulette, spins, bag: null, reveal: null },
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
          roulette: {
            ...s.roulette,
            spins,
            reveal: null,
            bag: { slots, used: [], actionsLeft: ROULETTE_MAX_ACTIONS },
          },
          legal: playable,
          phase: { tag: 'playing' },
        },
        events: [{ type: 'rouletteSpin', by: side, slots }],
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


/** commitMove (classic) / handlePromotion / the bot's and chat's moves. */
function classicMove(s: SessionState, move: Move, actor: Actor, now: number, settleNow: boolean): StepResult {
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
  const events = eventsOfEntry(before, after, move, san, actor, index);
  return settleNow ? settle(next, events, after, false) : { state: next, events };
}

/** commitMove's Roulette half / executeAiRouletteAction: one action of
 *  the turn; the side keeps the turn while the bag has actions left. */
function rouletteMove(s: SessionState, move: Move, actor: Actor, now: number): StepResult {
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
  return settle(next, eventsOfEntry(before, after, move, san, actor, index), after, false);
}

/** handleRotate / executeAiRouletteRotation / the bot's classic rotation. */
function rotate(s: SessionState, actor: Actor, now: number): StepResult {
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
  const events = eventsOfEntry(before, rotated, toggleMove, san, actor, index);
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
