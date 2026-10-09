import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey, type Piece, type SquareId } from '../../engine';
import { PIECE_VALUE } from '../../ai/evaluate';
import { countMaterial } from './material';

const start = createPositionFromBackRankKey('RNBQKBNR');
const without = (...squares: SquareId[]) => {
  const pieces: Partial<Record<SquareId, Piece>> = { ...start.pieces };
  for (const sq of squares) delete pieces[sq];
  return pieces;
};

describe('countMaterial', () => {
  it('is level with nothing taken at the start', () => {
    const m = countMaterial(start.pieces);
    expect(m.score).toBe(0);
    expect(m.capturedByWhite).toEqual([]);
    expect(m.capturedByBlack).toEqual([]);
    expect(m.whiteTotal).toBe(m.blackTotal);
  });
  it('lists what each side took, most valuable first', () => {
    const m = countMaterial(without('d8', 'a7', 'b7', 'g1'));
    expect(m.capturedByWhite).toEqual([
      { type: 'queen', count: 1, value: PIECE_VALUE.queen },
      { type: 'pawn', count: 2, value: 2 * PIECE_VALUE.pawn },
    ]);
    expect(m.capturedByBlack).toEqual([{ type: 'knight', count: 1, value: PIECE_VALUE.knight }]);
    expect(m.capturedByWhiteTotal).toBe(PIECE_VALUE.queen + 2 * PIECE_VALUE.pawn);
    expect(m.score).toBe(PIECE_VALUE.queen + 2 * PIECE_VALUE.pawn - PIECE_VALUE.knight);
  });
  it('never counts more pieces taken than a side started with', () => {
    // A promoted second queen: White is not "missing" a negative queen.
    const pieces = { ...without('a2'), a8: { id: 'q2', color: 'white', type: 'queen' } as Piece };
    const m = countMaterial(pieces);
    expect(m.capturedByBlack).toEqual([{ type: 'pawn', count: 1, value: PIECE_VALUE.pawn }]);
  });
});
