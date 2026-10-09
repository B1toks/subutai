import { describe, expect, it } from 'vitest';
import { createPositionFromBackRankKey, type BoardState, type Move, type Piece, type SquareId } from '../../engine';
import {
  ROULETTE_SLOT_COUNT,
  consumeSlotIndex,
  getActivePieceTypes,
  isPieceMovableInRoulette,
  pickAiRouletteMove,
  spinRoulette,
} from './roulette';

const start = createPositionFromBackRankKey('RNBQKBNR');

function withPieces(pieces: Partial<Record<SquareId, Piece>>): BoardState {
  return { ...start, pieces };
}
const piece = (color: Piece['color'], type: Piece['type']): Piece => ({ id: `${color}-${type}`, color, type });
/** Hands out the given values in turn, like Math.random would. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('isPieceMovableInRoulette', () => {
  it('never restricts classic', () => {
    expect(isPieceMovableInRoulette('queen', start, 'classic', null, [])).toBe(true);
  });
  it('locks the board before the spin', () => {
    expect(isPieceMovableInRoulette('pawn', start, 'roulette', null, [])).toBe(false);
  });
  it('lets a piece move while its type has an unused slot', () => {
    const bag = ['pawn', 'knight', 'pawn', 'rook'] as const;
    expect(isPieceMovableInRoulette('pawn', start, 'roulette', [...bag], [0])).toBe(true);
    expect(isPieceMovableInRoulette('pawn', start, 'roulette', [...bag], [0, 2])).toBe(false);
    expect(isPieceMovableInRoulette('queen', start, 'roulette', [...bag], [])).toBe(false);
  });
});

describe('getActivePieceTypes', () => {
  it('lists each type the side still has, once', () => {
    expect(getActivePieceTypes(start, 'white').sort()).toEqual(['bishop', 'king', 'knight', 'pawn', 'queen', 'rook']);
    const bare = withPieces({ e1: piece('white', 'king'), a2: piece('white', 'pawn'), e8: piece('black', 'king') });
    expect(getActivePieceTypes(bare, 'white').sort()).toEqual(['king', 'pawn']);
  });
});

describe('spinRoulette', () => {
  it('rolls nothing for a side with no pieces', () => {
    expect(spinRoulette([])).toEqual([]);
  });
  it('fills every slot from the pool', () => {
    const bag = spinRoulette(['rook', 'king'], false, sequence(0, 0.99, 0.5, 0.1));
    expect(bag).toHaveLength(ROULETTE_SLOT_COUNT);
    expect(bag).toEqual(['rook', 'king', 'king', 'rook']);
  });
  it('adds one extra pawn to the pool while the boost is on', () => {
    // pool [knight, pawn] + pawn: the top of the range lands on the extra pawn
    expect(spinRoulette(['knight', 'pawn'], true, sequence(0.99))).toEqual(['pawn', 'pawn', 'pawn', 'pawn']);
    expect(spinRoulette(['knight', 'pawn'], true, sequence(0))).toEqual(['knight', 'knight', 'knight', 'knight']);
  });
  it('boosts nothing when the side has no pawns', () => {
    expect(spinRoulette(['knight', 'rook'], true, sequence(0.99))).toEqual(['rook', 'rook', 'rook', 'rook']);
  });
});

describe('consumeSlotIndex', () => {
  it('takes the first unused slot of the mover type', () => {
    expect(consumeSlotIndex(['pawn', 'knight', 'pawn', 'rook'], [], 'pawn')).toBe(0);
    expect(consumeSlotIndex(['pawn', 'knight', 'pawn', 'rook'], [0], 'pawn')).toBe(2);
    expect(consumeSlotIndex(['pawn', 'knight', 'pawn', 'rook'], [0, 2], 'pawn')).toBe(-1);
  });
});

describe('pickAiRouletteMove', () => {
  const board = withPieces({
    e1: piece('white', 'king'),
    d1: piece('white', 'queen'),
    e8: piece('black', 'king'),
    d8: piece('black', 'queen'),
    a7: piece('black', 'pawn'),
  });
  const quiet: Move = { kind: 'normal', from: 'e1', to: 'f1' };
  const takePawn: Move = { kind: 'capture', from: 'd1', to: 'a7' };
  const takeQueen: Move = { kind: 'capture', from: 'd1', to: 'd8' };
  const takeKing: Move = { kind: 'capture', from: 'd1', to: 'e8' };

  it('takes the king when it can', () => {
    expect(pickAiRouletteMove(board, [quiet, takeQueen, takeKing])).toBe(takeKing);
  });
  it('otherwise takes the most valuable piece', () => {
    expect(pickAiRouletteMove(board, [takePawn, quiet, takeQueen])).toBe(takeQueen);
  });
  it('otherwise picks at random', () => {
    const other: Move = { kind: 'normal', from: 'e1', to: 'f2' };
    expect(pickAiRouletteMove(board, [quiet, other], sequence(0.7))).toBe(other);
  });
});
