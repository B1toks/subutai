import { describe, expect, it } from 'vitest';
import replaysJson from '../../qa/fixtures/replays.json?raw';
import endingsJson from '../../qa/fixtures/endings.json?raw';
import { createStartingPosition, type Color, type Move, type PieceType, type SquareId } from '../engine';
import { toggleTopology } from '../engine/auxetic';
import { replayFromNotation } from '../memory/replayImport';
import type { MoveAnalysis } from '../analysis/classify';
import { LegacyApp, legacyWorld } from './golden/legacy';
import { createSession, drawTableOf, statusOf, step } from './step';
import { playableRouletteMoves, rotationKeepsKingSafe } from './rules';
import { rngCursor, rngFromSeed } from './rng';
import type { Action, SessionState } from './types';

// Golden tests: step() against the game as App played it before the
// session existed (golden/legacy.ts), action by action. After every
// action the two must agree on everything a player or a save can see:
// the board, the legal moves, the log, the status, the roulette turn,
// the draw offers, the clocks.

const PROMOS: PieceType[] = ['queen', 'rook', 'bishop', 'knight'];

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What both worlds must agree on, as comparable plain data. */
function viewOfLegacy(app: LegacyApp) {
  const w = app.w;
  const active = w.gameStatus === 'active';
  return {
    mode: w.gameModeLocal,
    seed: w.seed,
    initial: w.initialState,
    board: w.stateLocal,
    // After the end the bot's king-capture branch leaves the old list;
    // nothing reads it then (the board is over).
    legal: active ? w.legalMovesLocal : null,
    log: w.logLocal,
    lastMove: w.lastMoveLocal,
    status: w.gameStatus,
    promotion: w.pendingPromotion,
    // Deliberate change: a game that ends while the wheel turns stays
    // ended (the old timeout still drew a bag onto the finished board).
    spinning: active ? w.isRouletteSpinning : null,
    bag:
      w.allowedPieceTypesLocal === null
        ? null
        : { slots: w.allowedPieceTypesLocal, used: w.usedRouletteSlotsLocal, actionsLeft: w.rouletteActionsLeftLocal },
    spins: w.rouletteSpinCountLocal,
    firstSpinDone: w.firstRouletteSpinDoneLocal,
    draw: w.localDraw.logId === w.logLocal.id ? w.localDraw.table : { offer: null, waiting: [] },
    clock: w.clockMs,
    tc: w.soloTcSec,
  };
}

function viewOfSession(s: SessionState) {
  const status = statusOf(s);
  return {
    mode: s.mode,
    seed: s.seed,
    initial: s.initial,
    board: s.board,
    legal: status === 'active' ? s.legal : null,
    log: s.log,
    lastMove: s.lastMove,
    status,
    promotion: s.phase.tag === 'promotion' ? { from: s.phase.from, to: s.phase.to } : null,
    spinning: status === 'active' ? s.phase.tag === 'rouletteSpin' : null,
    bag: s.roulette.bag,
    spins: s.roulette.spins,
    firstSpinDone: s.roulette.firstSpinDone,
    draw: drawTableOf(s),
    clock: s.clock,
    tc: s.timeControlSec,
  };
}

function firstDifference(a: Record<string, unknown>, b: Record<string, unknown>): string | null {
  for (const k of Object.keys(a)) {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x !== y) return `${k}:\n  legacy  ${x?.slice(0, 400)}\n  session ${y?.slice(0, 400)}`;
  }
  return null;
}

/** Both worlds side by side, driven by the same actions. */
class Pair {
  app: LegacyApp;
  s: SessionState;
  /** The legacy side's copy of the chance stream (it has no state.rng). */
  legacyRng: number;
  trail: string[] = [];

  constructor(seed: number, now: number) {
    const initial = createStartingPosition(seed);
    this.app = new LegacyApp(legacyWorld(initial, seed, now));
    this.s = createSession({ initial, seed, now });
    this.legacyRng = rngFromSeed(seed);
  }

  /** A random source over the legacy copy of the stream. */
  legacyRandom(): () => number {
    const cursor = rngCursor(this.legacyRng);
    return () => {
      const v = cursor.random();
      this.legacyRng = cursor.state();
      return v;
    };
  }

  dispatch(a: Action, legacy: () => void, label: string) {
    this.trail.push(label);
    legacy();
    this.s = step(this.s, a).state;
    this.check();
  }

  check() {
    // Invariants of the phase type that the type itself cannot state.
    if (this.s.phase.tag === 'setup') {
      expect(this.s.log.moves.length, this.where('setup with moves')).toBe(0);
      expect(this.s.roulette.bag, this.where('setup with a bag')).toBeNull();
    }
    const diff = firstDifference(viewOfLegacy(this.app), viewOfSession(this.s));
    if (diff) throw new Error(`${this.where('differs')}\n${diff}`);
  }

