/* Sprint 4.5 — low-end device detection (the EPS accessibility goal:
 * lower the computational cost so the game runs on cheap hardware).
 *
 * Heuristic only — hardwareConcurrency and deviceMemory are the two
 * signals browsers actually expose. ≤4 cores or ≤4GB reads as "low":
 * budget phones, old laptops, school Chromebooks. Detected once and
 * cached; consumers scale their CPU budgets through the helpers below
 * instead of sprinkling tier checks around.
 */

export type DeviceTier = 'low' | 'high';

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

let cached: DeviceTier | null = null;

export function deviceTier(): DeviceTier {
  if (cached) return cached;
  if (typeof navigator === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as NavigatorWithMemory).deviceMemory ?? 8;
  cached = cores <= 4 || mem <= 4 ? 'low' : 'high';
  return cached;
}

/** Scale a search/eval time budget for the device: low-end machines get
 *  ~45% of the budget so the engine never freezes the UI for seconds.
 *  Depth quality degrades gracefully — iterative deepening returns the
 *  best move found so far when time runs out. */
export function scaleBudgetMs(ms: number): number {
  return deviceTier() === 'low' ? Math.max(150, Math.round(ms * 0.45)) : ms;
}
