import type { BoardState, Move, SquareId } from '../engine/types';
import {
  generateLegalMoves,
  applyMove,
  isInCheck,
  findKing,
  isSquareAttacked,
} from '../engine/moves';
import { applyRotationMove, toggleTopology } from '../engine/auxetic';
import { evaluate, PIECE_VALUE } from './evaluate';
import { zobristHash } from './zobrist';
import {
  ttProbe,
  ttStore,
  ttNewGeneration,
  ttClear,
  type NodeType,
} from './tt';

export { ttClear };

const MATE_SCORE = 100_000;
const INF = MATE_SCORE * 2;
const MAX_PLY = 32;

interface SearchContext {
  deadline: number;
  nodes: number;
  cancelled: boolean;
  /** killers[ply] = [primary, secondary] — quiet moves that produced a
   *  beta-cutoff at this ply. */
  killers: (Move | null)[][];
}

// History heuristic — persists across moves so quiet moves that historically
// caused cutoffs get sorted earlier. Periodically halved to keep it bounded.
const history: number[][] = Array.from({ length: 64 }, () => new Array(64).fill(0));
let historyTotalDepth = 0;

function squareIdx(sq: SquareId | undefined): number {
  if (!sq) return -1;
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(sq[1]) - 1;
  return rank * 8 + file;
}

function isQuiet(move: Move): boolean {
  return (
    move.kind !== 'capture' &&
    move.kind !== 'promotion' &&
    move.kind !== 'enPassant'
  );
}

function sameMove(a: Move | null | undefined, b: Move | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.kind === b.kind &&
    a.promotion === b.promotion
  );
}

function recordKiller(ctx: SearchContext, ply: number, move: Move): void {
  if (!isQuiet(move)) return;
  if (ply >= MAX_PLY) return;
  const slot = ctx.killers[ply];
  if (sameMove(slot[0], move)) return;
  slot[1] = slot[0];
  slot[0] = move;
}

function recordHistory(move: Move, depth: number): void {
  if (!isQuiet(move)) return;
  const f = squareIdx(move.from);
  const t = squareIdx(move.to);
  if (f < 0 || t < 0) return;
  history[f][t] += depth * depth;
  historyTotalDepth += depth;
  // Cheap decay every ~32 ply of accumulation, so old games don't dominate.
  if (historyTotalDepth > 512) {
    for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) history[i][j] >>= 3;
    historyTotalDepth = 0;
  }
}

function historyScore(move: Move): number {
  const f = squareIdx(move.from);
  const t = squareIdx(move.to);
  if (f < 0 || t < 0) return 0;
  return history[f][t];
}

const TT_MOVE_BONUS = 1_000_000;
const PROMOTION_BONUS = 800_000;
const CAPTURE_BONUS = 100_000;
const KILLER_PRIMARY = 90_000;
const KILLER_SECONDARY = 80_000;

function moveOrderScore(
  move: Move,
  state: BoardState,
  ttMove: Move | null | undefined,
  ctx: SearchContext,
  ply: number,
): number {
  if (sameMove(move, ttMove)) return TT_MOVE_BONUS;
  if (move.kind === 'topologyToggle') return -10;
  if (move.kind === 'promotion') return PROMOTION_BONUS;
  if (move.kind === 'capture' && move.to) {
    const victim = state.pieces[move.to];
    const attacker = move.from ? state.pieces[move.from] : undefined;
    const vv = victim ? PIECE_VALUE[victim.type] : 0;
    const av = attacker ? PIECE_VALUE[attacker.type] : 0;
    return CAPTURE_BONUS + vv * 10 - av;
  }
  if (ply < MAX_PLY) {
    const k = ctx.killers[ply];
    if (sameMove(move, k[0])) return KILLER_PRIMARY;
    if (sameMove(move, k[1])) return KILLER_SECONDARY;
  }
  return historyScore(move);
}