  where(what: string) {
    return `${what} after: ${this.trail.slice(-6).join(' | ')} (#${this.trail.length})`;
  }
}

/** The move a click from→to plays, as onSquareClick finds it. */
function clickTarget(legal: readonly Move[], m: Move): SquareId {
  // A castle is clicked on the king's target, unless another move from
  // the king lands there first — then on the rook.
  if (m.kind === 'castle' && m.to) {
    const first = legal.find((x) => x.from === m.from && x.to === m.to);
    if (first && first.kind !== 'castle') return m.castleRookFrom!;
  }
  return m.to!;
}

function clickResolve(legal: readonly Move[], from: SquareId, to: SquareId): Move | undefined {
  return (
    legal.find((m) => m.from === from && m.to === to) ??
    legal.find((m) => m.from === from && m.kind === 'castle' && m.castleRookFrom === to)
  );
}

const FAKE_ANALYSIS = { classification: 'good' } as unknown as MoveAnalysis;

/** One self-play game. White plays by clicks; Black is the bot unless it
 *  is a hot-seat game, where both click and offer draws. */
function selfPlay(g: number) {
  const rnd = mulberry32(g * 7919 + 17);
  let now = 1_760_000_000_000 + g * 10_000_000;
  const tick = () => (now += 1 + Math.floor(rnd() * 900));
  const p = new Pair(1000 + g, now);
  const roulette = g % 3 === 1;
  const hotSeat = g % 4 === 2;
  const timed = g % 5 === 0;
  let newGames = 0;

  if (roulette) p.dispatch({ type: 'setMode', mode: 'roulette' }, () => p.app.setMode('roulette'), 'mode R');
  if (timed) p.dispatch({ type: 'setTimeControl', sec: 40 }, () => p.app.setTimeControl(40), 'tc 40');

  for (let n = 0; n < 260; n++) {
    const s = p.s;
    if (statusOf(s) !== 'active') {
      // One fresh game after the first ends, from a new position.
      if (newGames++ > 0) break;
      const initial = createStartingPosition(5000 + g);
      const t = tick();
      p.dispatch({ type: 'newGame', initial, now: t, seed: t }, () => p.app.startNewGame(initial, t), 'newGame');
      p.legacyRng = rngFromSeed(t);
      continue;
    }

    const dt = Math.floor(rnd() * 3500);
    p.dispatch({ type: 'clockTick', dt }, () => p.app.clockTick(dt), `tick ${dt}`);
    const flagged = p.app.flaggedSide();
    if (flagged) {
      p.dispatch({ type: 'flag', side: flagged }, () => p.app.flag(flagged), `flag ${flagged}`);
      continue;
    }

    const side: Color = s.board.sideToMove;
    const human = side === 'white' || hotSeat;
    const t = tick();

    // Now and then: a mode click (refused once the game has begun).
    if (rnd() < 0.03) {
      const mode = s.mode === 'classic' ? 'roulette' : 'classic';
      p.dispatch({ type: 'setMode', mode }, () => p.app.setMode(mode), `mode ${mode}`);
      continue;
    }
    // A late classification patching an earlier move.
    if (rnd() < 0.05 && s.log.moves.length > 0) {
      const index = Math.floor(rnd() * s.log.moves.length);
      p.dispatch({ type: 'analysis', index, analysis: FAKE_ANALYSIS }, () => p.app.analysis(index, FAKE_ANALYSIS), `analysis ${index}`);
      continue;
    }
    // Hot-seat draw offers and answers, and the odd resignation.
    if (hotSeat && rnd() < 0.08) {
      const who: Color = rnd() < 0.5 ? 'white' : 'black';
      const answer = drawTableOf(s).offer && rnd() < 0.7;
      if (answer) {
        const accept = rnd() < 0.3;
        p.dispatch({ type: 'answerDraw', side: who, accept }, () => p.app.answerDraw(who, accept), `answer ${who} ${accept}`);
      } else {
        p.dispatch({ type: 'offerDraw', side: who }, () => p.app.offerDraw(who), `offer ${who}`);
      }
      continue;
    }
    if (rnd() < 0.004 && s.log.moves.length > 0) {
      p.dispatch({ type: 'resign', side }, () => p.app.resign(side), `resign ${side}`);
      continue;
    }

    if (s.mode === 'roulette') {
      const bag = s.roulette.bag;
      if (!bag) {
        // v1.1.6: the roll is made as the wheel starts, then the bag lands
        // slot by slot (session/reveal.ts dispatches the beats).
        // A spin still landing (a mode click refused once the log has a
        // move) is landed, not started again.
        const landing = s.roulette.reveal;
        const since = landing ? landing.since : t;
        if (!landing) {
          const random = p.legacyRandom();
          if (human) {
            const manual = !s.roulette.firstSpinDone;
            p.dispatch({ type: 'spinStart', now: t, manual }, () => p.app.spinStart(manual, random), 'spinStart');
            // Before the bag has landed, maybe a mode click (allowed on an empty log).
            if (rnd() < 0.1) {
              p.dispatch({ type: 'setMode', mode: 'classic' }, () => p.app.setMode('classic'), 'mode C (spinning)');
              continue;
            }
          } else {
            p.dispatch({ type: 'botSpin', now: t }, () => p.app.botSpin(random), 'botSpin');
          }
        }
        for (let slot = 0; slot < 4; slot++) {
          p.dispatch({ type: 'spinSlot', since }, () => {}, 'spinSlot');
        }
        p.dispatch({ type: 'spinLand', since }, () => p.app.spinLand(), 'spinLand');
        continue;
      }
      const playable = s.legal;
      if (human) {
        const canRotate = !s.board.lastMoveWasRotation;
        if (canRotate && (playable.length === 0 || rnd() < 0.15)) {
          p.dispatch({ type: 'rotate', actor: 'human', now: t }, () => p.app.rotate(t), 'rotate');
          continue;
        }
        const m = playable[Math.floor(rnd() * playable.length)];
        const to = clickTarget(playable, m);
        const resolved = clickResolve(playable, m.from!, to)!;
        p.dispatch({ type: 'move', actor: 'human', move: resolved, now: t }, () => p.app.clickMove(m.from!, to, t), `click ${m.from}-${to}`);
        continue;
      }
      // The bot: a move from the bag, or with none, a rotation that opens
      // one, or a pass.
      if (playable.length > 0) {
        const m = playable[Math.floor(rnd() * playable.length)];
        p.dispatch({ type: 'move', actor: 'human', move: m, now: t }, () => p.app.botRouletteAction(m, t), `bot ${m.from}-${m.to}`);
      } else {
        const opens =
          !s.board.lastMoveWasRotation &&
          playableRouletteMoves(toggleTopology(s.board), bag.slots, bag.used).length > 0;
        p.dispatch(
          opens ? { type: 'rotate', actor: 'human', now: t } : { type: 'pass' },
          () => p.app.botRouletteAction(null, t),
          opens ? 'bot rotate' : 'bot pass',
        );
      }
      continue;
    }

    // Classic.
    const canRotate = !s.board.lastMoveWasRotation && rotationKeepsKingSafe(s.board);
    if (canRotate && (s.legal.length === 0 || rnd() < 0.12)) {
      if (human) {
        p.dispatch({ type: 'rotate', actor: 'human', now: t }, () => p.app.rotate(t), 'rotate');
      } else {
        const move: Move = { kind: 'topologyToggle' };
        p.dispatch({ type: 'move', actor: 'human', move, now: t }, () => p.app.botMove(move, t), 'bot rotate');
      }
      continue;
    }
    if (s.legal.length === 0) break; // cannot happen while active: the end check would have fired
    const m = s.legal[Math.floor(rnd() * s.legal.length)];
    if (human) {
      const to = clickTarget(s.legal, m);
      const resolved = clickResolve(s.legal, m.from!, to)!;
      if (resolved.kind === 'promotion') {
        p.dispatch({ type: 'requestPromotion', from: resolved.from!, to: resolved.to! }, () => p.app.clickMove(m.from!, to, t), `click ${m.from}-${to} (promotion)`);
        if (rnd() < 0.1) {
          p.dispatch({ type: 'cancelPromotion' }, () => p.app.cancelPromotion(), 'cancel promotion');
          continue;
        }
        const piece = PROMOS[Math.floor(rnd() * PROMOS.length)];
        p.dispatch({ type: 'promote', piece, now: t }, () => p.app.promote(piece, t), `promote ${piece}`);
      } else {
        p.dispatch({ type: 'move', actor: 'human', move: resolved, now: t }, () => p.app.clickMove(m.from!, to, t), `click ${m.from}-${to}`);
      }
      continue;
    }
    // The bot: the board changes now, the end check after classification.
    const held: { after?: ReturnType<LegacyApp['botMove']> } = {};
    const logId = p.s.log.id;
    const plies = p.s.log.moves.length + 1;
    p.dispatch({ type: 'move', actor: 'human', move: m, now: t, settle: false }, () => (held.after = p.app.botMove(m, t)), `bot ${m.from}-${m.to}`);
    const settled = held.after!;
    p.dispatch(
      { type: 'settle', board: settled.next, lastWasRotation: false, logId, plies },
      () => p.app.botSettle(settled.next, false),
      'bot settle',
    );
  }
  return p;
}

