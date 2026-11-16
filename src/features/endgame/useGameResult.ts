import { useState, type RefObject } from 'react';
import type { User } from 'firebase/auth';
import type { BotStrength } from '../../ai/agents';
import { computeGamePoints, type GameOutcome, type GamePoints } from '../../analysis/points';
import type { ToastContextValue } from '../../components/Toast';
import { useSessionEventsAfterCommit } from '../../session/useSessionEvents';
import { HUMAN_COLOR } from '../../shared/game';
import { nowMs } from '../../utils/nowMs';
import { useMoveMilestones } from '../game/useMoveMilestones';
import type { WatchingGame } from '../review/watching';
import { soloOutcome } from './result';
import { useGameSaveQueue, type FinishedGameSave } from './useGameSaveQueue';
import { useSession } from '../../session/useSession';
import { gameStatusOf, boardOf, logOf, modeOf } from '../game/boardView';

interface UseGameResultArgs {
  isAutoMode: boolean;
  isMultiplayer: boolean;
  isLocalMode: boolean;
  opponentMode: 'ai' | 'friend' | 'local';
  watchingGame: WatchingGame | null;
  /** The game's 960 code, as the chip shows it (App's positionLabel). */
  positionLabel: string;
  botLevel: BotStrength;
  authLoading: boolean;
  user: User | null;
  displayName: string | null;
  toast: ToastContextValue;
  /** Wall-clock when the game on the board began (App's ref). */
  gameStartedAtRef: RefObject<number>;
  /** The log id whose ending has been handled; Watch, Resign, the flag
   *  fall and Load replay stamp it too, so it stays App's ref. */
  completedLogIdRef: RefObject<string | null>;
  /** The log ids of a game loaded from a replay, and of one resumed from
   *  Memory (useResumeGame, useReplayImport write them; Memory's autosave
   *  reads them). Such games are never ranked. */
  importedLogIdRef: RefObject<string | null>;
  resumedLogIdRef: RefObject<string | null>;
}

/**
 * The end of a solo game against the bot, and its state: the summary (the
 * points, the outcome, the duration, whether it was ranked and why not),
 * the save to Firestore (useGameSaveQueue) with the rank and the best it
 * brings back, and the 50-move dialog on the way there (useMoveMilestones).
 * The session's gameEnd event, handled after the render that shows the
 * ending, starts it: finishGame scores the game, opens the summary and
 * queues the save. Resign calls finishGame itself. reset() is the group's
 * part of App's resetGameEndState: every way into a new board calls it.
 *
 * App calls this where the completion handler stood, which is before
 * useSoloFlagFall: that effect dispatches the flag fall in its body, and
 * the handler must already have drained its queue in that commit.
 */
