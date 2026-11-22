import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMove } from '../../engine/moves';
import { replayFromNotation } from '../../memory/replayImport';
import { legalMovesFor } from '../rules';
import { createStore } from '../store';
import { createSession, statusOf, step } from '../step';
import type { Action, SessionEvent, SessionState } from '../types';
import { createBotPlayer } from './bot';

// The engine's choice is fixed here: the mate the position has.
const chosen = vi.hoisted(() => ({ move: null as unknown }));
vi.mock('../../ai/searchClient', () => ({
  chooseBotMove: () => Promise.resolve(chosen.move),
  searchAsync: () => Promise.reject(new Error('not used')),
}));

// White to move; after Ng1-e2 Black mates with Nd4-f3 (no rotation
// escapes it under the app's rules).
const LINE = '[Chess960 "RNBQKBNR"]\n[Seed "7"]\n\n1. Nb1→a3  f7→f5\n2. g2→g4  Nb8→c6\n3. Na3→b1  a7→a6\n4. e2→e3  Nc6→d4';

function blackToMate(): SessionState {
  const { final } = replayFromNotation(LINE);
  const human = legalMovesFor('classic', final).find((m) => m.from === 'g1' && m.to === 'e2')!;
  const board = applyMove(final, human);
  const s = createSession({ initial: board, seed: 7, now: 0 });
  return { ...s, phase: { tag: 'playing' } } as SessionState;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bot whose move the classifier cannot judge', () => {
  it('still ends the game it has mated (the verdict is skipped)', async () => {
    vi.useFakeTimers();
    const store = createStore<SessionState, Action, SessionEvent>(blackToMate(), step);
    const s = store.getState();
    chosen.move = s.legal.find((m) => m.from === 'd4' && m.to === 'f3');
    expect(chosen.move).toBeTruthy();
    const analysed: number[] = [];
    const bot = createBotPlayer({
      color: 'black',
      dispatch: store.dispatch,
      strength: () => 'strong',
      vote: (_b, _l, m) => Promise.resolve(m),
      analyse: (_b, _m, _a, index) => {
        analysed.push(index);
        return Promise.reject(new Error('classifier worker failed'));
      },
      moved: () => {},
    });
    const answer = bot.onTurn(s, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    const action = await answer;
    expect(action.type).toBe('move');
    store.dispatch(action);
    expect(statusOf(store.getState())).toBe('active');
    bot.onPlayed?.(action, []);
    await vi.advanceTimersByTimeAsync(0);
    expect(analysed).toEqual([0]);
    expect(statusOf(store.getState())).toBe('checkmate');
  });
});
