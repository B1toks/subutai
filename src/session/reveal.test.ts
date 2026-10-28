import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartingPosition } from '../engine';
import type { MatchDoc } from '../firebase/matches';
import { createStore } from './store';
import { createSession, revealOf, step } from './step';
import { createReveal, REVEAL_SETTLE_MS, REVEAL_SLOT_MS } from './reveal';
import { createTurns } from './players/turns';
import type { Player } from './players/types';
import type { Action, SessionEvent, SessionState } from './types';

// v1.1.6: a Roulette bag lands slot by slot, one every 400 ms, and the turn
// waits for it: the player's spin, the bot's, and a fresh bag online.

const NOW = 1_760_000_000_000;
const roulette = (): SessionState =>
  step(createSession({ initial: createStartingPosition(7), seed: 7, now: NOW }), { type: 'setMode', mode: 'roulette' }).state;

function run(s: SessionState, actions: Action[]) {
  const events: SessionEvent[] = [];
  for (const a of actions) {
    const out = step(s, a);
    s = out.state;
    events.push(...out.events);
  }
  return { s, events };
}
const slots4 = (since: number): Action[] => Array.from({ length: 4 }, () => ({ type: 'spinSlot', since }) as const);

describe('a spin lands slot by slot (step)', () => {
  it('the roll is made as the wheel starts; four beats, then the bag is the side\'s', () => {
    const start = step(roulette(), { type: 'spinStart', now: NOW, manual: true }).state;
    const r = start.roulette.reveal!;
    expect(r).toMatchObject({ since: NOW, shown: 0, of: 'spin' });
    expect(r.slots).toHaveLength(4);
    expect(start.phase.tag).toBe('rouletteSpin');
    expect(start.roulette.bag).toBeNull();
    // The bag cannot land before its slots have.
    expect(step(start, { type: 'spinLand', since: NOW }).state).toBe(start);
    const { s, events } = run(start, slots4(NOW));
    expect(events).toEqual([0, 1, 2, 3].map((index) => ({ type: 'rouletteSlot', index, last: index === 3 })));
    expect(s.roulette.reveal!.shown).toBe(4);
    const landed = step(s, { type: 'spinLand', since: NOW });
    expect(landed.state.roulette.bag?.slots).toEqual(r.slots);
    expect(landed.state.roulette.reveal).toBeNull();
    expect(landed.state.phase.tag).toBe('playing');
    expect(landed.state.roulette.spins).toBe(1);
  });

  it('nothing can be moved, rotated or spun again while it lands', () => {
    const s = step(roulette(), { type: 'spinStart', now: NOW, manual: true }).state;
    const move = s.legal[0];
    expect(step(s, { type: 'move', move, actor: 'human', now: NOW }).state).toBe(s);
    expect(step(s, { type: 'rotate', actor: 'human', now: NOW }).state).toBe(s);
    expect(step(s, { type: 'spinStart', now: NOW + 1, manual: false }).state).toBe(s);
  });

  it('a beat or a landing for another reveal is refused', () => {
    const s = step(roulette(), { type: 'spinStart', now: NOW, manual: true }).state;
    expect(step(s, { type: 'spinSlot', since: NOW - 1 }).state).toBe(s);
  });

  it('a new game mid-spin is a clean board: no bag, no reveal, nothing to land', () => {
    const spinning = run(step(roulette(), { type: 'spinStart', now: NOW, manual: true }).state, slots4(NOW).slice(0, 2)).s;
    const fresh = step(spinning, { type: 'newGame', initial: createStartingPosition(9), now: NOW + 1 }).state;
    expect(fresh.roulette.reveal).toBeNull();
    expect(fresh.roulette.bag).toBeNull();
    expect(fresh.phase.tag).toBe('setup');
    expect(step(fresh, { type: 'spinLand', since: NOW }).state).toBe(fresh);
  });

  it('a mode click mid-spin (empty log) drops the spin: nothing lands in Classic', () => {
    const spinning = step(roulette(), { type: 'spinStart', now: NOW, manual: true }).state;
    const classic = step(spinning, { type: 'setMode', mode: 'classic' }).state;
    expect(classic.roulette.reveal).toBeNull();
    expect(run(classic, [...slots4(NOW), { type: 'spinLand', since: NOW }]).s.roulette.bag).toBeNull();
  });

  it('the bot\'s spin lands the same way and keeps its bag', () => {
    const s = step(roulette(), { type: 'botSpin', now: NOW }).state;
    expect(s.roulette.reveal).toMatchObject({ of: 'botSpin', shown: 0 });
    const landed = run(s, [...slots4(NOW), { type: 'spinLand', since: NOW }]).s;
    expect(landed.roulette.bag?.slots).toEqual(s.roulette.reveal!.slots);
  });
});

