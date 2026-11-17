import { useRef, useState } from 'react';
import type { SquareId } from '../../engine';

/**
 * The classifier's marks on the board, as App declared them: the square
 * that pulses after a blunder or a brilliant move, and the sacrifice
 * square (Sprint 2.7), each with the timer that clears it. State only, no
 * effects: useClassifier sets them, the tiles draw them, the music hears
 * the sacrifice. App passes the whole object to useClassifier and
 * BoardTiles.
 */
export function useMoveVerdicts() {
  // Square to pulse-highlight after a blunder/brilliant. Cleared after the
  // animation duration (4 cycles × 600ms = 2.4s, rounded to 2500).
  const [classifiedSquare, setClassifiedSquare] = useState<{
    square: SquareId;
    classification: 'blunder' | 'brilliant';
  } | null>(null);
  const classifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sprint 2.7 — separate "sacrifice" highlight, fires in parallel with
  // the brilliant flag when analysis flags the move as a true sacrifice
  // (piece walked onto attacked square + position still holds). Distinct
  // visual (violet burst + sparkles) so a sacrifice reads differently
  // from an ordinary tactical brilliancy.
  const [sacrificeSquare, setSacrificeSquare] = useState<SquareId | null>(null);
  const sacrificeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return {
    classifiedSquare, setClassifiedSquare,
    classifyTimerRef,
    sacrificeSquare, setSacrificeSquare,
    sacrificeTimerRef,
  };
}

/** The classifier's marks (useMoveVerdicts), as useClassifier and BoardTiles see them. */
export type MoveVerdicts = ReturnType<typeof useMoveVerdicts>;
