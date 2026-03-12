import type { BoardState, CastlingRights, Color, Piece, PieceType, SquareId } from './types';

const files = ['a','b','c','d','e','f','g','h'] as const;
const ranks = ['1','2','3','4','5','6','7','8'] as const;

export const allSquares: SquareId[] = files.flatMap((f) =>
  ranks.map((r) => `${f}${r}` as SquareId),
);

export function createEmptyBoardState(sideToMove: Color = 'white'): BoardState {
  return {
    pieces: new Map<SquareId, Piece>(),
    sideToMove,
    castlingRights: defaultCastlingRights(),
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    topologyState: 'A',
  };
}

export function defaultCastlingRights(): CastlingRights {
  return {
    whiteKingSide: true,
    whiteQueenSide: true,
    blackKingSide: true,
    blackQueenSide: true,
  };
}

export function setPiece(
  state: BoardState,
  square: SquareId,
  piece: Piece | null,
): BoardState {
  const pieces = new Map(state.pieces);
  if (piece) {
    pieces.set(square, piece);
  } else {
    pieces.delete(square);
  }
  return { ...state, pieces };
}

let nextPieceId = 1;

export function makePiece(color: Color, type: PieceType): Piece {
  const id = `${color[0]}_${type}_${nextPieceId++}`;
  return { id, color, type };
}
