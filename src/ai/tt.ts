import type { Move } from '../engine/types';

export type NodeType = 'exact' | 'lower' | 'upper';

export interface TTEntry {
  hash: number;
  depth: number;
  score: number;
  bestMove: Move | null;
  type: NodeType;
  age: number;
}

// 2^18 entries × ~48 bytes each ≈ 12 MB. Bumped from 2^16 in Stage L —
// the faster single-pass evaluator lets us explore noticeably more nodes
// within the same time budget, so a larger TT pays for itself in hit rate.
const TT_SIZE = 1 << 18;
const TT_MASK = TT_SIZE - 1;

const table: (TTEntry | null)[] = new Array(TT_SIZE).fill(null);
let currentAge = 0;

export interface TTProbeResult {
  /** Defined only when the entry was deep enough AND its bound applies. */
  score?: number;
  /** Always returned when the slot matches our hash, regardless of depth —
   *  a hint for move ordering even if we couldn't reuse the score. */
  bestMove?: Move | null;
}

export function ttProbe(
  hash: number,
  depth: number,
  alpha: number,
  beta: number,
): TTProbeResult | null {
  const entry = table[hash & TT_MASK];
  if (!entry || entry.hash !== hash) return null;

  // Stored depth is shallower — score isn't safe to reuse, but the bestMove
  // still helps move ordering.
  if (entry.depth < depth) return { bestMove: entry.bestMove };

  if (entry.type === 'exact') return { score: entry.score, bestMove: entry.bestMove };
  if (entry.type === 'lower' && entry.score >= beta) {
    return { score: entry.score, bestMove: entry.bestMove };
  }
  if (entry.type === 'upper' && entry.score <= alpha) {
    return { score: entry.score, bestMove: entry.bestMove };
  }
  return { bestMove: entry.bestMove };
}

export function ttStore(
  hash: number,
  depth: number,
  score: number,
  bestMove: Move | null,
  type: NodeType,
): void {
  const idx = hash & TT_MASK;
  const existing = table[idx];
  // Replace if the slot is empty, the new entry is deeper, or the slot is
  // from a previous search generation (likely stale).
  if (!existing || depth >= existing.depth || existing.age < currentAge) {
    table[idx] = { hash, depth, score, bestMove, type, age: currentAge };
  }
}

/** Bump the generation counter — old entries become eligible for replacement
 *  but stay usable for move-ordering hints until overwritten. Call at the
 *  start of each fresh iterativeDeepen invocation. */
export function ttNewGeneration(): void {
  currentAge++;
}

/** Wipe the entire table. Call on new game / position reset so stale entries
 *  from a previous game can't bias the search. */
export function ttClear(): void {
  table.fill(null);
  currentAge = 0;
}