export function useGameResult({
  isAutoMode,
  isMultiplayer,
  isLocalMode,
  opponentMode,
  watchingGame,
  positionLabel,
  botLevel,
  authLoading,
  user,
  displayName,
  toast,
  gameStartedAtRef,
  completedLogIdRef,
  importedLogIdRef,
  resumedLogIdRef,
}: UseGameResultArgs) {
  const gameStatus = useSession(gameStatusOf);
  const state = useSession(boardOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
  const gameMode = useSession(modeOf(isMultiplayer));
  const seed = useSession((s) => s.seed);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastGamePoints, setLastGamePoints] = useState<GamePoints | null>(null);
  // Stage P addendum 7: captured at finishGame so the GameSummary modal
  // keeps the previous game's duration even after Play Again resets the
  // running start-time ref.
  const [lastGameDurationMs, setLastGameDurationMs] = useState<number | null>(
    null,
  );
  const [gameOutcome, setGameOutcome] = useState<GameOutcome | null>(null);
  const [savingGame, setSavingGame] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [lastGameId, setLastGameId] = useState<string | null>(null);
  const [milestoneShown, setMilestoneShown] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  // Whether the game the summary is about was imported (for its wording).
  const [lastGameImported, setLastGameImported] = useState(false);
  const [lastGameResumed, setLastGameResumed] = useState(false);

  // Game-completion pipeline: the session's gameEnd event, handled after the
  // render that shows the ending, computes points, opens the GameSummary
  // modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode, a game ending twice).
  // Auto mode handles completion via its own effect — never enters this path.
  useSessionEventsAfterCommit((events) => {
    if (!events.some((e) => e.type === 'gameEnd')) return;
    if (isAutoMode) return;
    if (isMultiplayer) return; // MP completion runs through a separate effect
    // R13/BUG-5 — local hot-seat is two humans on one device: its results
    // must never reach finishGame (solo leaderboard, personal best,
    // "human-win" attribution are all meaningless there). The game-over
    // banner is the whole ending.
    if (isLocalMode) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    // One completion per game, keyed by the log id alone. Resign stamps the
    // id itself before flipping the status, so it is skipped here too. This
    // used to also bail on any gameOutcome, which leaked the previous
    // game's ending into the next one (QA-01).
    if (completedLogIdRef.current === log.id) return;
    completedLogIdRef.current = log.id;

    // The handler runs after the commit, through useEffectEvent (useSessionEventsAfterCommit),
    // always with this render's finishGame; declared above, finishGame would only move the
    // same report onto what it reads (queueSave), declared below it.
    // eslint-disable-next-line react-hooks/immutability -- see the three lines above
    void finishGame(soloOutcome(gameStatus, state.sideToMove));
  });

  async function finishGame(outcome: GameOutcome) {
    const computed = computeGamePoints(log, outcome, HUMAN_COLOR, gameMode);
    // V1 — only full-strength games are ranked. Practice levels still get
    // the full breakdown on screen and are saved (with their level) for the
    // data pipeline, but never touch personal best / leaderboard stats.
    const rankedLevel = botLevel === 'strong';
    // QA-02 — nor is a game loaded from a pasted log, at any level: its
    // moves were never played here. counted: false also keeps strongWins
    // (gated on counted in saveCompletedGame) from growing.
    const imported = importedLogIdRef.current === log.id;
    setLastGameImported(imported);
    // N-1 — nor is a game restored from Memory. A Memory entry does not say
    // who the moves were played against: a position played out for both
    // sides in Local can be resumed against the bot and won in a move.
    const resumed = resumedLogIdRef.current === log.id;
    setLastGameResumed(resumed);
    const points: GamePoints =
      rankedLevel && !imported && !resumed ? computed : { ...computed, counted: false };
    const durationMs = nowMs() - gameStartedAtRef.current;
    setGameOutcome(outcome);
    setLastGamePoints(points);
    setLastGameDurationMs(durationMs);
    setSummaryOpen(true);
    setSaveError(null);
    setIsNewBest(false);
    setCurrentRank(null);

    const job: FinishedGameSave = {
      outcome,
      points,
      durationMs,
      log,
      gameMode,
      botLevel,
      chess960Id: positionLabel,
      seed,
    };
    if (!user || !displayName) {
      // N-6 — the page has only just opened (a reload, a new tab) and the
      // sign-in has not answered yet: the game on the board came back from
      // Memory in ~0.2 s, the user takes a moment longer, and a game that
      // ends in between used to show its summary and never be saved (this
      // runs once per game). Keep the finished game and save it as soon as
      // the sign-in resolves. Signed out for good / no name yet: show the
      // summary locally and skip Firestore, as before.
      if (authLoading) {
        pendingSaveRef.current.push(job);
        setSavingGame(true);
      }
      return;
    }
    await queueSave(job, user.uid, displayName);
  }
  const { queueSave, pendingSaveRef } = useGameSaveQueue({
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
  });

  useMoveMilestones({
    isAutoMode,
    milestoneShown,
    setMilestoneShown,
    setShowMilestoneModal,
    opponentMode,
    isMultiplayer,
    watchingGame,
    gameStatus,
    log,
    toast,
  });

  /** Everything the previous game's ending left in this group (QA-01). */
  function reset() {
    setSummaryOpen(false);
    setLastGamePoints(null);
    setGameOutcome(null);
    setSavingGame(false);
    setSaveError(null);
    setCurrentRank(null);
    setIsNewBest(false);
    setPersonalBest(null);
    setLastGameId(null);
    setMilestoneShown(false);
    setShowMilestoneModal(false);
    setLastGameImported(false);
    setLastGameResumed(false);
  }

  return {
    summaryOpen,
    setSummaryOpen,
    lastGamePoints,
    lastGameDurationMs,
    gameOutcome,
    setGameOutcome,
    savingGame,
    saveError,
    currentRank,
    isNewBest,
    personalBest,
    lastGameId,
    lastGameImported,
    lastGameResumed,
    showMilestoneModal,
    setShowMilestoneModal,
    finishGame,
    reset,
  };
}
