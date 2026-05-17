import type { GameLog } from '../recording/log';
import type { Color, PieceType, BoardState } from '../engine/types';
import { applyMove } from '../engine/moves';
import { toggleTopology } from '../engine/auxetic';
import type { MoveClass } from './classify';

export type GameOutcome = 'human-win' | 'ai-win' | 'draw' | 'human-resign';

export interface MoveQualityCounts {
  brilliant: number;
  best: number;
  good: number;
  mistake: number;
  blunder: number;
}

export interface GamePoints {
  movePoints: number;
  capturePoints: number;
  qualityPoints: number;
  outcomeBonus: number;
  total: number;
  moveCount: number;
  captureValueCp: number;
  moveQualityCounts: MoveQualityCounts;
  /** False when anti-farming kicks in (too short). Resigning a long game
   *  still counts — see RESIGN_SCALE below. */
  counted: boolean;
}

const PIECE_VALUE_CP: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 0,
};

const MIN_COUNTED_MOVES = 10;
// Resigning a long game still earns points, but only half of the move-points
// portion and no capture or outcome bonus — playing it out always pays more.
// Quality bonus is intentionally NOT scaled: good moves before resign still
// reward the player.
const RESIGN_SCALE = 0.5;

/** Per-classification reward for human moves. Positive-only — no penalties. */
export const QUALITY_BONUS: Record<MoveClass, number> = {
  brilliant: 10,
  best: 3,
  good: 1,
  mistake: 0,
  blunder: 0,
  checkmate: 0, // already covered by outcomeBonus
};

export function computeGamePoints(
  log: GameLog,
  outcome: GameOutcome,
  humanColor: Color,
  gameMode: 'classic' | 'roulette' = 'classic',
): GamePoints {
  if (gameMode === 'roulette') {
    return computeRoulettePoints(log, outcome, humanColor);
  }
  return computeClassicPoints(log, outcome, humanColor);
}

// Classic mode: survival-based. Long games + captures + quality bonuses;
// outcome contributes a small finisher (+100 win / +50 draw). MIN_COUNTED
// guards against farming 2-move resigns.
function computeClassicPoints(
  log: GameLog,
  outcome: GameOutcome,
  humanColor: Color,
): GamePoints {
  const moveCount = countAllMoves(log);

  if (moveCount < MIN_COUNTED_MOVES) {
    return zeroResult(moveCount);
  }

  const quality = computeQualityBonus(log, humanColor);

  if (outcome === 'human-resign') {
    const movePoints = Math.floor(moveCount * 5 * RESIGN_SCALE);
    const total = movePoints + quality.bonus;
    return {
      movePoints,
      capturePoints: 0,
      qualityPoints: quality.bonus,
      outcomeBonus: 0,
      total,
      moveCount,
      captureValueCp: 0,
      moveQualityCounts: quality.counts,
      counted: true,
    };
  }

  const movePoints = moveCount * 5;
  const captureValueCp = sumHumanCaptures(log, humanColor);
  const capturePoints = Math.floor(captureValueCp / 10);

  let outcomeBonus = 0;
  if (outcome === 'human-win') outcomeBonus = 100;
  else if (outcome === 'draw') outcomeBonus = 50;

  return {
    movePoints,
    capturePoints,
    qualityPoints: quality.bonus,
    outcomeBonus,
    total: movePoints + capturePoints + quality.bonus + outcomeBonus,
    moveCount,
    captureValueCp,
    moveQualityCounts: quality.counts,
    counted: true,
  };
}

// Roulette mode: win-focused. Zero on loss/resign, small draw consolation,
// huge win base + speed bonus that decays linearly until move 60, plus
// capture-value contribution. Quality bonuses are not computed (the format
// is too chaotic for classifier-driven nuance to be meaningful).
//
//   Loss / resign: 0
//   Draw:          100
//   Win:           500 + max(0, 60 − moveCount) × 15 + capturePts
const ROULETTE_WIN_BASE = 500;
const ROULETTE_DRAW_BONUS = 100;
const ROULETTE_SPEED_CUTOFF = 60;
const ROULETTE_SPEED_PER_MOVE = 15;

