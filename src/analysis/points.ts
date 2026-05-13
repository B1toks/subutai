import type { GameLog } from '../recording/log';
import type { Color, PieceType, BoardState } from '../engine/types';
import { applyMove } from '../engine/moves';
import { toggleTopology } from '../engine/auxetic';

export type GameOutcome = 'human-win' | 'ai-win' | 'draw' | 'human-resign';

export interface GamePoints {
  movePoints: number;
  capturePoints: number;
  outcomeBonus: number;
  total: number;
  moveCount: number;
  captureValueCp: number;
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
const RESIGN_SCALE = 0.5;

export function computeGamePoints(
  log: GameLog,
  outcome: GameOutcome,
  humanColor: Color,
): GamePoints {
  const moveCount = countAllMoves(log);

  if (moveCount < MIN_COUNTED_MOVES) {
    return zeroResult(moveCount);
  }

  if (outcome === 'human-resign') {
    const movePoints = Math.floor(moveCount * 5 * RESIGN_SCALE);
    return {
      movePoints,
      capturePoints: 0,
      outcomeBonus: 0,
      total: movePoints,
      moveCount,
      captureValueCp: 0,
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
    outcomeBonus,
    total: movePoints + capturePoints + outcomeBonus,
    moveCount,
    captureValueCp,
    counted: true,
  };
}

function countAllMoves(log: GameLog): number {
  return log.moves.length;
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
    outcomeBonus: 0,
    total: 0,
    moveCount,
    captureValueCp: 0,
    counted: false,
  };
}
