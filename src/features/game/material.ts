import type { BoardState, PieceType } from '../../engine';
import { PIECE_VALUE } from '../../ai/evaluate';

export interface CapturedGroup {
  type: PieceType;
  count: number;
  value: number;
}

export interface MaterialBreakdown {
  /** White's material minus Black's. */
  score: number;
  capturedByWhite: CapturedGroup[];
  capturedByBlack: CapturedGroup[];
  capturedByWhiteTotal: number;
  capturedByBlackTotal: number;
  whiteTotal: number;
  blackTotal: number;
}

/** The material score and what each side has taken, counted against a full
 *  starting set (so a promotion can make a side "lose" fewer pawns). */
export function countMaterial(pieces: BoardState['pieces']): MaterialBreakdown {
  const pieceOrder: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
  const white: Record<PieceType, number> = {
    queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
  };
  const black: Record<PieceType, number> = {
    queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
  };
  let whiteTotal = 0;
  let blackTotal = 0;
  for (const piece of Object.values(pieces)) {
    if (!piece) continue;
    const v = PIECE_VALUE[piece.type];
    if (piece.color === 'white') {
      white[piece.type]++;
      whiteTotal += v;
    } else {
      black[piece.type]++;
      blackTotal += v;
    }
  }
  const startCount: Record<PieceType, number> = {
    queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8, king: 1,
  };
  const capturedByWhite: CapturedGroup[] = [];
  const capturedByBlack: CapturedGroup[] = [];
  let capturedByWhiteTotal = 0;
  let capturedByBlackTotal = 0;
  for (const type of pieceOrder) {
    const goneFromBlack = Math.max(0, startCount[type] - black[type]);
    if (goneFromBlack > 0) {
      const value = goneFromBlack * PIECE_VALUE[type];
      capturedByWhite.push({ type, count: goneFromBlack, value });
      capturedByWhiteTotal += value;
    }
    const goneFromWhite = Math.max(0, startCount[type] - white[type]);
    if (goneFromWhite > 0) {
      const value = goneFromWhite * PIECE_VALUE[type];
      capturedByBlack.push({ type, count: goneFromWhite, value });
      capturedByBlackTotal += value;
    }
  }
  return {
    score: whiteTotal - blackTotal,
    capturedByWhite,
    capturedByBlack,
    capturedByWhiteTotal,
    capturedByBlackTotal,
    whiteTotal,
    blackTotal,
  };
}
