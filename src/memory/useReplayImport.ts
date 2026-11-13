import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { BoardState, TopologyState } from '../engine';
import type { useClassifier } from '../features/game/useClassifier';
import { session } from '../session/session';
import type { GameMode, GameStatus } from '../shared/game';
import { buildSavedGameSnapshot } from './build';
import { NotationParseError } from './notation';
import { replayFromNotation } from './replayImport';
import { localStorageAdapter } from './storage';

interface UseReplayImportArgs {
  gameMode: GameMode;
  /** The Load replay dialog: the pasted text, its error, open or not (App state). */
  replayText: string;
  setReplayText: Dispatch<SetStateAction<string>>;
  setReplayError: Dispatch<SetStateAction<string | null>>;
  setShowReplayDialog: Dispatch<SetStateAction<boolean>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  setFormationLocked: Dispatch<SetStateAction<boolean>>;
  setLockedFormationKey: Dispatch<SetStateAction<string | null>>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  /** The ending the loaded board is in, under the mode's rules (App). */
  boardEnding: (nextState: BoardState, lastMoveWasRotation?: boolean) => Exclude<GameStatus, 'active'> | null;
  /** QA-01 — everything the previous game left behind (App). */
  resetGameEndState: () => void;
  /** Classifies the loaded moves in the background (useClassifier). */
  classifyImportedLog: ReturnType<typeof useClassifier>['classifyImportedLog'];
  /** QA-02 — an imported game is not ranked; and Memory's autosave markers. */
  importedLogIdRef: RefObject<string | null>;
  completedLogIdRef: RefObject<string | null>;
  savedForLogIdRef: RefObject<string | null>;
  liveSavedGameIdRef: RefObject<string>;
}

/**
 * Load replay: the pasted log is rebuilt with the rules of a live game
 * (replayFromNotation, QA-02), loaded into the session as the game on the
 * board, saved to Memory, and classified in the background; a log it
 * cannot rebuild says which move failed, in the dialog. A plain handler, no
 * React hooks inside: what it reads is passed in from App's render, so the
 * call's position changes no effect order.
 */
export function useReplayImport({
  gameMode,
  replayText,
  setReplayText,
  setReplayError,
  setShowReplayDialog,
  setSelected,
  setPreviewTopology,
  setFormationLocked,
  setLockedFormationKey,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  boardEnding,
  resetGameEndState,
  classifyImportedLog,
  importedLogIdRef,
  completedLogIdRef,
  savedForLogIdRef,
  liveSavedGameIdRef,
}: UseReplayImportArgs) {
  function importReplayFromNotation() {
    try {
      // QA-02 — strict: every entry has to be a move the live game would
      // have allowed at that point, or the whole log is refused with the
      // move it failed on. See replayFromNotation.
      const replay = replayFromNotation(replayText, { roulette: gameMode === 'roulette' });
      const { initial, final: current, log: replayLog } = replay;

      const id = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = buildSavedGameSnapshot(replayLog, id, true);
      if (localStorageAdapter.saveOrUpdateGame) {
        localStorageAdapter.saveOrUpdateGame(snapshot);
      } else {
        localStorageAdapter.saveGame(snapshot);
      }

      // Load into the board as an unfinished game so it can be continued.
      liveSavedGameIdRef.current = id;
      setFormationLocked(true);
      setLockedFormationKey(replay.config960);
      // A log that already ends the game loads as over (settle).
      session.dispatch({
        type: 'load',
        game: { initial, board: current, log: replayLog, lastMove: null },
        fresh: true,
        settle: { lastWasRotation: replay.lastWasRotation },
      });
      setSelected(null);
      setPreviewTopology(null);
      savedForLogIdRef.current = null;
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      resetGameEndState();
      // QA-02 — an imported game is never ranked, whatever the bot level.
      // The mark lives here and in the Memory entry (never in /games), so a
      // resume from Memory keeps it.
      importedLogIdRef.current = replayLog.id;
      // A log that already ends the game loads as over. That ending is not
      // one the player just reached, so it gets no summary and no save.
      if (boardEnding(current, replay.lastWasRotation)) completedLogIdRef.current = replayLog.id;
      classifyImportedLog(replayLog);

      setReplayError(null);
      setShowReplayDialog(false);
      setReplayText('');
    } catch (e) {
      if (e instanceof NotationParseError) {
        setReplayError(e.message);
      } else {
        setReplayError('Could not parse replay log.');
      }
    }
  }

  return { importReplayFromNotation };
}
