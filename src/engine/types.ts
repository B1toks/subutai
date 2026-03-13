export type Color = 'white' | 'black';

export type PieceType =
  | 'pawn'
  | 'knight'
  | 'bishop'
  | 'rook'
  | 'queen'
  | 'king';

export type SquareId =
  | 'a1' | 'b1' | 'c1' | 'd1' | 'e1' | 'f1' | 'g1' | 'h1'
  | 'a2' | 'b2' | 'c2' | 'd2' | 'e2' | 'f2' | 'g2' | 'h2'
  | 'a3' | 'b3' | 'c3' | 'd3' | 'e3' | 'f3' | 'g3' | 'h3'
  | 'a4' | 'b4' | 'c4' | 'd4' | 'e4' | 'f4' | 'g4' | 'h4'
  | 'a5' | 'b5' | 'c5' | 'd5' | 'e5' | 'f5' | 'g5' | 'h5'
  | 'a6' | 'b6' | 'c6' | 'd6' | 'e6' | 'f6' | 'g6' | 'h6'
  | 'a7' | 'b7' | 'c7' | 'd7' | 'e7' | 'f7' | 'g7' | 'h7'
  | 'a8' | 'b8' | 'c8' | 'd8' | 'e8' | 'f8' | 'g8' | 'h8';

export interface Piece {
  readonly id: string;
  readonly color: Color;
  readonly type: PieceType;
}

export interface CastlingRights {
  readonly whiteKingSide: boolean;
  readonly whiteQueenSide: boolean;
  readonly blackKingSide: boolean;
  readonly blackQueenSide: boolean;
}

export type TopologyState = 'A' | 'B';

export interface BoardState {
  readonly pieces: ReadonlyMap<SquareId, Piece>;
  readonly sideToMove: Color;
  readonly castlingRights: CastlingRights;
  readonly enPassantTarget: SquareId | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly topologyState: TopologyState;
}

export type MoveKind =
  | 'normal'
  | 'capture'
  | 'castle'
  | 'enPassant'
  | 'promotion'
  | 'topologyToggle';

export interface Move {
  readonly from?: SquareId;
  readonly to?: SquareId;
  readonly kind: MoveKind;
  readonly promotion?: PieceType;
}