// 30 games per commit; the full gate at the end of a stage plays all of
// them (GOLDEN_GAMES=320, set by check-all.sh).
const GAMES = Number(import.meta.env.GOLDEN_GAMES ?? 30);

describe('step() plays solo games exactly as App did', () => {
  const CHUNK = 10;
  const seen = new Set<string>();
  for (let first = 0; first < GAMES; first += CHUNK) {
    const last = Math.min(first + CHUNK, GAMES) - 1;
    it(`self-play games ${first}..${last}`, () => {
      let plies = 0;
      for (let g = first; g <= last; g++) {
        const p = selfPlay(g);
        plies += p.s.log.moves.length;
        for (const label of p.trail) seen.add(label.split(' ')[0]);
      }
      expect(plies).toBeGreaterThan((last - first + 1) * 10);
    }, 120_000);
  }

  it('covers what it claims to: roulette, rotations, promotions, flags, draws', () => {
    for (const want of ['spinLand', 'botSpin', 'rotate', 'promote', 'flag', 'offer', 'answer', 'newGame', 'bot']) {
      expect([...seen], want).toContain(want);
    }
  });
});

describe('the QA fixtures, through step()', () => {
  type Fixture = { name: string; notation: string; final: { topology: string; side: string; pieces: Record<string, string> } };
  for (const fx of JSON.parse(replaysJson) as Fixture[]) {
    it(`replay ${fx.name} loads and plays on as App did`, () => {
      const now = 1_760_000_000_000;
      const replay = replayFromNotation(fx.notation, { now });
      // The independent oracle's final position (qa/engine/oracle.ts).
      const pieces: Record<string, string> = {};
      for (const [sq, piece] of Object.entries(replay.final.pieces)) {
        if (piece) pieces[sq] = `${piece.color} ${piece.type}`;
      }
      expect(pieces).toEqual(fx.final.pieces);
      expect(replay.final.topologyState).toBe(fx.final.topology);

      const p = new Pair(1, now);
      p.dispatch(
        {
          type: 'load',
          game: { initial: replay.initial, board: replay.final, log: replay.log },
          fresh: true,
          settle: { lastWasRotation: replay.lastWasRotation },
        },
        () => p.app.loadImported(replay.initial, replay.final, replay.log, replay.lastWasRotation),
        'load',
      );
      // ...and twenty more plies from there, both sides clicking.
      const rnd = mulberry32(fx.name.length * 31);
      for (let i = 0; i < 20 && statusOf(p.s) === 'active' && p.s.legal.length > 0; i++) {
        const m = p.s.legal[Math.floor(rnd() * p.s.legal.length)];
        const to = clickTarget(p.s.legal, m);
        const resolved = clickResolve(p.s.legal, m.from!, to)!;
        const t = now + i;
        if (resolved.kind === 'promotion') {
          p.dispatch({ type: 'requestPromotion', from: resolved.from!, to: resolved.to! }, () => p.app.clickMove(m.from!, to, t), 'promo');
          p.dispatch({ type: 'promote', piece: 'queen', now: t }, () => p.app.promote('queen', t), 'promote');
        } else {
          p.dispatch({ type: 'move', actor: 'human', move: resolved, now: t }, () => p.app.clickMove(m.from!, to, t), 'click');
        }
      }
    });
  }

  type Ending = { notation: string; finalMove: { from: SquareId; to: SquareId } };
  for (const [name, fx] of Object.entries(JSON.parse(endingsJson) as Record<string, Ending>)) {
    it(`ending ${name} is a checkmate in both`, () => {
      const now = 1_760_000_000_000;
      const replay = replayFromNotation(fx.notation, { now });
      const p = new Pair(1, now);
      p.dispatch(
        { type: 'load', game: { initial: replay.initial, board: replay.final, log: replay.log }, fresh: true, settle: { lastWasRotation: replay.lastWasRotation } },
        () => p.app.loadImported(replay.initial, replay.final, replay.log, replay.lastWasRotation),
        'load',
      );
      const resolved = clickResolve(p.s.legal, fx.finalMove.from, fx.finalMove.to)!;
      expect(resolved).toBeDefined();
      p.dispatch({ type: 'move', actor: 'human', move: resolved, now }, () => p.app.clickMove(fx.finalMove.from, fx.finalMove.to, now), 'mate');
      expect(statusOf(p.s)).toBe('checkmate');
    });
  }
});
