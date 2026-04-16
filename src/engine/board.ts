import type {
  BoardState,
  CastlingRights,
  Color,
  KingStartSquares,
  Piece,
  PieceMap,
  PieceType,
  SerializedBoardState,
  SquareId,
  TopologyState,
} from './types';

const files = ['a','b','c','d','e','f','g','h'] as const;
const ranks = ['1','2','3','4','5','6','7','8'] as const;

export const allSquares: SquareId[] = files.flatMap((f) =>
  ranks.map((r) => `${f}${r}` as SquareId),
);

export function createEmptyBoardState(sideToMove: Color = 'white'): BoardState {
  return {
    pieces: {},
    sideToMove,
    castlingRights: emptyCastlingRights(),
    kingStartSquares: { white: null, black: null },
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    topologyState: 'A',
  };
}

export function emptyCastlingRights(): CastlingRights {
  return {
    whiteKingSide: null,
    whiteQueenSide: null,
    blackKingSide: null,
    blackQueenSide: null,
  };
}

// Kept for backward compatibility — produces empty rights (no anchors known).
export function defaultCastlingRights(): CastlingRights {
  return emptyCastlingRights();
}

export function setPiece(
  state: BoardState,
  square: SquareId,
  piece: Piece | null,
): BoardState {
  const pieces: Record<string, Piece> = { ...state.pieces } as Record<string, Piece>;
  if (piece) {
    pieces[square] = piece;
  } else {
    delete pieces[square];
  }
  return { ...state, pieces: pieces as PieceMap };
}

export function pieceAt(state: BoardState, square: SquareId): Piece | undefined {
  return state.pieces[square];
}

export function piecesEntries(state: BoardState): Array<[SquareId, Piece]> {
  const out: Array<[SquareId, Piece]> = [];
  for (const [sq, p] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (p) out.push([sq, p]);
  }
  return out;
}

let nextPieceId = 1;

function generatePieceId(color: Color, type: PieceType): string {
  // Prefer collision-resistant UUIDs for distributed sync. Fall back to
  // a per-process sequence when crypto.randomUUID is unavailable.
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
    crypto?: { randomUUID?: () => string };
  };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return `${color[0]}_${type}_${g.crypto.randomUUID()}`;
  }
  return `${color[0]}_${type}_${Date.now().toString(36)}_${nextPieceId++}`;
}

export function makePiece(color: Color, type: PieceType): Piece {
  return { id: generatePieceId(color, type), color, type };
}

// --- Serialization ---

const PIECE_CHAR: Record<PieceType, string> = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
};

export function toFEN(state: BoardState): string {
  const rankStrs: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of files) {
      const sq = `${f}${r}` as SquareId;
      const p = state.pieces[sq];
      if (!p) { empty++; continue; }
      if (empty) { row += String(empty); empty = 0; }
      const ch = PIECE_CHAR[p.type];
      row += p.color === 'white' ? ch.toUpperCase() : ch;
    }
    if (empty) row += String(empty);
    rankStrs.push(row);
  }
  const board = rankStrs.join('/');
  const active = state.sideToMove === 'white' ? 'w' : 'b';
  const cr = state.castlingRights;
  let castle = '';
  if (cr.whiteKingSide) castle += 'K';
  if (cr.whiteQueenSide) castle += 'Q';
  if (cr.blackKingSide) castle += 'k';
  if (cr.blackQueenSide) castle += 'q';
  if (!castle) castle = '-';
  const ep = state.enPassantTarget ?? '-';
  return `${board} ${active} ${castle} ${ep} ${state.halfmoveClock} ${state.fullmoveNumber}`;
}

export function getBlockAngles(topology: TopologyState): number[] {
  if (topology === 'A') return new Array(16).fill(0);
  const angles: number[] = [];
  for (let br = 0; br < 4; br++) {
    for (let bc = 0; bc < 4; bc++) {
      angles.push((br + bc) % 2 === 0 ? 90 : -90);
    }
  }
  return angles;
}

export function getSerializedState(state: BoardState): SerializedBoardState {
  return {
    fen: toFEN(state),
    topologyState: state.topologyState,
    blockAngles: getBlockAngles(state.topologyState),
    pieces: { ...state.pieces } as Record<string, Piece>,
    sideToMove: state.sideToMove,
    castlingRights: { ...state.castlingRights },
    kingStartSquares: { ...state.kingStartSquares } as KingStartSquares,
    enPassantTarget: state.enPassantTarget,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
  };
}
