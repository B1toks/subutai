import { allSquares, positionSignature, setPiece } from './board';
import {
  knightTargets,
  pawnCaptureTargets,
  pawnForwardTargets,
  rayFrom,
  stepInDirection,
  toggleTopology,
} from './auxetic';
import type { BoardState, CastlingRights, Color, Move, Piece, SquareId, TopologyState } from './types';

function pieceAt(state: BoardState, square: SquareId): Piece | undefined {
  return state.pieces[square];
}

function enemyColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

// --- King / check utilities ---

export function findKing(state: BoardState, color: Color): SquareId | null {
  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (piece && piece.type === 'king' && piece.color === color) return sq;
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

export function getAttackerSquares(
  state: BoardState,
  square: SquareId,
  byColor: Color,
  topology: TopologyState,
): SquareId[] {
  const result: SquareId[] = [];

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
      if (p.color === byColor && (p.type === 'rook' || p.type === 'queen')) result.push(sq);
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) result.push(sq);
      break;
    }
  }

  for (const [df, dr] of diagDirs) {
    const ray = rayFrom(square, df, dr, topology);
    for (const sq of ray) {
      const p = pieceAt(state, sq);
      if (!p) continue;
      if (p.color === byColor && (p.type === 'bishop' || p.type === 'queen')) result.push(sq);
      if (p.color === byColor && p.type === 'king' && sq === ray[0]) result.push(sq);
      break;
    }
  }

  for (const sq of knightTargets(square, topology)) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'knight') result.push(sq);
  }

  const pawnLookupColor = byColor === 'white' ? 'black' : 'white';
  const pawnSquares = pawnCaptureTargets(square, pawnLookupColor as 'white' | 'black', topology);
  for (const sq of pawnSquares) {
    const p = pieceAt(state, sq);
    if (p && p.color === byColor && p.type === 'pawn') result.push(sq);
  }

  return result;
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

export function isCheckmate(
  state: BoardState,
  lastMoveWasRotation?: boolean,
): boolean {
  if (!isInCheck(state)) return false;
  if (generateLegalMoves(state).length > 0) return false;
  if (lastMoveWasRotation) return true;
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

export function isStalemate(
  state: BoardState,
  lastMoveWasRotation?: boolean,
): boolean {
  if (isInCheck(state)) return false;
  if (generateLegalMoves(state).length > 0) return false;
  if (lastMoveWasRotation) {
    return true;
  }
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

export type DrawReason =
  | 'stalemate'
  | 'insufficient_material'
  | 'threefold_repetition'
  | 'fifty_move_rule';

export function isThreefoldRepetition(state: BoardState): boolean {
  if (state.positionHistory.length === 0) return false;
  const current = state.positionHistory[state.positionHistory.length - 1];
  let count = 0;
  for (const sig of state.positionHistory) {
    if (sig === current) count++;
  }
  return count >= 3;
}

export function isFiftyMoveRule(state: BoardState): boolean {
  return state.halfmoveClock >= 100;
}

export function isInsufficientMaterial(state: BoardState): boolean {
  const pieces = Object.values(state.pieces).filter((p): p is Piece => Boolean(p));

  // Any pawn, rook, or queen → mate is still possible.
  for (const p of pieces) {
    if (p.type === 'pawn' || p.type === 'rook' || p.type === 'queen') return false;
  }

  const nonKings = pieces.filter((p) => p.type !== 'king');
  // K vs K
  if (nonKings.length === 0) return true;

  // K + minor vs K  (minor = knight or bishop)
  if (nonKings.length === 1) {
    const m = nonKings[0];
    return m.type === 'knight' || m.type === 'bishop';
  }

  // K+B vs K+B where both bishops are on squares of the same color.
  if (nonKings.length === 2 && nonKings.every((p) => p.type === 'bishop')) {
    const bishopColors = (Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>)
      .filter(([, p]) => p && p.type === 'bishop')
      .map(([sq]) => {
        const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
        const rank = Number(sq[1]) - 1;
        return (file + rank) % 2;
      });
    if (bishopColors.length === 2 && bishopColors[0] === bishopColors[1]) return true;
  }

  return false;
}

export function checkDrawConditions(
  state: BoardState,
  lastMoveWasRotation: boolean = false,
): DrawReason | null {
  if (isStalemate(state, lastMoveWasRotation)) return 'stalemate';
  if (isInsufficientMaterial(state)) return 'insufficient_material';
  if (isThreefoldRepetition(state)) return 'threefold_repetition';
  if (isFiftyMoveRule(state)) return 'fifty_move_rule';
  return null;
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
        generateCastlingMoves(state, square, piece, moves, topology);
        break;
    }
  }
  return moves;
}

