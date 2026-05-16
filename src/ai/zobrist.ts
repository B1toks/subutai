import type { BoardState, Color, Piece, PieceType, SquareId } from '../engine/types';

// 53-bit hashes via JS Number (safe-integer range). Collisions are possible
// but rare at depth 7-8 and the TT explicitly verifies entry.hash on probe,
// so a collision just becomes a miss — never a false hit.

// Seedable mulberry32 — deterministic per session, regenerated on module load
// (the same numbers every refresh, so games are reproducible from a seed).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

function rand53(rng: () => number): number {
  // Combine two 32-bit randoms into a 53-bit safe integer.
  const hi = Math.floor(rng() * 0x200000); // 21 bits
  const lo = Math.floor(rng() * 0x100000000); // 32 bits
  return hi * 0x100000000 + lo;
}

const PIECE_TYPES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const COLORS: Color[] = ['white', 'black'];

interface ZobristKeys {
  pieces: Record<Color, Record<PieceType, number[]>>; // [64] per (color, type)
  turn: number;
  topology: number;
  epFile: number[]; // 8 entries — only when en passant is actually live
  castling: Record<string, number>; // keyed by 'wK', 'wQ', 'bK', 'bQ'
}

function initKeys(): ZobristKeys {
  const rng = mulberry32(0x5EAB17A1);
  const pieces = {
    white: {} as Record<PieceType, number[]>,
    black: {} as Record<PieceType, number[]>,
  };
  for (const color of COLORS) {
    for (const type of PIECE_TYPES) {
      pieces[color][type] = Array.from({ length: 64 }, () => rand53(rng));
    }
  }
  const turn = rand53(rng);
  const topology = rand53(rng);
  const epFile = Array.from({ length: 8 }, () => rand53(rng));
  const castling: Record<string, number> = {
    wK: rand53(rng),
    wQ: rand53(rng),
    bK: rand53(rng),
    bQ: rand53(rng),
  };
  return { pieces, turn, topology, epFile, castling };
}

const K = initKeys();

function squareIdx(sq: SquareId): number {
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(sq[1]) - 1;
  return rank * 8 + file;
}

// XOR for safe-integer doubles — JS bitwise is 32-bit, so split high/low halves.
function xor53(a: number, b: number): number {
  const aHi = Math.floor(a / 0x100000000);
  const aLo = a >>> 0;
  const bHi = Math.floor(b / 0x100000000);
  const bLo = b >>> 0;
  const hi = (aHi ^ bHi) >>> 0;
  const lo = (aLo ^ bLo) >>> 0;
  return hi * 0x100000000 + lo;
}

/**
 * Full-board Zobrist hash for `state`. Folds in piece placements, side to
 * move, topology bit, castling rights, and en-passant file. Intended for
 * transposition-table indexing.
 */
export function zobristHash(state: BoardState): number {
  let h = 0;
  for (const [sq, piece] of Object.entries(state.pieces) as Array<[SquareId, Piece | undefined]>) {
    if (!piece) continue;
    const key = K.pieces[piece.color][piece.type][squareIdx(sq)];
    h = xor53(h, key);
  }
  if (state.sideToMove === 'black') h = xor53(h, K.turn);
  if (state.topologyState === 'B') h = xor53(h, K.topology);
  if (state.enPassantTarget) {
    const file = state.enPassantTarget.charCodeAt(0) - 'a'.charCodeAt(0);
    h = xor53(h, K.epFile[file]);
  }
  const rights = state.castlingRights;
  if (rights.whiteKingSide) h = xor53(h, K.castling.wK);
  if (rights.whiteQueenSide) h = xor53(h, K.castling.wQ);
  if (rights.blackKingSide) h = xor53(h, K.castling.bK);
  if (rights.blackQueenSide) h = xor53(h, K.castling.bQ);
  return h;
}
