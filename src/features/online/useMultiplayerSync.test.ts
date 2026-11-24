import { describe, expect, it, vi } from 'vitest';
import type { MatchDoc } from '../../firebase/matches';
import { session } from '../../session/session';

// The hook runs here outside React: state and effects are inert, a memo
// is computed on the spot. What is counted is how often the board is
// rebuilt from the match's log for one snapshot.
vi.mock('react', () => ({
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
vi.mock('firebase/firestore', () => ({}));
vi.mock('../../firebase/client', () => ({ db: null }));
vi.mock('../../infra/firestore/matches', () => ({ matchesRepo: {} }));
vi.mock('../../firebase/serverClock', () => ({
  noteOwnWriteSeen: () => {},
  noteServerStampSeen: () => {},
  serverNow: () => 0,
  takeJoinSent: () => null,
}));
vi.mock('../../firebase/clockProbe', () => ({ startClockProbes: () => () => {} }));
const rebuilt = vi.hoisted(() => ({ count: 0 }));
vi.mock('./matchLog', async (importOriginal) => {
  const real = await importOriginal<typeof import('./matchLog')>();
  return {
    ...real,
    rebuildBoardFromMatch: (doc: MatchDoc) => {
      rebuilt.count++;
      return real.rebuildBoardFromMatch(doc);
    },
  };
});

const { useMultiplayerSync } = await import('./useMultiplayerSync');

const host = { uid: 'me', color: 'white', displayName: 'Me' };
const guest = { uid: 'them', color: 'black', displayName: 'Them' };
const e4 = { san: 'e2→e4', move: { kind: 'normal', from: 'e2', to: 'e4' }, topology: 'A', timestamp: 1_000 } as const;
const match = {
  code: 'ABC123',
  chess960Id: 'RNBQKBNR',
  seed: 38,
  host,
  guest,
  status: 'active',
  currentTurn: 'them',
  log: { initialTopology: 'A', moves: [e4] },
  outcome: null,
} as unknown as MatchDoc;

describe('useMultiplayerSync (R2: one board per snapshot)', () => {
  it('takes the board the session built from the snapshot instead of replaying the log again', () => {
    session.dispatch({ type: 'follow', doc: match, myUid: 'me', now: 9 });
    const built = session.getState().online?.game?.base;
    expect(built).toBeTruthy();
    rebuilt.count = 0;
    const sync = useMultiplayerSync(match, 'me', () => {});
    expect(sync?.boardState).toBe(built);
    expect(rebuilt.count).toBe(0);
  });
});
