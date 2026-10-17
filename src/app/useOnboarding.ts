import { useState, useCallback } from 'react';
import { LOCAL_KEYS, localData } from '../infra/localData';

/**
 * The first-visit welcome screen and the guided tour: whether each is up,
 * and the two flags in localStorage that keep them from coming back.
 */
export function useOnboarding() {
  // S2.2 — first-launch tour. Defaults to open until the user finishes
  // or skips it once; replayable from the Help dialog.
  /* V1 — the tour no longer ambushes a first-time visitor. The welcome
   * screen below runs first and the tour starts only if they ask for it
   * (or from Rules & info). Returning players who never finished it are
   * left alone. */
  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      // Anyone who already finished the old tour is not a first-timer.
      if (localData.get(LOCAL_KEYS.tutorialDone) === '1') return false;
      return localData.get(LOCAL_KEYS.welcomeSeen) !== '1';
    } catch {
      return false;
    }
  });
  const dismissWelcome = useCallback((startTour: boolean) => {
    try {
      localData.set(LOCAL_KEYS.welcomeSeen, '1');
    } catch { /* private mode — it will greet them again next visit */ }
    setShowWelcome(false);
    if (startTour) setShowTutorial(true);
  }, []);
  const closeTutorial = useCallback(() => {
    try {
      localData.set(LOCAL_KEYS.tutorialDone, '1');
    } catch { /* private mode — show it again next visit */ }
    setShowTutorial(false);
  }, []);
  return { showTutorial, setShowTutorial, showWelcome, dismissWelcome, closeTutorial };
}
