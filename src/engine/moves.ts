import { allSquares, setPiece } from './board';
import {
  knightTargets,
  pawnCaptureTargets,
  pawnForwardTargets,
  rayFrom,
} from './auxetic';
import type { BoardState, Color, Move, Piece, SquareId, TopologyState } from './types';

function pieceAt(state: BoardState, square: SquareId): Piece | undefined {
  return state.pieces.get(square);
}

function enemyColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

// --- King / check utilities ---

export function findKing(state: BoardState, color: Color): SquareId | null {
  for (const [sq, piece] of state.pieces) {
    if (piece.type === 'king' && piece.color === color) return sq;
  }
  return null;
}

export function isSquareAttacked(
  state: BoardState,
  square: SquareId,
  byColor: Color,
  topology: TopologyState,
): boolean {
  // Sliding attacks (rook/queen along ranks/files, bishop/queen along diagonals)
  const straightDirs: readonly (readonly [number, number])[] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  const diagDirs: readonly (readonly [number, number])[] = [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  for (const [df, dr] of straightDirs) {
    const ray = rayFrom(square, df, dr, topology);
    for (const sq of ray) {
      const p = pieceAt(state, sq);
      if (!p) continue;
      if (p.color === byColor && (p.type === 'rook' || p.type === 'queen')) return true;
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) return true;
      break;
    }
  }

  for (const [df, dr] of diagDirs) {
    const ray = rayFrom(square, df, dr, topology);
    for (const sq of ray) {
      const p = pieceAt(state, sq);
      if (!p) continue;
      if (p.color === byColor && (p.type === 'bishop' || p.type === 'queen')) return true;
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) return true;
      break;
    }
  }

  // Knight attacks
  for (const sq of knightTargets(square, topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'knight') return true;
  }

  // Pawn attacks: look in the reverse capture direction to find attacking pawns
  for (const sq of pawnCaptureTargets(square, byColor === 'white' ? 'black' : 'white', topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'pawn') return true;
  }

  return false;
}

export function isInCheck(state: BoardState): boolean {
  const kingSquare = findKing(state, state.sideToMove);
  if (!kingSquare) return false;
  return isSquareAttacked(state, kingSquare, enemyColor(state.sideToMove), state.topologyState);
}

export function isCheckmate(state: BoardState): boolean {
  return isInCheck(state) && generateLegalMoves(state).length === 0;
}

export function isStalemate(state: BoardState): boolean {
  return !isInCheck(state) && generateLegalMoves(state).length === 0;
}

export function findCheckingPieces(state: BoardState): SquareId[] {
  const kingSquare = findKing(state, state.sideToMove);
  if (!kingSquare) return [];
  const attacker = enemyColor(state.sideToMove);
  const topology = state.topologyState;
  const checkers: SquareId[] = [];

  const allDirs: readonly (readonly [number, number])[] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (const [df, dr] of allDirs) {
    const ray = rayFrom(kingSquare, df, dr, topology);
    for (const sq of ray) {
      const p = pieceAt(state, sq);
      if (!p) continue;
      if (p.color !== attacker) break;
      const isStraight = df === 0 || dr === 0;
      if (isStraight && (p.type === 'rook' || p.type === 'queen')) checkers.push(sq);
      if (!isStraight && (p.type === 'bishop' || p.type === 'queen')) checkers.push(sq);
      break;
    }
  }

  for (const sq of knightTargets(kingSquare, topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === attacker && p.type === 'knight') checkers.push(sq);
  }

  for (const sq of pawnCaptureTargets(kingSquare, attacker === 'white' ? 'black' : 'white', topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === attacker && p.type === 'pawn') checkers.push(sq);
  }

  return checkers;
}

// --- Move generation ---

function generatePseudoLegalMoves(state: BoardState): Move[] {
  const topology: TopologyState = state.topologyState;
  const moves: Move[] = [];
  for (const square of allSquares) {
    const piece = pieceAt(state, square);
    if (!piece || piece.color !== state.sideToMove) continue;
    switch (piece.type) {
      case 'pawn':
        generatePawnMoves(state, square, piece, moves, topology);
        break;
      case 'knight':
        generateKnightMoves(state, square, piece, moves, topology);
        break;
      case 'bishop':
        generateSlidingMoves(state, square, piece, moves, topology, [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]);
        break;
      case 'rook':
        generateSlidingMoves(state, square, piece, moves, topology, [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]);
        break;
      case 'queen':
        generateSlidingMoves(state, square, piece, moves, topology, [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]);
        break;
      case 'king':
        generateKingMoves(state, square, piece, moves, topology);
        break;
    }
  }
  return moves;
}

export function generateLegalMoves(state: BoardState): Move[] {
  const pseudo = generatePseudoLegalMoves(state);
  const side = state.sideToMove;
  const opponent = enemyColor(side);

  return pseudo.filter((move) => {
    const next = applyMove(state, move);
    const kingSquare = findKing(next, side);
    if (!kingSquare) return false;
    return !isSquareAttacked(next, kingSquare, opponent, next.topologyState);
  });
}

function generatePawnMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
) {
  const { one, two } = pawnForwardTargets(from, piece.color, topology);
  if (one && !pieceAt(state, one)) {
    moves.push({ from, to: one, kind: 'normal' });
    if (two && !pieceAt(state, two)) {
      moves.push({ from, to: two, kind: 'normal' });
    }
  }

  for (const target of pawnCaptureTargets(from, piece.color, topology)) {
    const targetPiece = pieceAt(state, target);
    if (targetPiece && targetPiece.color !== piece.color) {
      moves.push({ from, to: target, kind: 'capture' });
    }
  }
}

function generateKnightMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
) {
  const targets = knightTargets(from, topology);
  for (const target of targets) {
    const targetPiece = pieceAt(state, target);
    if (!targetPiece) {
      moves.push({ from, to: target, kind: 'normal' });
    } else if (targetPiece.color !== piece.color) {
      moves.push({ from, to: target, kind: 'capture' });
    }
  }
}

function generateSlidingMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
  deltas: readonly (readonly [number, number])[],
) {
  for (const [df, dr] of deltas) {
    const ray = rayFrom(from, df, dr, topology);
    for (const target of ray) {
      const targetPiece = pieceAt(state, target);
      if (!targetPiece) {
        moves.push({ from, to: target, kind: 'normal' });
      } else {
        if (targetPiece.color !== piece.color) {
          moves.push({ from, to: target, kind: 'capture' });
        }
        break;
      }
    }
  }
}

function generateKingMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
) {
  const kingDeltas: Array<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [df, dr] of kingDeltas) {
    const [target] = rayFrom(from, df, dr, topology);
    if (!target) continue;
    const targetPiece = pieceAt(state, target);
    if (!targetPiece) {
      moves.push({ from, to: target, kind: 'normal' });
    } else if (targetPiece.color !== piece.color) {
      moves.push({ from, to: target, kind: 'capture' });
    }
  }
}

export function applyMove(state: BoardState, move: Move): BoardState {
  if (!move.from || !move.to) {
    return state;
  }

  const piece = state.pieces.get(move.from);
  if (!piece) return state;

  let nextState = state;

  nextState = setPiece(nextState, move.from, null);

  let movedPiece: Piece = piece;
  if (move.kind === 'promotion' && move.promotion) {
    movedPiece = { ...piece, type: move.promotion };
  }

  nextState = setPiece(nextState, move.to, movedPiece);

  return {
    ...nextState,
    sideToMove: enemyColor(state.sideToMove),
  };
}
