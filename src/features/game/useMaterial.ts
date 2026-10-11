import { useMemo } from 'react';
import { countMaterial } from './material';
import type { BoardState } from '../../engine';

interface UseMaterialArgs {
  state: BoardState;
  myColor: 'white' | 'black';
}

/** The material on the board, and its balance from the viewer's side. */
export function useMaterial({ state, myColor }: UseMaterialArgs) {
  const materialBreakdown = useMemo(() => countMaterial(state.pieces), [state.pieces]);

  // materialBreakdown.score is white-perspective (whiteTotal - blackTotal).
  // T5.1: flip for the black seat in PvP so the counter follows the same
  // viewer-perspective convention as the eval bar and gradient — green
  // when I'm up material, red when down.
  const materialScore =
    myColor === 'black' ? -materialBreakdown.score : materialBreakdown.score;
  return { materialBreakdown, materialScore };
}
