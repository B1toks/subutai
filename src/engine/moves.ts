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

export function generateLegalMoves(state: BoardState): Move[] {
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

function generatePawnMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
) {
  const { one, two } = pawnForwardTargets(from, piece.color, topology);
  if (one && !pieceAt(state, one)) {
    addPawnAdvanceMove(from, one, moves);
    if (two && !pieceAt(state, two)) {
      moves.push({ from, to: two, kind: 'normal' });
    }
  }

  for (const target of pawnCaptureTargets(from, piece.color, topology)) {
    const targetPiece = pieceAt(state, target);
    if (targetPiece && targetPiece.color !== piece.color) {
      addPawnCaptureMove(from, target, moves);
    }
  }
}

function addPawnAdvanceMove(
  from: SquareId,
  to: SquareId,
  moves: Move[],
) {
  moves.push({ from, to, kind: 'normal' });
}

function addPawnCaptureMove(
  from: SquareId,
  to: SquareId,
  moves: Move[],
) {
  moves.push({ from, to, kind: 'capture' });
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
