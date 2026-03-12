import type { BoardState, Move, TopologyState } from '../engine';

export interface LoggedMove {
  readonly san?: string;
  readonly move: Move;
  readonly topologyAfter?: TopologyState;
}

export interface GameLog {
  readonly id: string;
  readonly createdAt: string;
  readonly randomSeed: number;
  readonly initialTopology: TopologyState;
  readonly initialState: BoardState;
  readonly moves: readonly LoggedMove[];
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
  topologyAfter?: TopologyState,
): GameLog {
  return {
    ...log,
    moves: [...log.moves, { san, move, topologyAfter }],
  };
}

export function appendTopologyToggle(
  log: GameLog,
  newTopology: TopologyState,
): GameLog {
  const lastMove = log.moves[log.moves.length - 1];
  if (lastMove) {
    const updatedMoves = [...log.moves];
    updatedMoves[updatedMoves.length - 1] = {
      ...lastMove,
      topologyAfter: newTopology,
    };
    return { ...log, moves: updatedMoves };
  }
  return log;
}
