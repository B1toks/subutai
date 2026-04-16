import type { BoardState, Move, PieceType, TopologyState } from '../engine';

export interface LoggedMove {
  readonly san?: string;
  readonly move: Move;
  readonly topology?: TopologyState;
  readonly timestamp: number;
}

export interface GameLog {
  readonly id: string;
  readonly createdAt: string;
  readonly randomSeed: number;
  readonly initialTopology: TopologyState;
  readonly initialState: BoardState;
  readonly moves: readonly LoggedMove[];
}

const SAN_PIECE: Record<PieceType, string> = {
  pawn: '', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K',
};
const PROMO_LETTER: Record<string, string> = {
  queen: 'Q', rook: 'R', bishop: 'B', knight: 'N',
};

export function computeSAN(state: BoardState, move: Move): string {
  if (move.kind === 'topologyToggle') {
    return state.topologyState === 'A' ? 'A\u2192B' : 'B\u2192A';
  }
  if (move.kind === 'castle') {
    return move.to && move.to[0] === 'c' ? 'O-O-O' : 'O-O';
  }
  if (!move.from || !move.to) return '?';
  const piece = state.pieces[move.from];
  const prefix = piece ? SAN_PIECE[piece.type] : '';
  let san = `${prefix}${move.from}\u2192${move.to}`;
  if (move.kind === 'promotion' && move.promotion) {
    san += `=${PROMO_LETTER[move.promotion] ?? ''}`;
  }
  return san;
}

export function createGameLog(
  id: string,
  initialState: BoardState,
  randomSeed: number,
): GameLog {
  return {
    id,
    createdAt: new Date().toISOString(),
    randomSeed,
    initialTopology: initialState.topologyState,
    initialState,
    moves: [],
  };
}

export function appendMove(
  log: GameLog,
  move: Move,
  san?: string,
  topology?: TopologyState,
): GameLog {
  return {
    ...log,
    moves: [...log.moves, { san, move, topology, timestamp: Date.now() }],
  };
}
