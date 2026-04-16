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

function negamax(
  state: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
  lastMoveWasRotation: boolean,
): { score: number; bestMove: Move | null } {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) {
    ctx.cancelled = true;
  }
  if (ctx.cancelled) return { score: 0, bestMove: null };

  if (depth <= 0) {
    return { score: quiescence(state, alpha, beta, 4, ctx), bestMove: null };
  }

  const moves = generateLegalMoves(state);
  const candidates = [...moves];

  const rotated = toggleTopology(state);
  const enemy: 'white' | 'black' = state.sideToMove === 'white' ? 'black' : 'white';
  const ourKing = findKing(rotated, state.sideToMove);
  if (
    !lastMoveWasRotation &&
    ourKing &&
    !isSquareAttacked(rotated, ourKing, enemy, rotated.topologyState)
  ) {
    candidates.push({ kind: 'topologyToggle' });
  }

  if (candidates.length === 0) {
    if (isInCheck(state)) return { score: -(MATE_SCORE - ply), bestMove: null };
    return { score: 0, bestMove: null };
  }

  sortMoves(candidates, state);

  let bestMove: Move | null = candidates[0];

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

    if (score >= beta) return { score: beta, bestMove: move };
    if (score > alpha) {
      alpha = score;
      bestMove = move;
    }
  }

  return { score: alpha, bestMove };
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
  const deadline = performance.now() + timeBudgetMs;
  let bestMove: Move | null = null;

  for (let depth = 1; depth <= 6; depth++) {
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
    }
    if (ctx.cancelled) break;
    if (Math.abs(result.score) >= MATE_SCORE - 100) break;
  }

  return bestMove;
}