describe('the reveal clock (session/reveal.ts)', () => {
  afterEach(() => vi.useRealTimers());

  it('a beat every 400 ms, timed from the one before, and the bag 200 ms after the last', () => {
    vi.useFakeTimers();
    const store = createStore<SessionState, Action, SessionEvent>(roulette(), step);
    const reveal = createReveal(store);
    const beats: number[] = [];
    store.onEvents((events) => {
      for (const e of events) if (e.type === 'rouletteSlot') beats.push(Date.now());
    });
    const t0 = Date.now();
    store.dispatch({ type: 'spinStart', now: t0, manual: true });
    vi.advanceTimersByTime(REVEAL_SLOT_MS * 4 - 1);
    expect(beats.map((t) => t - t0)).toEqual([400, 800, 1200]);
    vi.advanceTimersByTime(1);
    expect(beats).toHaveLength(4);
    expect(store.getState().roulette.bag).toBeNull();
    vi.advanceTimersByTime(REVEAL_SETTLE_MS);
    expect(store.getState().roulette.bag).not.toBeNull();
    reveal.stop();
  });

  it('a new game mid-spin stops the clock: nothing lands on the new board', () => {
    vi.useFakeTimers();
    const store = createStore<SessionState, Action, SessionEvent>(roulette(), step);
    const reveal = createReveal(store);
    store.dispatch({ type: 'spinStart', now: Date.now(), manual: true });
    vi.advanceTimersByTime(500);
    store.dispatch({ type: 'newGame', initial: createStartingPosition(9), now: Date.now() });
    vi.advanceTimersByTime(3000);
    expect(store.getState().roulette.bag).toBeNull();
    expect(store.getState().roulette.reveal).toBeNull();
    reveal.stop();
  });
});

describe('the turn waits for the bag (players/turns.ts)', () => {
  it('the bot is not asked while its bag lands, and is once it has', async () => {
    vi.useFakeTimers();
    const store = createStore<SessionState, Action, SessionEvent>(roulette(), step);
    const asked: Array<boolean> = [];
    const bot: Player = {
      color: 'white',
      kind: 'bot',
      onTurn: (s) => {
        asked.push(revealOf(s) !== null);
        return s.roulette.bag === null
          ? Promise.resolve({ type: 'botSpin', now: Date.now() })
          : new Promise<Action>(() => {});
      },
    };
    const turns = createTurns(store);
    const reveal = createReveal(store);
    turns.seat({ white: bot, black: bot });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([false]); // asked to spin
    await vi.advanceTimersByTimeAsync(REVEAL_SLOT_MS * 4 + REVEAL_SETTLE_MS - 1);
    expect(asked).toEqual([false]); // not asked again while it landed
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual([false, false]); // asked with its bag
    turns.stop();
    reveal.stop();
    vi.useRealTimers();
  });
});

describe('online: a fresh bag lands on both screens (follow)', () => {
  const doc = (slots: string[] | null) =>
    ({
      code: 'ABC123',
      chess960Id: 'RNBQKBNR',
      seed: 38,
      host: { uid: 'me', color: 'white', displayName: 'Me' },
      guest: { uid: 'them', color: 'black', displayName: 'Them' },
      status: 'active',
      currentTurn: 'me',
      log: { initialTopology: 'A', moves: [] },
      outcome: null,
      gameMode: 'roulette',
      rouletteSlots: slots,
      rouletteActionsLeft: slots ? 2 : 0,
      usedRouletteSlots: [],
    }) as unknown as MatchDoc;
  const solo = () => createSession({ initial: createStartingPosition(5), seed: 5, now: 0 });
  const bag = ['knight', 'pawn', 'pawn', 'rook'];

  it('a bag that arrives where there was none lands; one there at join does not', () => {
    const joined = step(solo(), { type: 'follow', doc: doc(bag), myUid: 'me', now: 1 }).state;
    expect(joined.online?.reveal).toBeNull();
    const empty = step(solo(), { type: 'follow', doc: doc(null), myUid: 'me', now: 1 }).state;
    const fresh = step(empty, { type: 'follow', doc: doc(bag), myUid: 'me', now: 2 }).state;
    expect(fresh.online?.reveal).toMatchObject({ since: 2, shown: 0, of: 'online', slots: bag });
    // The next snapshot keeps the reveal under way.
    const again = step(fresh, { type: 'follow', doc: doc(bag), myUid: 'me', now: 3 }).state;
    expect(again.online?.reveal).toBe(fresh.online?.reveal);
    const { s, events } = run(again, [...slots4(2), { type: 'spinLand', since: 2 }]);
    expect(events.filter((e) => e.type === 'rouletteSlot')).toHaveLength(4);
    expect(s.online?.reveal).toBeNull();
  });
});