function sortMoves(
  moves: Move[],
  state: BoardState,
  ttMove: Move | null | undefined,
  ctx: SearchContext,
  ply: number,
): void {
  const scored = moves.map((m, i) => ({ m, i, s: moveOrderScore(m, state, ttMove, ctx, ply) }));
  scored.sort((a, b) => b.s - a.s);
  for (let i = 0; i < moves.length; i++) moves[i] = scored[i].m;
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

  const originalAlpha = alpha;
  const hash = zobristHash(state);

  // TT probe — fastest win, before move generation.
  const probe = ttProbe(hash, depth, alpha, beta);
  if (probe?.score !== undefined) {
    return { score: probe.score, bestMove: probe.bestMove ?? null, pv: [] };
  }
  const ttMove = probe?.bestMove ?? null;

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

  sortMoves(candidates, state, ttMove, ctx, ply);

  let bestMove: Move | null = candidates[0];
  let bestPv: readonly Move[] = [];
  let bestScore = -INF;

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

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        bestPv = [move, ...result.pv];
      }
    }

    if (score >= beta) {
      // Fail-high — quiet move that refuted the position; remember it.
      recordKiller(ctx, ply, move);
      recordHistory(move, depth);
      const nodeType: NodeType = 'lower';
      ttStore(hash, depth, beta, move, nodeType);
      return { score: beta, bestMove: move, pv: [] };
    }
  }

  // Choose the bound based on whether we improved alpha. Failed-low (no move
  // beat originalAlpha) → upper bound; otherwise the score is exact.
  let nodeType: NodeType = 'exact';
  if (bestScore <= originalAlpha) nodeType = 'upper';
  ttStore(hash, depth, bestScore, bestMove, nodeType);

  return { score: bestScore, bestMove, pv: bestPv };
}

/** Cheap "does this move attack the opponent's king?" probe. Apply the move,
 *  flip side-to-move, then test isInCheck (which checks current side's king). */
function givesCheck(state: BoardState, move: Move): boolean {
  if (move.kind === 'topologyToggle') return false;
  const after = applyMove(state, move);
  return isInCheck(after);
}

function quiescence(
  state: BoardState,
  alpha: number,
  beta: number,
  depthLeft: number,
  ctx: SearchContext,
  checksLeft: number = 2,
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

  // Tactical move set: captures + promotions always; non-capture checks
  // only while we still have a check budget. Without the budget the qsearch
  // tree explodes (every quiet move that gives check spawns another full
  // qsearch branch).
  const tactical: Array<{ move: Move; isCheckExt: boolean }> = [];
  for (const m of allMoves) {
    if (m.kind === 'capture' || m.kind === 'promotion') {
      tactical.push({ move: m, isCheckExt: false });
    } else if (
      checksLeft > 0 &&
      m.kind !== 'topologyToggle' &&
      givesCheck(state, m)
    ) {
      tactical.push({ move: m, isCheckExt: true });
    }
  }

  // Same MVV/LVA-driven ordering as the main search, minus killer/history
  // (qsearch is shallow and tactical-only — those heuristics aren't useful).
  const orderedMoves = tactical.map((t) => t.move);
  orderedMoves.sort((a, b) => mvvLvaScore(b, state) - mvvLvaScore(a, state));
  const checkExtensionByMove = new Map<Move, boolean>();
  for (const t of tactical) checkExtensionByMove.set(t.move, t.isCheckExt);

  for (const move of orderedMoves) {
    if (ctx.cancelled) break;
    const next = applyMove(state, move);
    const wasCheckExt = checkExtensionByMove.get(move) === true;
    const score = -quiescence(
      next,
      -beta,
      -alpha,
      depthLeft - 1,
      ctx,
      wasCheckExt ? checksLeft - 1 : checksLeft,
    );
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function mvvLvaScore(move: Move, state: BoardState): number {
  if (move.kind === 'promotion') return PROMOTION_BONUS;
  if (move.kind === 'capture' && move.to) {
    const victim = state.pieces[move.to];
    const attacker = move.from ? state.pieces[move.from] : undefined;
    const vv = victim ? PIECE_VALUE[victim.type] : 0;
    const av = attacker ? PIECE_VALUE[attacker.type] : 0;
    return CAPTURE_BONUS + vv * 10 - av;
  }
  return 0;
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

  // Bump TT generation so old entries can be replaced once this search
  // produces deeper data. Killers are reset per search — old plies don't
  // apply once the root position has changed.
  ttNewGeneration();
  const killers: (Move | null)[][] = Array.from({ length: MAX_PLY }, () => [null, null]);

  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const ctx: SearchContext = {
      deadline,
      nodes: 0,
      cancelled: false,
      killers,
    };
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
