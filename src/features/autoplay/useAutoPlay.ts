import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import type { GameOutcome } from '../../analysis/points';
import { HUMAN_COLOR, type GameStatus } from '../../shared/game';
import { evaluate } from '../../ai/evaluate';
import { gamesRepo } from '../../infra/firestore/games';
import { backRankString } from '../game/position';
import type { BoardState } from '../../engine';
import type { GameLog } from '../../recording/log';

// Bumped per release so /training_games docs can be filtered by engine
// version when we later use them for training data.
const AI_VERSION = 'stage-j';
// The pause before the next self-play game, and how long a run may go
// without a move before the watchdog starts a fresh game.
const AUTO_BETWEEN_GAMES_MS = 600;
const AUTO_WATCHDOG_MS = 60_000;

interface UseAutoPlayArgs {
  isAutoMode: boolean;
  maxGames: number;
  setAutoGamesCompleted: Dispatch<SetStateAction<number>>;
  autoGamesCompleted: number;
  setAutoLastOutcome: Dispatch<SetStateAction<GameOutcome | null>>;
  setAutoMoveHistory: Dispatch<SetStateAction<number[]>>;
  autoStopped: boolean;
  setAutoStopped: Dispatch<SetStateAction<boolean>>;
  setAutoStoppedReason: Dispatch<SetStateAction<string | null>>;
  autoNextGameTimerRef: RefObject<number | null>;
  autoLastMoveAtRef: RefObject<number>;
  autoSavedLogIdRef: RefObject<string | null>;
  seed: number;
  initialState: BoardState;
  gameStatus: GameStatus;
  state: BoardState;
  log: GameLog;
  gameStartedAtRef: RefObject<number>;
  startNewGame: () => void;
}

/**
 * The self-play run (?auto=1): saves each finished game to
 * /training_games and starts the next, stops at ?max=N, restarts a game
 * the bot has stalled in, clears its timers on unmount, and stopAuto ends
 * the run. The moves themselves come from scheduleAutoMove in App.
 */
export function useAutoPlay({
  isAutoMode,
  maxGames,
  setAutoGamesCompleted,
  autoGamesCompleted,
  setAutoLastOutcome,
  setAutoMoveHistory,
  autoStopped,
  setAutoStopped,
  setAutoStoppedReason,
  autoNextGameTimerRef,
  autoLastMoveAtRef,
  autoSavedLogIdRef,
  seed,
  initialState,
  gameStatus,
  state,
  log,
  gameStartedAtRef,
  startNewGame,
}: UseAutoPlayArgs) {
  // Auto-mode completion: when a self-play game ends, save to
  // /training_games (separate collection from the human leaderboard) and
  // queue the next game. Bypasses the regular finishGame path entirely.
  useEffect(() => {
    if (!isAutoMode) return;
    if (autoStopped) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (autoSavedLogIdRef.current === log.id) return;
    autoSavedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      // The side now to move was just checkmated. White=human alias gives us
      // a "human-win"/"ai-win" mapping consistent with the rest of the codebase.
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
      outcome = 'human-win';
    } else {
      outcome = 'draw';
    }
    const moveCount = Math.floor(log.moves.length / 2);
    const finalEvalFromWhite =
      state.sideToMove === 'white' ? evaluate(state) : -evaluate(state);

    setAutoLastOutcome(outcome);
    setAutoGamesCompleted((n) => n + 1);
    setAutoMoveHistory((prev) => {
      const next = [...prev, moveCount];
      // Keep the rolling average bounded.
      return next.length > 50 ? next.slice(-50) : next;
    });

    void gamesRepo.saveTraining({
      log,
      chess960Id: backRankString(initialState),
      seed,
      outcome,
      moveCount,
      finalEvalFromWhite,
      aiVersion: AI_VERSION,
      durationMs: Date.now() - gameStartedAtRef.current,
    }).catch((err) => {
      console.error('[autoplay] saveTrainingGame failed', err);
    });

    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    autoNextGameTimerRef.current = setTimeout(() => {
      startNewGame();
    }, AUTO_BETWEEN_GAMES_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped, gameStatus, log.id, log.moves.length]);

  // Capped-run stop: once the requested number of games is reached, stop
  // queuing new ones. The current game finishes saving but the loop ends.
  useEffect(() => {
    if (!isAutoMode || maxGames <= 0 || autoStopped) return;
    if (autoGamesCompleted >= maxGames) {
      setAutoStopped(true);
      setAutoStoppedReason(`Done. ${autoGamesCompleted} games completed.`);
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    }
  }, [
    autoGamesCompleted,
    maxGames,
    isAutoMode,
    autoStopped,
    autoNextGameTimerRef,
    setAutoStopped,
    setAutoStoppedReason,
  ]);

  // Watchdog: if no move has been made in 60s, the AI has hung (rare). Reset.
  useEffect(() => {
    if (!isAutoMode || autoStopped) return;
    const id = setInterval(() => {
      if (Date.now() - autoLastMoveAtRef.current > AUTO_WATCHDOG_MS) {
        console.warn('[autoplay] watchdog: no move in 60s, forcing new game');
        autoLastMoveAtRef.current = Date.now();
        autoSavedLogIdRef.current = null;
        startNewGame();
      }
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped]);

  // Clear auto timers on unmount.
  useEffect(() => {
    return () => {
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    };
  }, [autoNextGameTimerRef]);

  function stopAuto() {
    setAutoStopped(true);
    setAutoStoppedReason('Stopped by user.');
    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    // Navigate back to the clean URL so a reload exits auto mode entirely.
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('auto');
      url.searchParams.delete('max');
      window.location.href = url.toString();
    }, 400);
  }
  return { stopAuto };
}
