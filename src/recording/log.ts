import type { BoardState, Move, TopologyState } from '../engine';

export interface LoggedMove {
  readonly san?: string;
  readonly move: Move;
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
): GameLog {
  return {
    ...log,
    moves: [...log.moves, { san, move }],
  };
}
