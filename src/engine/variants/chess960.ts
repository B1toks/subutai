import { createEmptyBoardState, makePiece } from '../board';
import type { BoardState } from '../types';

function randomInt(maxExclusive: number, seed: { value: number }): number {
  const x = Math.sin(seed.value++) * 10000;
  return Math.floor((x - Math.floor(x)) * maxExclusive);
}

export function chess960BackRank(seedNumber = 1): BoardState {
  const seed = { value: seedNumber };
  const files = ['a','b','c','d','e','f','g','h'] as const;

  const bishops: number[] = [];
  const darkSquares = [1, 3, 5, 7];
  const lightSquares = [0, 2, 4, 6];

  const darkIndex = darkSquares[randomInt(darkSquares.length, seed)];
  bishops.push(darkIndex);
  const lightIndex = lightSquares[randomInt(lightSquares.length, seed)];
  bishops.push(lightIndex);

  const occupied = new Set(bishops);

  const queenCandidates = files
    .map((_, idx) => idx)
    .filter((idx) => !occupied.has(idx));
  const queenIndex =
    queenCandidates[randomInt(queenCandidates.length, seed)];
  occupied.add(queenIndex);

  const knightCandidates = files
    .map((_, idx) => idx)
    .filter((idx) => !occupied.has(idx));
  const knightIndexes: number[] = [];
  for (let i = 0; i < 2; i++) {
    const idx =
      knightCandidates[randomInt(knightCandidates.length - i, seed)];
    knightIndexes.push(knightCandidates[idx]);
    knightCandidates.splice(idx, 1);
  }
  knightIndexes.forEach((idx) => occupied.add(idx));

  const rookKingCandidates = files
    .map((_, idx) => idx)
    .filter((idx) => !occupied.has(idx))
    .sort((a, b) => a - b);

  const rook1 = rookKingCandidates[0];
  const king = rookKingCandidates[1];
  const rook2 = rookKingCandidates[2];

  const state = createEmptyBoardState('white');
  const pieces = new Map(state.pieces);

  files.forEach((file, index) => {
    let type: 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
    if (index === bishops[0] || index === bishops[1]) {
      type = 'bishop';
    } else if (index === queenIndex) {
      type = 'queen';
    } else if (index === rook1 || index === rook2) {
      type = 'rook';
    } else if (index === king) {
      type = 'king';
    } else {
      type = 'knight';
    }

    pieces.set(
      `${file}1`,
      makePiece('white', type),
    );
    pieces.set(
      `${file}2`,
      makePiece('white', 'pawn'),
    );
    pieces.set(
      `${file}7`,
      makePiece('black', 'pawn'),
    );
    pieces.set(
      `${file}8`,
      makePiece('black', type),
    );
  });

  return {
    ...state,
    pieces,
  };
}