// --- Castling (Chess960 / FRC) ---

function filesBetween(fromFile: number, toFile: number, rank: string): SquareId[] {
  const out: SquareId[] = [];
  if (fromFile === toFile) {
    out.push(`${String.fromCharCode(97 + fromFile)}${rank}` as SquareId);
    return out;
  }
  const step = fromFile < toFile ? 1 : -1;
  for (let f = fromFile; ; f += step) {
    out.push(`${String.fromCharCode(97 + f)}${rank}` as SquareId);
    if (f === toFile) break;
  }
  return out;
}

function generateCastlingMoves(
  state: BoardState,
  from: SquareId,
  piece: Piece,
  moves: Move[],
  topology: TopologyState,
) {
  if (piece.type !== 'king') return;
  const kingStart = state.kingStartSquares[piece.color];
  if (!kingStart || from !== kingStart) return;

  const enemy: Color = enemyColor(piece.color);
  const rank = piece.color === 'white' ? '1' : '8';
  const rights = state.castlingRights;
  const kingSideRook =
    piece.color === 'white' ? rights.whiteKingSide : rights.blackKingSide;
  const queenSideRook =
    piece.color === 'white' ? rights.whiteQueenSide : rights.blackQueenSide;

  const kingFromFile = from.charCodeAt(0) - 97;

  function trySide(
    rookFrom: SquareId | null,
    kingToFile: 'g' | 'c',
    rookToFile: 'f' | 'd',
  ) {
    if (!rookFrom) return;
    const rook = state.pieces[rookFrom];
    if (!rook || rook.type !== 'rook' || rook.color !== piece.color) return;

    const kingTo = `${kingToFile}${rank}` as SquareId;
    const rookTo = `${rookToFile}${rank}` as SquareId;

    const kingPath = filesBetween(
      kingFromFile,
      kingToFile.charCodeAt(0) - 97,
      rank,
    );
    const rookPath = filesBetween(
      rookFrom.charCodeAt(0) - 97,
      rookToFile.charCodeAt(0) - 97,
      rank,
    );

    // Every square in both paths must be empty, except the king's and rook's
    // own origin squares (they're the pieces moving).
    const pathSet = new Set<SquareId>([...kingPath, ...rookPath]);
    for (const sq of pathSet) {
      if (sq === from || sq === rookFrom) continue;
      if (state.pieces[sq]) return;
    }

    // Every square the king passes through (inclusive of start and end) must
    // not be attacked by the enemy. Attacks are evaluated on the pre-castling
    // position, which is standard.
    for (const sq of kingPath) {
      if (isSquareAttacked(state, sq, enemy, topology)) return;
    }

    moves.push({
      from,
      to: kingTo,
      kind: 'castle',
      castleRookFrom: rookFrom,
      castleRookTo: rookTo,
    });
  }

  trySide(kingSideRook, 'g', 'f');
  trySide(queenSideRook, 'c', 'd');
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

function isPromotionRank(square: SquareId, color: Color, topology: TopologyState): boolean {
  const direction = color === 'white' ? 1 : -1;
  return stepInDirection(square, 0, direction, topology) === null;
}

const PROMOTION_PIECES: readonly ('queen' | 'rook' | 'bishop' | 'knight')[] =
  ['queen', 'rook', 'bishop', 'knight'];

function addPawnMove(
  from: SquareId,
  to: SquareId,
  color: Color,
  isCapture: boolean,
  moves: Move[],
  topology: TopologyState,
) {
  if (isPromotionRank(to, color, topology)) {
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
    addPawnMove(from, one, piece.color, false, moves, topology);
    if (two && !pieceAt(state, two)) {
      addPawnMove(from, two, piece.color, false, moves, topology);
    }
  }

  for (const target of pawnCaptureTargets(from, piece.color, topology)) {
    const targetPiece = pieceAt(state, target);
    if (targetPiece && targetPiece.color !== piece.color) {
      addPawnMove(from, target, piece.color, true, moves, topology);
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

function revokeCastlingRights(
  rights: CastlingRights,
  kingStart: BoardState['kingStartSquares'],
  mover: Piece,
  from: SquareId,
  capturedAt: SquareId | null,
  capturedPiece: Piece | undefined,
): CastlingRights {
  let next = rights;

  // King moves: both sides for that color lose castling rights.
  if (mover.type === 'king' && from === kingStart[mover.color]) {
    if (mover.color === 'white') {
      next = { ...next, whiteKingSide: null, whiteQueenSide: null };
    } else {
      next = { ...next, blackKingSide: null, blackQueenSide: null };
    }
  }

  // Rook moves from its original square: revoke the matching side.
  if (mover.type === 'rook') {
    if (mover.color === 'white') {
      if (from === next.whiteKingSide) next = { ...next, whiteKingSide: null };
      if (from === next.whiteQueenSide) next = { ...next, whiteQueenSide: null };
    } else {
      if (from === next.blackKingSide) next = { ...next, blackKingSide: null };
      if (from === next.blackQueenSide) next = { ...next, blackQueenSide: null };
    }
  }

  // Capture lands on (or originates from) an opponent's initial-rook square.
  // Promotions to rook are unaffected: a promoted rook never lives on its
  // own side's original rook anchor, so no rights are granted.
  if (capturedAt && capturedPiece && capturedPiece.type === 'rook') {
    if (capturedPiece.color === 'white') {
      if (capturedAt === next.whiteKingSide) next = { ...next, whiteKingSide: null };
      if (capturedAt === next.whiteQueenSide) next = { ...next, whiteQueenSide: null };
    } else {
      if (capturedAt === next.blackKingSide) next = { ...next, blackKingSide: null };
      if (capturedAt === next.blackQueenSide) next = { ...next, blackQueenSide: null };
    }
  }

  return next;
}

export function applyMove(state: BoardState, move: Move): BoardState {
  if (!move.from || !move.to) {
    return state;
  }

  const piece = state.pieces[move.from];
  if (!piece) return state;

  const isCapture = Boolean(state.pieces[move.to]);
  const isPawnMove = piece.type === 'pawn';
  const isIrreversible =
    isCapture || isPawnMove || move.kind === 'castle' || move.kind === 'promotion';

  let base: BoardState;

  if (move.kind === 'castle' && move.castleRookFrom && move.castleRookTo) {
    const rook = state.pieces[move.castleRookFrom];
    if (!rook) return state;

    // Clear both origins first, then place both pieces at their targets.
    // This ordering is safe even when a target square coincides with an
    // origin square (a common case in Chess960).
    let next = state;
    next = setPiece(next, move.from, null);
    next = setPiece(next, move.castleRookFrom, null);
    next = setPiece(next, move.to, piece);
    next = setPiece(next, move.castleRookTo, rook);

    const cr = state.castlingRights;
    const clearedRights =
      piece.color === 'white'
        ? { ...cr, whiteKingSide: null, whiteQueenSide: null }
        : { ...cr, blackKingSide: null, blackQueenSide: null };

    base = {
      ...next,
      castlingRights: clearedRights,
      sideToMove: enemyColor(state.sideToMove),
    };
  } else {
    let nextState = state;
    nextState = setPiece(nextState, move.from, null);
    let movedPiece: Piece = piece;
    if (move.kind === 'promotion' && move.promotion) {
      movedPiece = { ...piece, type: move.promotion };
    }
    nextState = setPiece(nextState, move.to, movedPiece);

    const nextRights = revokeCastlingRights(
      state.castlingRights,
      state.kingStartSquares,
      piece,
      move.from,
      isCapture ? move.to : null,
      state.pieces[move.to],
    );

    base = {
      ...nextState,
      castlingRights: nextRights,
      sideToMove: enemyColor(state.sideToMove),
    };
  }

  const halfmoveClock = isIrreversible ? 0 : state.halfmoveClock + 1;
  const fullmoveNumber =
    state.sideToMove === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber;

  const withClocks: BoardState = {
    ...base,
    halfmoveClock,
    fullmoveNumber,
    lastMoveWasRotation: false,
  };
  const sig = positionSignature(withClocks);
  const positionHistory = isIrreversible ? [sig] : [...state.positionHistory, sig];

  return { ...withClocks, positionHistory };
}
