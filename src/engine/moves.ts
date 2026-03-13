import { allSquares, setPiece } from './board';
import {
  knightTargets,
  pawnCaptureTargets,
  pawnForwardTargets,
  rayFrom,
  toggleTopology,
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
  const pawnLookupColor = byColor === 'white' ? 'black' : 'white';
  const pawnSquares = pawnCaptureTargets(square, pawnLookupColor as 'white' | 'black', topology);
  for (const sq of pawnSquares) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'pawn') return true;
  }

  return false;
}

export function countAttackers(
  state: BoardState,
  square: SquareId,
  byColor: Color,
  topology: TopologyState,
): number {
  let count = 0;

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
      if (p.color === byColor && (p.type === 'rook' || p.type === 'queen')) count++;
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) count++;
      break;
    }
  }

  for (const [df, dr] of diagDirs) {
    const ray = rayFrom(square, df, dr, topology);
    for (const sq of ray) {
      const p = pieceAt(state, sq);
      if (!p) continue;
      if (p.color === byColor && (p.type === 'bishop' || p.type === 'queen')) count++;
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) count++;
      break;
    }
  }

  for (const sq of knightTargets(square, topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'knight') count++;
  }

  const pawnLookupColor = byColor === 'white' ? 'black' : 'white';
  const pawnSquares = pawnCaptureTargets(square, pawnLookupColor as 'white' | 'black', topology);
  for (const sq of pawnSquares) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'pawn') count++;
  }

  return count;
}

export function isInCheck(state: BoardState): boolean {
  const kingSquare = findKing(state, state.sideToMove);
  if (!kingSquare) return false;
  return isSquareAttacked(state, kingSquare, enemyColor(state.sideToMove), state.topologyState);
}

function canEscapeViaToggle(state: BoardState): boolean {
  const toggled = toggleTopology(state);
  const king = findKing(toggled, state.sideToMove);
  if (!king) return false;
  return !isSquareAttacked(toggled, king, enemyColor(state.sideToMove), toggled.topologyState);
}

export function isCheckmate(state: BoardState): boolean {
  if (!isInCheck(state)) return false;
  if (generateLegalMoves(state).length > 0) return false;
  const toggleEscape = canEscapeViaToggle(state);
  // #region agent log
  if (
    toggleEscape &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  ) {
    fetch('http://127.0.0.1:7519/ingest/37bd3e22-11f2-45c3-b325-8dbcf69a5172',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'389750'},body:JSON.stringify({sessionId:'389750',location:'moves.ts:isCheckmate',message:'In check with no piece moves but rotation escapes',data:{side:state.sideToMove,topology:state.topologyState},timestamp:Date.now(),hypothesisId:'H_ROTATE_ESCAPE'})}).catch(()=>{});
  }
  // #endregion
  return !toggleEscape;
}

export function isStalemate(state: BoardState): boolean {
  if (isInCheck(state)) return false;
  if (generateLegalMoves(state).length > 0) return false;
  const toggleEscape = canEscapeViaToggle(state);
  // #region agent log
  if (
    toggleEscape &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  ) {
    fetch('http://127.0.0.1:7519/ingest/37bd3e22-11f2-45c3-b325-8dbcf69a5172',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'389750'},body:JSON.stringify({sessionId:'389750',location:'moves.ts:isStalemate',message:'No piece moves but rotation available (not stalemate)',data:{side:state.sideToMove,topology:state.topologyState},timestamp:Date.now(),hypothesisId:'H_ROTATE_ESCAPE'})}).catch(()=>{});
  }
  // #endregion
  return !toggleEscape;
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

let _glmLogCount = 0;
export function generateLegalMoves(state: BoardState): Move[] {
  const pseudo = generatePseudoLegalMoves(state);
  const side = state.sideToMove;
  const opponent = enemyColor(side);

  // #region agent log
  const filtered: Array<{from?:string,to?:string,kind:string,reason:string}> = [];
  // #endregion

  const legal = pseudo.filter((move) => {
    const next = applyMove(state, move);
    const kingSquare = findKing(next, side);
    if (!kingSquare) {
      // #region agent log
      filtered.push({from:move.from,to:move.to,kind:move.kind,reason:'noKing'});
      // #endregion
      return false;
    }
    const attacked = isSquareAttacked(next, kingSquare, opponent, next.topologyState);
    if (attacked) {
      // #region agent log
      filtered.push({from:move.from,to:move.to,kind:move.kind,reason:`kingAt${kingSquare}Attacked`});
      // #endregion
    }
    return !attacked;
  });

  // #region agent log
  _glmLogCount++;
  if (_glmLogCount <= 60 && pseudo.length > 0 && legal.length <= 3) {
    fetch('http://127.0.0.1:7519/ingest/37bd3e22-11f2-45c3-b325-8dbcf69a5172',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'389750'},body:JSON.stringify({sessionId:'389750',location:'moves.ts:generateLegalMoves',message:'Low legal move count',data:{side,topology:state.topologyState,pseudoCount:pseudo.length,legalCount:legal.length,filteredSample:filtered.slice(0,10),legalMoves:legal.map(m=>({from:m.from,to:m.to,kind:m.kind}))},timestamp:Date.now(),hypothesisId:'H1,H4,H5'})}).catch(()=>{});
  }
  // #endregion

  return legal;
}

function isPromotionRank(square: SquareId, color: Color): boolean {
  const rank = Number(square[1]);
  return (color === 'white' && rank === 8) || (color === 'black' && rank === 1);
}

const PROMOTION_PIECES: readonly ('queen' | 'rook' | 'bishop' | 'knight')[] =
  ['queen', 'rook', 'bishop', 'knight'];

function addPawnMove(
  from: SquareId,
  to: SquareId,
  color: Color,
  isCapture: boolean,
  moves: Move[],
) {
  if (isPromotionRank(to, color)) {
    for (const promo of PROMOTION_PIECES) {
      moves.push({ from, to, kind: 'promotion', promotion: promo });
    }
  } else {
    moves.push({ from, to, kind: isCapture ? 'capture' : 'normal' });
  }
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
    addPawnMove(from, one, piece.color, false, moves);
    if (two && !pieceAt(state, two)) {
      moves.push({ from, to: two, kind: 'normal' });
    }
  }

  for (const target of pawnCaptureTargets(from, piece.color, topology)) {
    const targetPiece = pieceAt(state, target);
    if (targetPiece && targetPiece.color !== piece.color) {
      addPawnMove(from, target, piece.color, true, moves);
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
