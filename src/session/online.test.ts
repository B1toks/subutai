import { describe, expect, it } from 'vitest';
import { createStartingPosition } from '../engine';
import type { MatchDoc } from '../firebase/matches';
import { createSession, step } from './step';
import type { SessionState } from './types';

const host = { uid: 'me', color: 'white', displayName: 'Me' };
const guest = { uid: 'them', color: 'black', displayName: 'Them' };
const e4 = { san: 'e2→e4', move: { kind: 'normal', from: 'e2', to: 'e4' }, topology: 'A', timestamp: 1_000 } as const;
const e5 = { san: 'e7→e5', move: { kind: 'normal', from: 'e7', to: 'e5' }, topology: 'A', timestamp: 2_000 } as const;

// The fields a match on the board is read from; the rest does not matter here.
const match = (moves: MatchDoc['log']['moves'], extra: Partial<MatchDoc> = {}) =>
  ({
    code: 'ABC123',
    chess960Id: 'RNBQKBNR',
    seed: 38,
    host,
    guest,
    status: 'active',
    currentTurn: moves.length % 2 === 0 ? 'me' : 'them',
    log: { initialTopology: 'A', moves },
    outcome: null,
    ...extra,
  }) as unknown as MatchDoc;

const solo = (): SessionState => createSession({ initial: createStartingPosition(5), seed: 5, now: 0 });
const follow = (s: SessionState, doc: MatchDoc | null, myUid: string | null = 'me') =>
  step(s, { type: 'follow', doc, myUid, now: 9 });

describe('follow', () => {
  it('a move appended in the same match plays out as a remote move; the first read plays nothing', () => {
    const on = follow(solo(), match([e4]));
    expect(on.events).toEqual([]);
    expect(on.state.online?.game?.log.moves.length).toBe(1);
    const next = follow(on.state, match([e4, e5]));
    expect(next.events[0]).toMatchObject({ type: 'move', actor: 'remote', by: 'black', index: 1, san: 'e7→e5' });
    // Read again unchanged: nothing new.
    expect(follow(next.state, match([e4, e5])).events).toEqual([]);
  });

  it('another match replacing this one plays nothing', () => {
    const on = follow(solo(), match([e4])).state;
    expect(follow(on, match([e4, e5], { code: 'XYZ789' })).events).toEqual([]);
  });

  it('leaves the solo game alone, and gives it back when the match goes', () => {
    const before = solo();
    const on = follow(before, match([e4, e5])).state;
    expect(on.board).toBe(before.board);
    expect(on.log).toBe(before.log);
    expect(on.phase).toBe(before.phase);
    const off = follow(on, null);
    expect(off.state.online).toBeNull();
    expect(off.events).toEqual([]);
    expect(follow(off.state, null).state).toBe(off.state);
  });

  it('nobody signed in: the document is kept, no game is made of it', () => {
    const on = follow(solo(), match([e4]), null).state;
    expect(on.online?.doc.code).toBe('ABC123');
    expect(on.online?.game).toBeNull();
  });

  it('roulette: my colour stays to move while my turn has actions left', () => {
    const doc = match([e4], {
      gameMode: 'roulette',
      currentTurn: 'me',
      rouletteSlots: ['pawn', 'knight', 'pawn', 'rook'],
      rouletteActionsLeft: 1,
      usedRouletteSlots: [0],
      rouletteSpinsByPlayer: { me: 1 },
    });
    const g = follow(solo(), doc).state.online!.game!;
    expect(g.base.sideToMove).toBe('black');
    expect(g.board.sideToMove).toBe('white');
    expect(g.mode).toBe('roulette');
    expect(g.slots).toEqual(['pawn', 'knight', 'pawn', 'rook']);
    expect(g.actionsLeft).toBe(1);
    expect(g.used).toEqual([0]);
    expect(g.firstSpinDone).toBe(true);
    expect(g.legal.every((m) => !m.from || g.board.pieces[m.from]?.color === 'white')).toBe(true);
  });

  it('classic: no Roulette strip, and the log is stamped with the read time', () => {
    const g = follow(solo(), match([e4])).state.online!.game!;
    expect(g.mode).toBe('classic');
    expect(g.slots).toBeNull();
    expect(g.actionsLeft).toBe(0);
    expect(g.used).toEqual([]);
    expect(g.firstSpinDone).toBe(false);
    expect(g.log.createdAt).toBe(new Date(9).toISOString());
    expect(g.lastMove).toEqual({ from: 'e2', to: 'e4' });
  });
});
