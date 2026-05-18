import type { BoardState } from '../engine/types';
import { applyMove } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import type { GameLog } from '../recording/log';
import { type MoveAnalysis } from './classify';
import { classifyAsync } from './classifyClient';

export interface GameReviewResult {
  /** Per-move analysis, parallel to log.moves. */
  readonly moves: readonly MoveAnalysis[];
  /** Reuses classify's "highest-priority class" for the run as a whole. */
  readonly stats: {
    readonly blunders: number;
    readonly mistakes: number;
    readonly brilliants: number;
    readonly checkmate: number;
    readonly averageCpl: number;
    readonly bestCount: number;
    /** 0-100 accuracy derived from averageCpl via chess.com-style
     *  exponential curve. Clamped — never negative, never above 100. */
    readonly accuracy: number;
  };
}

/** Chess.com's curve, rounded. 0 cpl ≈ 100%, 25 cpl ≈ 80%, 50 cpl ≈ 65%,
 *  100 cpl ≈ 40%, 200+ cpl → 0%. */
function computeAccuracy(avgCpl: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * avgCpl) - 3.1668;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Replays the game forward, queuing each move for classification on the
 * Worker thread. The worker processes them serially (so the UI stays
 * responsive); we collect results via Promise.all. Progress fires after
 * each completion.
 */
export async function analyzeGame(
  log: GameLog,
  opts?: {
    onProgress?: (done: number, total: number) => void;
    budgetMs?: number;
    maxDepth?: number;
  },
): Promise<GameReviewResult> {
  const budgetMs = opts?.budgetMs ?? 2000;
  const maxDepth = opts?.maxDepth ?? 8;
  // Q.D.8: replay-side analysis must match the rules the game was played
  // under. Roulette games have no check enforcement; passing the option
  // keeps the worker's internal search consistent.
  const allowSelfCheck = log.gameMode === 'roulette';

  // Pre-compute all positions synchronously — cheap, no search.
  const states: BoardState[] = [log.initialState];
  for (const entry of log.moves) {
    const move = entry.move;
    if (move.kind === 'topologyToggle') {
      states.push(applyRotationMove(states[states.length - 1]));
    } else if (move.from && move.to) {
      states.push(applyMove(states[states.length - 1], move));
    } else {
      states.push(states[states.length - 1]);
    }
  }

  let done = 0;
  const total = log.moves.length;
  // Queue all classifies into the worker. Worker processes serially so the
  // main thread never blocks; Promise.all collects them in order.
  const promises: Promise<MoveAnalysis>[] = log.moves.map((entry, i) => {
    const move = entry.move;
    if (move.kind === 'topologyToggle' || !move.from || !move.to) {
      done++;
      opts?.onProgress?.(done, total);
      return Promise.resolve<MoveAnalysis>({
        classification: 'good',
        cpl: 0,
        searchScoreFromWhite: 0,
      });
    }
    return classifyAsync(states[i], move, states[i + 1], { budgetMs, maxDepth, allowSelfCheck }).then(
      (a) => {
        done++;
        opts?.onProgress?.(done, total);
        return a;
      },
    );
  });
  const analyses = await Promise.all(promises);

  let blunders = 0;
  let mistakes = 0;
  let brilliants = 0;
  let checkmate = 0;
  let bestCount = 0;
  let cplSum = 0;
  let cplDivisor = 0;
  for (const a of analyses) {
    if (a.classification === 'blunder') blunders++;
    else if (a.classification === 'mistake') mistakes++;
    else if (a.classification === 'brilliant') brilliants++;
    else if (a.classification === 'checkmate') checkmate++;
    else if (a.classification === 'best') bestCount++;
    if (a.classification !== 'checkmate' && a.classification !== 'brilliant') {
      cplSum += a.cpl;
      cplDivisor++;
    }
  }
  const averageCpl = cplDivisor > 0 ? Math.round(cplSum / cplDivisor) : 0;
  const accuracy = computeAccuracy(averageCpl);

  return {
    moves: analyses,
    stats: {
      blunders,
      mistakes,
      brilliants,
      checkmate,
      averageCpl,
      bestCount,
      accuracy,
    },
  };
}
