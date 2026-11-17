import { useRef, useState } from 'react';

/**
 * The coach's own memory, as App declared it: R5's encouragement in a
 * losing position (the run of bad evals, the move it last spoke on, the
 * last move it checked, and the "try rotating" pulse it asks for) and
 * R15's one-shot-per-game tips, deduped by log.id. State only, no effects:
 * useCoachNudges reads and writes it (the console seams can set the pulse
 * too), the action row and the dock show the pulse. App passes the whole
 * object to useCoachNudges.
 */
export function useCoachState() {
  const encourageBadStreakRef = useRef(0);
  const encourageLastMoveRef = useRef(-99);
  const encourageCheckedMoveRef = useRef(-1);
  const [encourageRotate, setEncourageRotate] = useState(false);
  // R15 step 4-lite — one-shot-per-game coaching beats, deduped by log.id
  // (fresh id per game, survives re-renders).
  const earlyTipLogIdRef = useRef<string | null>(null);
  const rotateTipLogIdRef = useRef<string | null>(null);

  return {
    encourageBadStreakRef,
    encourageLastMoveRef,
    encourageCheckedMoveRef,
    encourageRotate, setEncourageRotate,
    earlyTipLogIdRef,
    rotateTipLogIdRef,
  };
}

/** The coach's own memory (useCoachState), as useCoachNudges sees it. */
export type CoachState = ReturnType<typeof useCoachState>;
