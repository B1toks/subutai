import type { BoardState, Move } from '../engine/types';
import {
  generateLegalMoves,
  applyMove,
  isInCheck,
  findKing,
  isSquareAttacked,
} from '../engine/moves';
import { applyRotationMove, toggleTopology } from '../engine/auxetic';
import { evaluate, PIECE_VALUE } from './evaluate';

const MATE_SCORE = 100_000;
const INF = MATE_SCORE * 2;

interface SearchContext {
  deadline: number;
  nodes: number;
  cancelled: boolean;
}

function moveOrderScore(move: Move, state: BoardState): number {
  if (move.kind === 'topologyToggle') return -10;
  if (move.kind === 'promotion') return 8000;
  if (move.kind === 'capture' && move.to) {
    const victim = state.pieces[move.to];
    const attacker = move.from ? state.pieces[move.from] : undefined;
    const vv = victim ? PIECE_VALUE[victim.type] : 0;
    const av = attacker ? PIECE_VALUE[attacker.type] : 0;
    return vv * 10 - av;
  }
  return 0;
}

function sortMoves(moves: Move[], state: BoardState): void {
  const scores = moves.map((m) => moveOrderScore(m, state));
  const indices = moves.map((_, i) => i);
  indices.sort((a, b) => scores[b] - scores[a]);
  const sorted = indices.map((i) => moves[i]);
  for (let i = 0; i < moves.length; i++) moves[i] = sorted[i];
}

interface NegamaxResult {
  readonly score: number;
  readonly bestMove: Move | null;
  /** Triangular PV — the principal variation from this node downward. */
  readonly pv: readonly Move[];
}

function negamax(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
  lastMoveWasRotation: boolean,
): NegamaxResult {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) {
    ctx.cancelled = true;
  }
  if (ctx.cancelled) return { score: 0, bestMove: null, pv: [] };

  if (depth <= 0) {
    return { score: quiescence(state, alpha, beta, 4, ctx), bestMove: null, pv: [] };
  }

  const moves = generateLegalMoves(state);
  const candidates = [...moves];

  const rotationBlocked = state.lastMoveWasRotation || lastMoveWasRotation;
  if (!rotationBlocked) {
    const rotated = toggleTopology(state);
    const enemy: 'white' | 'black' = state.sideToMove === 'white' ? 'black' : 'white';
    const ourKing = findKing(rotated, state.sideToMove);
    if (ourKing && !isSquareAttacked(rotated, ourKing, enemy, rotated.topologyState)) {
      candidates.push({ kind: 'topologyToggle' });
    }
  }

  if (candidates.length === 0) {
    if (isInCheck(state)) return { score: -(MATE_SCORE - ply), bestMove: null, pv: [] };
    return { score: 0, bestMove: null, pv: [] };
  }

  sortMoves(candidates, state);

  let bestMove: Move | null = candidates[0];
  let bestPv: readonly Move[] = [];

  for (const move of candidates) {
    if (ctx.cancelled) break;

    const next =
      move.kind === 'topologyToggle' ? applyRotationMove(state) : applyMove(state, move);

    const result = negamax(
      next,
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
      ctx,
      move.kind === 'topologyToggle',
    );
    const score = -result.score;

    if (score >= beta) {
      // Beta cutoff — standard practice is to skip writing PV for this node
      // (the line was good enough to refute, but we don't have the full
      // principal continuation since alpha-beta pruned the rest).
      return { score: beta, bestMove: move, pv: [] };
    }
    if (score > alpha) {
      alpha = score;
      bestMove = move;
      bestPv = [move, ...result.pv];
    }
  }

  return { score: alpha, bestMove, pv: bestPv };
}

function quiescence(
  state: BoardState,
  alpha: number,
  beta: number,
  depthLeft: number,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) {
    ctx.cancelled = true;
  }
  if (ctx.cancelled) return 0;

  const standPat = evaluate(state);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (depthLeft <= 0) return alpha;

  const allMoves = generateLegalMoves(state);
  if (allMoves.length === 0) {
    return isInCheck(state) ? -(MATE_SCORE) : 0;
  }

  const captures = allMoves.filter(
    (m) => m.kind === 'capture' || m.kind === 'promotion',
  );
  sortMoves(captures, state);

  for (const move of captures) {
    if (ctx.cancelled) break;
    const next = applyMove(state, move);
    const score = -quiescence(next, -beta, -alpha, depthLeft - 1, ctx);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

export function iterativeDeepen(
  state: BoardState,
  timeBudgetMs: number,
  lastMoveWasRotation: boolean = false,
): Move | null {
  return searchPosition(state, {
    budgetMs: timeBudgetMs,
    maxDepth: 6,
    lastMoveWasRotation,
  }).bestMove;
}

export interface SearchOptions {
  readonly budgetMs: number;
  readonly maxDepth: number;
  readonly lastMoveWasRotation?: boolean;
}

export interface SearchResult {
  readonly bestMove: Move | null;
  /** Score from the perspective of state.sideToMove (centipawns). */
  readonly score: number;
  /** Engine's principal variation. Only populated for non-cancelled depths. */
  readonly pv: readonly Move[];
}

/**
 * Iterative deepening search exposing best move, score, and the principal
 * variation. Used by the analysis layer for centipawn-loss classification
 * and for showing the engine's expected continuation in tooltips.
 */
export function searchPosition(
  state: BoardState,
  options: SearchOptions,
): SearchResult {
  const deadline = performance.now() + options.budgetMs;
  const lastMoveWasRotation = options.lastMoveWasRotation ?? false;
  let bestMove: Move | null = null;
  let bestScore = 0;
  let bestPv: readonly Move[] = [];

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const ctx: SearchContext = { deadline, nodes: 0, cancelled: false };
    const result = negamax(
      state,
      depth,
      -INF,
      INF,
      0,
      ctx,
      lastMoveWasRotation,
    );

    if (!ctx.cancelled && result.bestMove) {
      bestMove = result.bestMove;
      bestScore = result.score;
      bestPv = result.pv;
    }
    if (ctx.cancelled) break;
    if (Math.abs(result.score) >= MATE_SCORE - 100) break;
  }

  return { bestMove, score: bestScore, pv: bestPv };
}
