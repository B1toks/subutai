import type { BoardState } from '../engine/types';
import { applyMove } from '../engine/moves';
import { applyRotationMove } from '../engine/auxetic';
import type { GameLog } from '../recording/log';
import { classifyMove, type MoveAnalysis } from './classify';

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
  };
}

/**
 * Replays the game forward, classifying each move. Synchronous — for a
 * 30-move game this freezes the main thread for ~5-10s, which is why the
 * caller should show a spinner. Web Worker is intentionally out of scope.
 */
export function analyzeGame(log: GameLog): GameReviewResult {
  const analyses: MoveAnalysis[] = [];
  let current: BoardState = log.initialState;

  for (const entry of log.moves) {
    const move = entry.move;
    let next: BoardState;
    if (move.kind === 'topologyToggle') {
      next = applyRotationMove(current);
    } else if (move.from && move.to) {
      next = applyMove(current, move);
    } else {
      // Pass / no-op moves don't have a meaningful classification.
      analyses.push({ classification: 'good', cpl: 0 });
      continue;
    }
    const analysis = classifyMove(current, move, next);
    analyses.push(analysis);
    current = next;
  }

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

  return {
    moves: analyses,
    stats: { blunders, mistakes, brilliants, checkmate, averageCpl, bestCount },
  };
}
