import { useRef, useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { User } from 'firebase/auth';
import { getPersonalBest, saveCompletedGame } from '../../firebase/games';
import { HUMAN_COLOR, type GameMode } from '../../shared/game';
import type { GameOutcome, GamePoints } from '../../analysis/points';
import type { GameLog } from '../../recording/log';
import type { BotStrength } from '../../ai/agents';

/** A finished solo game, as finishGame hands it to the Firestore save. */
export interface FinishedGameSave {
  outcome: GameOutcome;
  points: GamePoints;
  durationMs: number;
  log: GameLog;
  gameMode: GameMode;
  botLevel: BotStrength;
  chess960Id: string;
  seed: number;
}

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
 * Saves finished solo games to Firestore one at a time (the rules count a
 * Strong win only after the profile's previous save), fills the summary's
 * rank and best while that game is still the one shown, and saves games
 * that ended before sign-in answered once it does. finishGame in App
 * builds the jobs.
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

  /** The Firestore half of finishGame (also run later, see N-6). The UI
   *  state it fills in belongs to the summary of that game, so it is only
   *  touched while that game is still the last one finished. */
  async function saveFinishedGame(job: FinishedGameSave, uid: string, name: string) {
    const stillShown = () => completedLogIdRef.current === job.log.id;
    if (stillShown()) setSavingGame(true);
    try {
      // Snapshot the pre-write best so the modal can show "old" alongside new.
      const oldBest = await getPersonalBest(uid, job.gameMode);
      if (stillShown()) setPersonalBest(oldBest);

      const { gameId, isNewBest: nb, newRank } = await saveCompletedGame({
        uid,
        displayName: name,
        log: job.log,
        outcome: job.outcome,
        points: job.points,
        chess960Id: job.chess960Id,
        seed: job.seed,
        humanColor: HUMAN_COLOR,
        gameMode: job.gameMode,
        durationMs: job.durationMs,
        botLevel: job.botLevel,
      });
      if (stillShown()) {
        setLastGameId(gameId);
        setIsNewBest(nb);
        setCurrentRank(newRank);
        if (nb) setPersonalBest(job.points.total);
      }
    } catch (err) {
      console.error('[finishGame] save failed', err);
      // QA-03 — a refusal by the rules is not a connection problem, and
      // telling the player to check their connection sent them the wrong way.
      const denied = (err as { code?: unknown } | null)?.code === 'permission-denied';
      if (stillShown()) {
        setSaveError(
          denied
            ? 'This game wasn’t counted: the server refused to save it.'
            : 'Could not save this game. Check your connection.',
        );
      }
    } finally {
      if (stillShown()) setSavingGame(false);
    }
  }

  // QA-06 — one save at a time: the rules count a Strong win only for a
  // game saved after the profile's previous save, so two saves racing
  // could refuse the later one's stats. saveFinishedGame never rejects.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  function queueSave(job: FinishedGameSave, uid: string, name: string): Promise<void> {
    const next = saveChainRef.current.then(() => saveFinishedGame(job, uid, name));
    saveChainRef.current = next;
    return next;
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
