import { describe, expect, it } from 'vitest';
import { createStartingPosition } from '../../engine';
import { createStore } from '../store';
import { createSession, step } from '../step';
import type { Action, SessionEvent, SessionState } from '../types';
import { createHumanPlayer, humanPlayers } from './human';
import { createTurns } from './turns';
import type { Player } from './types';

const SEED = 7;
const newStore = () =>
  createStore<SessionState, Action, SessionEvent>(
    createSession({ initial: createStartingPosition(SEED), seed: SEED, now: 0 }),
    step,
  );
const flush = () => new Promise((r) => setTimeout(r, 0));
const firstMove = (s: SessionState): Action => ({ type: 'move', move: s.legal.find((m) => m.kind !== 'topologyToggle')!, actor: 'bot', now: 0 });

/** A player that answers each turn with the first legal move, and keeps a diary. */
function scripted(color: 'white' | 'black', diary: string[]): Player {
  return {
    color,
    kind: 'bot',
    onTurn: (s, signal) => {
      diary.push(`${color} asked at ${s.log.moves.length}`);
      signal.addEventListener('abort', () => diary.push(`${color} aborted at ${s.log.moves.length}`));
      return Promise.resolve(firstMove(s));
    },
    onPlayed: (_a, events) => diary.push(`${color} played: ${events.map((e) => e.type).join(',')}`),
  };
}

describe('turns', () => {
  it('asks the seated side to move and runs its answer', async () => {
    const store = newStore();
    const turns = createTurns(store);
    const diary: string[] = [];
    turns.seat({ white: scripted('white', diary), black: scripted('black', diary) });
    for (let i = 0; i < 6; i++) await flush();
    turns.stop();
    expect(store.getState().log.moves.length).toBeGreaterThanOrEqual(4);
    expect(diary.slice(0, 4)).toEqual(['white asked at 0', 'black asked at 1', 'white played: move', 'white asked at 2']);
  });

  it('an answer that comes after the turn ended is dropped', async () => {
    const store = newStore();
    const turns = createTurns(store);
    let answer: (a: Action) => void = () => {};
    const slow: Player = { color: 'white', kind: 'bot', onTurn: () => new Promise((r) => { answer = r; }) };
    turns.seat({ white: slow, black: null });
    const asked = store.getState();
    store.dispatch({ type: 'resign', side: 'white' });
    answer(firstMove(asked));
    await flush();
    expect(store.getState().log.moves.length).toBe(0);
    expect(store.getState().phase.tag).toBe('ended');
  });

  it('a clock tick is not a new turn; a new seat is', async () => {
    const store = newStore();
    store.dispatch({ type: 'setTimeControl', sec: 60 });
    const turns = createTurns(store);
    const diary: string[] = [];
    const never = (name: string): Player => ({
      color: 'white',
      kind: 'bot',
      onTurn: (_s, signal) => {
        diary.push(`${name} asked`);
        signal.addEventListener('abort', () => diary.push(`${name} aborted`));
        return new Promise(() => {});
      },
    });
    const a = never('a');
    turns.seat({ white: a, black: null });
    store.dispatch({ type: 'clockTick', dt: 1000 });
    turns.seat({ white: a, black: null });
    turns.seat({ white: never('b'), black: null });
    turns.seat(null);
    expect(diary).toEqual(['a asked', 'a aborted', 'b asked', 'b aborted']);
  });

  it('a refused answer is not asked again for the same turn', async () => {
    const store = newStore();
    const turns = createTurns(store);
    let asked = 0;
    const wrong: Player = {
      color: 'white',
      kind: 'bot',
      onTurn: () => {
        asked++;
        return Promise.resolve({ type: 'move', move: { kind: 'normal', from: 'a1', to: 'h8' }, actor: 'bot', now: 0 } as Action);
      },
    };
    turns.seat({ white: wrong, black: null });
    await flush();
    store.dispatch({ type: 'setTimeControl', sec: 60 }); // the state changes, the turn does not
    await flush();
    turns.stop();
    expect(asked).toBe(1);
    expect(store.getState().log.moves.length).toBe(0);
  });

  it('act runs a human seat\'s action at once, and refuses it for anyone else', () => {
    const store = newStore();
    const turns = createTurns(store);
    turns.seat({ white: createHumanPlayer('white'), black: null });
    const move = firstMove(store.getState());
    const events = turns.act(move);
    expect(events.map((e) => e.type)).toContain('move');
    expect(store.getState().log.moves.length).toBe(1);
    // Black's turn: nobody here plays black.
    expect(turns.act(firstMove(store.getState()))).toEqual([]);
    expect(store.getState().log.moves.length).toBe(1);
    turns.seat(humanPlayers);
    expect(turns.act(firstMove(store.getState())).length).toBeGreaterThan(0);
    expect(store.getState().log.moves.length).toBe(2);
    turns.stop();
    expect(turns.act(firstMove(store.getState()))).toEqual([]);
  });
});
