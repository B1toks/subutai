import { useState, useEffect, type RefObject } from 'react';
import { evalToColors } from './roomColors';
import type { MatchDoc } from '../firebase/matches';
import type { BoardState } from '../engine';

interface UseRoomGradientArgs {
  view: 'game' | 'review' | 'leaderboard' | 'friend-lobby';
  activeMatch: MatchDoc | null;
  state: BoardState;
  myPerspectiveEval: number;
  prevEvalRef: RefObject<number>;
  currentEval: number;
  shellRef: RefObject<HTMLDivElement | null>;
}

/**
 * Paints the room: the shell's two gradient colours follow the viewer's
 * evaluation and the committed topology, and repaint when the theme
 * attribute changes. view and activeMatch are in the deps because the
 * shell element is remounted when they change.
 */
export function useRoomGradient({
  view,
  activeMatch,
  state,
  myPerspectiveEval,
  prevEvalRef,
  currentEval,
  shellRef,
}: UseRoomGradientArgs) {
  // M.23 — evalToColors reads document.documentElement's data-theme
  // attribute imperatively (see the wood-light branch), but ThemeToggle
  // lives in a separate component and writes that attribute directly to
  // the DOM, not through any state this component subscribes to. Without
  // this, switching themes wouldn't repaint the eval-gradient until the
  // NEXT eval/topology change happened to fire the effect below for an
  // unrelated reason — a switch to/from wood-light would visibly lag.
  // themeTick just forces that effect to re-run the instant the attribute
  // actually changes.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Drive the gradient via CSS custom properties. setProperty (rather than
  // inline style) lets the @property-registered transition interpolate
  // colour-to-colour smoothly. prevEvalRef tracks the white-POV value
  // (classifier delta still expects white-POV).
  //
  // T5: paint from the viewer's perspective so each peer in a PvP match
  // sees their OWN winning/losing state — the player who's ahead gets
  // gold/warm, the player who's behind gets crimson/cool, simultaneously.
  //
  // "Rotation changes the room" — keyed off state.topologyState (the
  // COMMITTED board), never previewTopology. A hover-preview of the
  // rotate button is exploratory and reversible; repainting the whole
  // page's mood off a mere hover would feel unstable. The room only
  // shifts once a rotation actually lands, same rule R17c's dust-wave FX
  // already follows.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const { c1, c2 } = evalToColors(myPerspectiveEval, state.topologyState);
    shell.style.setProperty('--eval-c1', c1);
    shell.style.setProperty('--eval-c2', c2);
    prevEvalRef.current = currentEval;
  }, [
    myPerspectiveEval,
    currentEval,
    view,
    activeMatch,
    state.topologyState,
    themeTick,
    prevEvalRef,
    shellRef,
  ]);
}
