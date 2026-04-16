import { createEmptyBoardState, makePiece } from '../board';
import type { BoardState, Piece, PieceType, SquareId } from '../types';

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
  const pieces: Record<string, Piece> = { ...state.pieces } as Record<string, Piece>;

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

    pieces[`${file}1`] = makePiece('white', type);
    pieces[`${file}2`] = makePiece('white', 'pawn');
    pieces[`${file}7`] = makePiece('black', 'pawn');
    pieces[`${file}8`] = makePiece('black', type);
  });

  const queenRookFile = Math.min(rook1, rook2);
  const kingRookFile = Math.max(rook1, rook2);
  return {
    ...state,
    pieces,
    castlingRights: {
      whiteQueenSide: `${files[queenRookFile]}1` as SquareId,
      whiteKingSide: `${files[kingRookFile]}1` as SquareId,
      blackQueenSide: `${files[queenRookFile]}8` as SquareId,
      blackKingSide: `${files[kingRookFile]}8` as SquareId,
    },
    kingStartSquares: {
      white: `${files[king]}1` as SquareId,
      black: `${files[king]}8` as SquareId,
    },
  };
}

export function isValidChess960Key(key: string): boolean {
  if (key.length !== 8) return false;
  const counts = { R: 0, N: 0, B: 0, Q: 0, K: 0 };
  const valid = new Set(['R', 'N', 'B', 'Q', 'K']);
  for (const ch of key) {
    if (!valid.has(ch)) return false;
    counts[ch as keyof typeof counts]++;
  }
  if (counts.R !== 2 || counts.N !== 2 || counts.B !== 2 || counts.Q !== 1 || counts.K !== 1) return false;
  const bishops = key.split('').map((c, i) => (c === 'B' ? i : -1)).filter((i) => i >= 0);
  if ((bishops[0]! % 2) === (bishops[1]! % 2)) return false;
  const rookKing = key.split('').map((c, i) => (c === 'R' || c === 'K' ? [c, i] as const : null)).filter(Boolean) as [string, number][];
  const order = rookKing.map(([c]) => c).join('');
  if (order !== 'RKR') return false;
  return true;
}

export function chess960FromBackRankKey(key: string): BoardState {
  if (!isValidChess960Key(key)) {
    throw new Error(`Invalid Chess960 key: "${key}"`);
  }
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
  const state = createEmptyBoardState('white');
  const pieces: Record<string, Piece> = { ...state.pieces } as Record<string, Piece>;

  const charToType = (ch: string): PieceType => {
    switch (ch) {
      case 'R': return 'rook';
      case 'N': return 'knight';
      case 'B': return 'bishop';
      case 'Q': return 'queen';
      case 'K': return 'king';
      default: return 'rook';
    }
  };

  files.forEach((file, index) => {
    const letter = key[index]!;
    const type = charToType(letter);
    pieces[`${file}1`] = makePiece('white', type);
    pieces[`${file}2`] = makePiece('white', 'pawn');
    pieces[`${file}7`] = makePiece('black', 'pawn');
    pieces[`${file}8`] = makePiece('black', type);
  });

  const rookFiles: number[] = [];
  let kingFile = -1;
  for (let i = 0; i < 8; i++) {
    if (key[i] === 'R') rookFiles.push(i);
    if (key[i] === 'K') kingFile = i;
  }
  const queenRookFile = Math.min(rookFiles[0]!, rookFiles[1]!);
  const kingRookFile = Math.max(rookFiles[0]!, rookFiles[1]!);

  return {
    ...state,
    pieces,
    castlingRights: {
      whiteQueenSide: `${files[queenRookFile]}1` as SquareId,
      whiteKingSide: `${files[kingRookFile]}1` as SquareId,
      blackQueenSide: `${files[queenRookFile]}8` as SquareId,
      blackKingSide: `${files[kingRookFile]}8` as SquareId,
    },
    kingStartSquares: {
      white: `${files[kingFile]}1` as SquareId,
      black: `${files[kingFile]}8` as SquareId,
    },
  };
}
