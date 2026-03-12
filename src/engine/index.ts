import type { BoardState } from './types';
import { chess960BackRank } from './variants/chess960';

export function createStartingPosition(seed: number): BoardState {
  const base = chess960BackRank(seed);
  return {
    ...base,
    topologyState: 'A',
  };
}

export * from './types';
export * from './board';
