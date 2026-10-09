import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey } from '../../engine';
import type { MatchDoc } from '../../firebase/matches';
import { samePieces } from '../game/position';
import { deriveMpLastMove, deriveMpLog } from './matchLog';

// Only the fields these two read; the rest of a match does not matter here.
const match = (moves: MatchDoc['log']['moves']) =>
  ({ code: 'ABC123', chess960Id: 'QRKRNBBN', seed: 38, log: { initialTopology: 'A', moves } }) as MatchDoc;

const e4 = { san: 'e4', move: { kind: 'normal', from: 'e2', to: 'e4' }, topology: 'A', timestamp: 1_000 } as const;
const rotate = { san: 'A→B', move: { kind: 'topologyToggle' }, topology: 'A', timestamp: 2_000 } as const;

describe('deriveMpLog', () => {
  it('turns the match into a log the board code can play', () => {
    const log = deriveMpLog(match([e4, rotate]));
    expect(log.id).toBe('mp-ABC123');
    expect(log.randomSeed).toBe(38);
    expect(log.initialTopology).toBe('A');
    expect(samePieces(log.initialState.pieces, createPositionFromBackRankKey('QRKRNBBN').pieces)).toBe(true);
    expect(log.moves).toEqual([e4, rotate]);
  });
});

describe('deriveMpLastMove', () => {
  it('highlights the last move, and nothing after a rotation or before the first move', () => {
    expect(deriveMpLastMove(match([e4]))).toEqual({ from: 'e2', to: 'e4' });
    expect(deriveMpLastMove(match([e4, rotate]))).toBeNull();
    expect(deriveMpLastMove(match([]))).toBeNull();
  });
});
