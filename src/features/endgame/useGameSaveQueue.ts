import { useRef, useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { User } from 'firebase/auth';
import { gamesRepo } from '../../infra/firestore/games';
import { createSaveQueue, type FinishedGameSave } from '../../services/saveQueue';

export type { FinishedGameSave };

interface UseGameSaveQueueArgs {
  authLoading: boolean;
  user: User | null;
  displayName: string | null;
  setSavingGame: Dispatch<SetStateAction<boolean>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setCurrentRank: Dispatch<SetStateAction<number | null>>;
  setIsNewBest: Dispatch<SetStateAction<boolean>>;
  setPersonalBest: Dispatch<SetStateAction<number | null>>;
  setLastGameId: Dispatch<SetStateAction<string | null>>;
  completedLogIdRef: RefObject<string | null>;
}

/**
 * Saves finished solo games to Firestore one at a time (the save queue,
 * src/services/saveQueue.ts, over gamesRepo), fills the summary's rank and
 * best while that game is still the one shown, and saves games that ended
 * before sign-in answered once it does. finishGame in App builds the jobs.
 */
export function useGameSaveQueue({
  authLoading,
  user,
  displayName,
  setSavingGame,
  setSaveError,
  setCurrentRank,
  setIsNewBest,
  setPersonalBest,
  setLastGameId,
  completedLogIdRef,
}: UseGameSaveQueueArgs) {

  // QA-06 — one save at a time (src/services/saveQueue.ts). Built on the
  // first save; what it fills in is this game's summary while it is shown.
  const queueRef = useRef<ReturnType<typeof createSaveQueue> | null>(null);
  function queueSave(job: FinishedGameSave, uid: string, name: string): Promise<void> {
    queueRef.current ??= createSaveQueue(gamesRepo, {
      shows: (logId) => completedLogIdRef.current === logId,
      setSaving: setSavingGame,
      setPersonalBest,
      setSaved: ({ gameId, isNewBest, newRank }) => {
        setLastGameId(gameId);
        setIsNewBest(isNewBest);
        setCurrentRank(newRank);
      },
      setError: setSaveError,
    });
    return queueRef.current.queue(job, uid, name);
  }

  // N-6 — finished games waiting for the sign-in (see finishGame). A list:
  // a second game can end before the sign-in answers.
  const pendingSaveRef = useRef<FinishedGameSave[]>([]);
  useEffect(() => {
    const jobs = pendingSaveRef.current;
    if (jobs.length === 0 || authLoading) return;
    pendingSaveRef.current = [];
    if (!user || !displayName) {
      // Signed out after all: nothing to save to.
      if (jobs.some((j) => completedLogIdRef.current === j.log.id)) setSavingGame(false);
      return;
    }
    for (const job of jobs) void queueSave(job, user.uid, displayName);
    // queueSave / saveFinishedGame close over nothing but stable setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, displayName]);
  return { queueSave, pendingSaveRef };
}