function computeRoulettePoints(
  log: GameLog,
  outcome: GameOutcome,
  humanColor: Color,
): GamePoints {
  const moveCount = countAllMoves(log);

  // Loss / resign — still counted so /users.rouletteGamesPlayed ticks up,
  // but contributes nothing to bestPoints.
  if (outcome === 'human-resign' || outcome === 'ai-win') {
    return {
      movePoints: 0,
      capturePoints: 0,
      qualityPoints: 0,
      outcomeBonus: 0,
      total: 0,
      moveCount,
      captureValueCp: 0,
      moveQualityCounts: emptyCounts(),
      counted: true,
    };
  }

  if (outcome === 'draw') {
    return {
      movePoints: 0,
      capturePoints: 0,
      qualityPoints: 0,
      outcomeBonus: ROULETTE_DRAW_BONUS,
      total: ROULETTE_DRAW_BONUS,
      moveCount,
      captureValueCp: 0,
      moveQualityCounts: emptyCounts(),
      counted: true,
    };
  }

  // human-win
  const speedBonus =
    Math.max(0, ROULETTE_SPEED_CUTOFF - moveCount) * ROULETTE_SPEED_PER_MOVE;
  const captureValueCp = sumHumanCaptures(log, humanColor);
  const capturePoints = Math.floor(captureValueCp / 10);
  const total = ROULETTE_WIN_BASE + speedBonus + capturePoints;

  return {
    // movePoints is re-purposed as the speed bonus so existing UI rows
    // render it without a new field. GameSummary relabels the row for
    // roulette ("Speed bonus" vs "Move points").
    movePoints: speedBonus,
    capturePoints,
    qualityPoints: 0,
    outcomeBonus: ROULETTE_WIN_BASE,
    total,
    moveCount,
    captureValueCp,
    moveQualityCounts: emptyCounts(),
    counted: true,
  };
}

function emptyCounts(): MoveQualityCounts {
  return { brilliant: 0, best: 0, good: 0, mistake: 0, blunder: 0 };
}

// Full chess moves played: a "move" is white + black together, so we divide
// the ply count by 2. The 50-move milestone and "lost in N moves" headline
// both read from this — keep it canonical chess counting.
function countAllMoves(log: GameLog): number {
  return Math.floor(log.moves.length / 2);
}

function computeQualityBonus(
  log: GameLog,
  humanColor: Color,
): { bonus: number; counts: MoveQualityCounts } {
  const counts: MoveQualityCounts = {
    brilliant: 0,
    best: 0,
    good: 0,
    mistake: 0,
    blunder: 0,
  };
  let bonus = 0;
  let state: BoardState = log.initialState;

  for (const entry of log.moves) {
    const wasHumanTurn = state.sideToMove === humanColor;
    const cls = entry.analysis?.classification;

    if (wasHumanTurn && cls && cls in counts) {
      counts[cls as keyof MoveQualityCounts]++;
      bonus += QUALITY_BONUS[cls];
    }

    if (entry.move.kind === 'topologyToggle') {
      state = toggleTopology(state);
    } else {
      state = applyMove(state, entry.move);
    }
  }

  return { bonus, counts };
}

function sumHumanCaptures(log: GameLog, humanColor: Color): number {
  let state: BoardState = log.initialState;
  let captured = 0;
  for (const entry of log.moves) {
    const mv = entry.move;
    if (mv.kind === 'topologyToggle') {
      state = toggleTopology(state);
      continue;
    }
    if (state.sideToMove === humanColor) {
      if (mv.kind === 'capture' && mv.to) {
        const victim = state.pieces[mv.to];
        if (victim) captured += PIECE_VALUE_CP[victim.type];
      } else if (mv.kind === 'enPassant') {
        captured += PIECE_VALUE_CP.pawn;
      }
    }
    state = applyMove(state, mv);
  }
  return captured;
}

function zeroResult(moveCount: number): GamePoints {
  return {
    movePoints: 0,
    capturePoints: 0,
    qualityPoints: 0,
    outcomeBonus: 0,
    total: 0,
    moveCount,
    captureValueCp: 0,
    moveQualityCounts: emptyCounts(),
    counted: false,
  };
}
