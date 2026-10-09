import type { SquareId } from '../../engine';

// Sprint 3.6 — right-click annotations: coloured squares and arrows the
// player draws on the board for themselves.

export type AnnotationColor = 'green' | 'red' | 'yellow' | 'blue';

export interface ArrowAnnotation {
  from: SquareId;
  to: SquareId;
  color: AnnotationColor;
}

/** The colour a right-click draws in, picked by the modifier key held. */
export function colorFromMouseEvent(e: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): AnnotationColor {
  if (e.shiftKey) return 'red';
  if (e.altKey) return 'yellow';
  if (e.ctrlKey || e.metaKey) return 'blue';
  return 'green';
}
