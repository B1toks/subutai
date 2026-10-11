import { useState, useMemo, useRef } from 'react';
import { evaluateFromWhite } from './position';
import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import type { BoardState } from '../../engine';

interface UseEvalArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  state: BoardState;
}

/**
 * The evaluation of the position: the search's score (and mate distance)
 * once the classifier pushes one, else the static evaluator; the same
 * score from the viewer's side for the bar and the room's colours.
 */
export function useEval({ isMultiplayer, mpSync, state }: UseEvalArgs) {
  // --- Dynamic evaluation + background --------------------------------------
  // Search-backed eval (White-perspective, centipawns) gets pushed in by the
  // classifier after every move. While null (start-of-game / fresh reset)
  // we fall back to the static evaluator so the bar isn't blank.
  const [searchEvalFromWhite, setSearchEvalFromWhite] = useState<number | null>(null);
  // Set when the search found a forced mate from the post-move position.
  const [searchMateInPlies, setSearchMateInPlies] = useState<number | null>(null);
  // currentEval is the canonical WHITE-perspective centipawn score. The
  // engine, classifier, prev-eval delta tracking and any future
  // server-side persistence all want this monotonic shape.
  const currentEval = useMemo(() => {
    if (isMultiplayer) return evaluateFromWhite(state);
    if (searchEvalFromWhite !== null) return searchEvalFromWhite;
    return evaluateFromWhite(state);
  }, [isMultiplayer, searchEvalFromWhite, state]);

  // T5: viewer-perspective eval — positive = "I'm winning". Drives the
  // background gradient AND the eval-bar fill so the player who's behind
  // sees a cool/crimson room and a near-empty bar, while their opponent
  // simultaneously sees gold + a near-full bar. Single-player path is
  // myColor='white' so this is a no-op there.
  const myColor: 'white' | 'black' =
    isMultiplayer && mpSync ? mpSync.myColor : 'white';
  const myPerspectiveEval = useMemo(
    () => (myColor === 'black' ? -currentEval : currentEval),
    [currentEval, myColor],
  );
  // Previous eval — kept for delta comparisons used by the classifier.
  const prevEvalRef = useRef<number>(currentEval);
  return {
    searchEvalFromWhite,
    setSearchEvalFromWhite,
    searchMateInPlies,
    setSearchMateInPlies,
    currentEval,
    myColor,
    myPerspectiveEval,
    prevEvalRef,
  };
}
