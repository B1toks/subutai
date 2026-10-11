import { useEffect, useRef, type RefObject } from 'react';
import { memoryTermination } from '../features/endgame/result';
import { buildSavedGameFromLog, buildSavedGameSnapshot } from './build';
import { localStorageAdapter } from './storage';
import { writeLiveSession, clearLiveSession } from './liveSession';
import type { GameStatus, GameMode } from '../shared/game';
import type { BotStrength } from '../ai/agents';
import type { BoardState } from '../engine';
import type { GameLog } from '../recording/log';

interface UseMemoryAutosaveArgs {
  importedLogIdRef: RefObject<string | null>;
  resumedLogIdRef: RefObject<string | null>;
  opponentMode: 'ai' | 'friend' | 'local';
  isMultiplayer: boolean;
  gameStatus: GameStatus;
  soloTcSec: number | null;
  botLevel: BotStrength;
  gameMode: GameMode;
  state: BoardState;
  log: GameLog;
  savedForLogIdRef: RefObject<string | null>;
  liveSavedGameIdRef: RefObject<string>;
}

/**
 * Keeps Memory in step with a solo or hot-seat game: a live snapshot after
 * every move, the final entry once it ends, and the live-session pointer a
 * new tab resumes from, cleared when the game ends or a fresh board
 * replaces it. Online games are saved to /games instead and skip all this.
 */
export function useMemoryAutosave({
  importedLogIdRef,
  resumedLogIdRef,
  opponentMode,
  isMultiplayer,
  gameStatus,
  soloTcSec,
  botLevel,
  gameMode,
  state,
  log,
  savedForLogIdRef,
  liveSavedGameIdRef,
}: UseMemoryAutosaveArgs) {
  useEffect(() => {
    if (isMultiplayer) return; // PvP games persist via /games, not local Memory
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (savedForLogIdRef.current === log.id) return;

    const sourceId = liveSavedGameIdRef.current;
    const resigned = gameStatus === 'resigned_white' || gameStatus === 'resigned_black';
    const termination = memoryTermination(gameStatus);
    const saved = buildSavedGameFromLog(
      log,
      state,
      termination,
      sourceId,
      resigned ? (gameStatus === 'resigned_white' ? 'black' : 'white') : undefined,
      importedLogIdRef.current === log.id,
    );
    if (localStorageAdapter.saveOrUpdateGame) {
      localStorageAdapter.saveOrUpdateGame(saved);
    } else {
      localStorageAdapter.saveGame(saved);
    }

    // Clean up the live snapshot so Memory shows one final entry.
    if (sourceId) {
      localStorageAdapter.deleteGame?.(sourceId);
    }

    savedForLogIdRef.current = log.id;
  }, [gameStatus, log, state, importedLogIdRef, liveSavedGameIdRef, savedForLogIdRef]);

  useEffect(() => {
    if (isMultiplayer) return; // no local Memory snapshots during PvP
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    const liveId = liveSavedGameIdRef.current;
    if (!liveId) return;
    const snapshot = buildSavedGameSnapshot(log, liveId, importedLogIdRef.current === log.id);
    if (localStorageAdapter.saveOrUpdateGame) {
      localStorageAdapter.saveOrUpdateGame(snapshot);
    } else {
      localStorageAdapter.saveGame(snapshot);
    }
    // V1 — and a pointer saying "this is the game in progress", with the
    // settings a Memory entry does not carry. Resuming a hot-seat game as
    // a bot game would hand black's moves to the engine.
    writeLiveSession({
      gameId: liveId,
      opponentMode: opponentMode === 'local' ? 'local' : 'ai',
      gameMode,
      timed: soloTcSec !== null,
      savedAt: Date.now(),
      botLevel,
      unranked: resumedLogIdRef.current === log.id || importedLogIdRef.current === log.id,
    });
  }, [
    gameStatus,
    log,
    isMultiplayer,
    opponentMode,
    gameMode,
    soloTcSec,
    botLevel,
    importedLogIdRef,
    liveSavedGameIdRef,
    resumedLogIdRef,
  ]);

  // The pointer only means anything while that game is still going. It
  // goes when the game ends — and when a FRESH board replaces it (new game,
  // new position, a replay), or a reload would bring back the game that was
  // just abandoned. Not on the first render, though: that is the empty board
  // every page load starts with, and the resume below has not read the
  // pointer yet.
  const mountLogIdRef = useRef(log.id);
  useEffect(() => {
    if (isMultiplayer) return;
    const freshBoardReplacedIt = log.moves.length === 0 && log.id !== mountLogIdRef.current;
    if (gameStatus !== 'active' || freshBoardReplacedIt) clearLiveSession();
  }, [gameStatus, log.id, log.moves.length, isMultiplayer]);
}
