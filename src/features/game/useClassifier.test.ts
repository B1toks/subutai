import { describe, expect, it, vi } from 'vitest';
import type { MoveAnalysis } from '../../analysis/classify';
import { createStartingPosition } from '../../engine';
import { applyMove } from '../../engine/moves';
import { appendMove, computeSAN } from '../../recording/log';
import { session } from '../../session/session';

// The hook runs here outside React: its state and effects are inert, its
// callbacks are the plain functions. What is checked is what it writes to
// the session.
vi.mock('react', () => ({
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock('../../analysis/classifyClient', () => ({ classifyAsync: () => new Promise(() => {}) }));

const { useClassifier } = await import('./useClassifier');

const verdict: MoveAnalysis = { classification: 'blunder', cpl: 400, searchScoreFromWhite: -350 };

function useHookOutsideReact() {
  const noop = () => {};
  return useClassifier({
    verdicts: {
      setClassifiedSquare: noop,
      classifyTimerRef: { current: null },
      setSacrificeSquare: noop,
      sacrificeTimerRef: { current: null },
    } as never,
    setSearchEvalFromWhite: noop,
    setSearchMateInPlies: noop,
    shellRef: { current: null },
    // Not the latest move any more: no visuals, only what goes in the log.
    logLengthRef: { current: 99 },
    logIdRef: { current: '' },
    classifyRunRef: { current: 0 },
  });
}

/** A game on the board with one move played; its log id. */
function playOneMove(seed: number): string {
  session.dispatch({ type: 'newGame', initial: createStartingPosition(seed), now: seed, seed });
  const s = session.getState();
  const move = s.legal.find((m) => m.kind === 'normal')!;
  session.dispatch({ type: 'move', move, actor: 'human', now: seed });
  return session.getState().log.id;
}

describe('commitAnalysis (P3: a verdict belongs to the game its move was played in)', () => {
  it('writes the verdict into the game the move was played in', () => {
    const id = playOneMove(11);
    useHookOutsideReact().commitAnalysis(0, verdict, 'e4', id);
    expect(session.getState().log.moves[0].analysis?.classification).toBe('blunder');
  });

  it('drops it when another game of the same length is on the board by then', () => {
    const id = playOneMove(12);
    // Another game with a move of its own (a Memory resume, Load replay).
    const initial = createStartingPosition(13);
    session.dispatch({ type: 'newGame', initial, now: 13, seed: 13 });
    const first = session.getState().legal.find((m) => m.kind === 'normal')!;
    const board = applyMove(initial, first);
    const log = appendMove(
      { ...session.getState().log, id: 'resumed-game' },
      first,
      computeSAN(initial, first),
      initial.topologyState,
      undefined,
      13,
    );
    session.dispatch({ type: 'load', game: { board, initial, log }, fresh: true });
    expect(session.getState().log.id).not.toBe(id);
    useHookOutsideReact().commitAnalysis(0, verdict, 'e4', id);
    expect(session.getState().log.moves[0].analysis).toBeUndefined();
  });
});
