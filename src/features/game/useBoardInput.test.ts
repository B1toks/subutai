import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStartingPosition, type BoardState } from '../../engine';
import { createGameLog } from '../../recording/log';
import { legalMovesFor } from '../../session/rules';
import { humanPlayers } from '../../session/players/human';
import { session, turns } from '../../session/session';

// The hook runs here outside React: what is checked is what a promotion
// sets off, after the session has refused it.
vi.mock('react', () => ({
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
const seen = vi.hoisted(() => ({ classified: 0 }));
vi.mock('../../analysis/classifyClient', () => ({
  classifyAsync: () => {
    seen.classified++;
    return new Promise(() => {});
  },
}));
vi.mock('../../integrations', () => ({ streaming: () => null }));

const { useBoardInput } = await import('./useBoardInput');

/** White's a-pawn on a7 with a8 empty: a7-a8 promotes. */
function promotionBoard(): BoardState {
  const b = createStartingPosition(7);
  const pieces = { ...b.pieces };
  const pawn = pieces.a2;
  delete pieces.a2;
  delete pieces.a7;
  delete pieces.a8;
  pieces.a7 = pawn;
  return { ...b, pieces };
}

function useInputOutsideReact(settled: string[], evals: unknown[]) {
  return useBoardInput({
    ui: {
      selected: null,
      setSelected: () => {},
      setMpPendingPromotion: () => {},
      beatSnapPendingRef: { current: false },
      setBeatSnap: () => {},
      annotationStartRef: { current: null },
      setSquareAnnotations: () => {},
      setArrowAnnotations: () => {},
    } as never,
    isMultiplayer: false,
    mpSync: null,
    isLocalMode: false,
    watchingGame: null,
    currentPlayer: 'human',
    getLegalMoves: (s) => legalMovesFor('classic', s),
    pendingPromotion: { from: 'a7', to: 'a8' },
    layout: {} as never,
    displayTopology: {} as never,
    commitAnalysis: () => {},
    settleGuessRound: (_m, san) => settled.push(san),
    setSearchEvalFromWhite: (v) => evals.push(v),
    setSearchMateInPlies: () => {},
  });
}

beforeEach(() => {
  seen.classified = 0;
  turns.seat(humanPlayers);
  const board = promotionBoard();
  session.dispatch({
    type: 'load',
    game: { board, initial: board, log: createGameLog('p5-game', board, 5, 5), status: 'active' },
    fresh: true,
  });
  expect(session.getState().legal.some((m) => m.from === 'a7' && m.kind === 'promotion')).toBe(true);
  session.dispatch({ type: 'requestPromotion', from: 'a7', to: 'a8' });
  expect(session.getState().phase.tag).toBe('promotion');
});

describe('a move the session refuses sets nothing off (P5)', () => {
  it('a promotion picked after the flag fell: no guess round, no eval bump, no classifier', () => {
    session.dispatch({ type: 'flag', side: 'white' });
    expect(session.getState().phase.tag).toBe('ended');
    const settled: string[] = [];
    const evals: unknown[] = [];
    useInputOutsideReact(settled, evals).handlePromotion('queen');
    expect(session.getState().log.moves).toHaveLength(0);
    expect(settled).toEqual([]);
    expect(evals).toEqual([]);
    expect(seen.classified).toBe(0);
  });

  it('a promotion the session takes sets all of it off, as before', () => {
    const settled: string[] = [];
    const evals: unknown[] = [];
    useInputOutsideReact(settled, evals).handlePromotion('queen');
    expect(session.getState().log.moves).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(evals).toHaveLength(1);
    expect(seen.classified).toBe(1);
  });
});
