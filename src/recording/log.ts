import type { BoardState, Move, PieceType, TopologyState } from '../engine';
import type { MoveAnalysis } from '../analysis/classify';

export interface LoggedMove {
  readonly san?: string;
  readonly move: Move;
  readonly topology?: TopologyState;
  readonly timestamp: number;
  /** Populated when the move was classified at play time. */
  readonly analysis?: MoveAnalysis;
  /** Search-evaluated centipawn score from White's perspective after the
   *  move was applied. Auto-mode only — used for future NNUE training data. */
  readonly searchScore?: number;
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
  analysis?: MoveAnalysis,
): GameLog {
  return {
    ...log,
    moves: [...log.moves, { san, move, topology, timestamp: Date.now(), analysis }],
  };
}

/**
 * Attach an analysis object to the last logged move. Used by the async
 * classifier — the move is appended immediately for snappy UI, then
 * `setTimeout(0)` runs `classifyMove` and patches the result back in.
 */
export function updateLastMoveAnalysis(log: GameLog, analysis: MoveAnalysis): GameLog {
  if (log.moves.length === 0) return log;
  const idx = log.moves.length - 1;
  const updated = log.moves.slice();
  updated[idx] = { ...updated[idx], analysis };
  return { ...log, moves: updated };
}

/** Attach a White-perspective search score to the last logged move. Used by
 *  auto mode to label every position with a shallow search eval for future
 *  training-data extraction. */
export function attachSearchScoreToLastMove(
  log: GameLog,
  scoreFromWhite: number,
): GameLog {
  if (log.moves.length === 0) return log;
  const idx = log.moves.length - 1;
  const updated = log.moves.slice();
  updated[idx] = { ...updated[idx], searchScore: scoreFromWhite };
  return { ...log, moves: updated };
}

/** Patch a specific move (by index) with an analysis. Used by the
 *  imported-log classifier where moves are processed out-of-order. */
export function updateMoveAnalysisAt(
  log: GameLog,
  index: number,
  analysis: MoveAnalysis,
): GameLog {
  if (index < 0 || index >= log.moves.length) return log;
  const updated = log.moves.slice();
  updated[index] = { ...updated[index], analysis };
  return { ...log, moves: updated };
}
