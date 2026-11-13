import type { Dispatch, RefObject, SetStateAction } from 'react';
import { createPositionFromBackRankKey, isValidChess960Key, type TopologyState } from '../../engine';
import { newLiveSnapshotId } from '../../memory/liveSnapshotId';
import { session } from '../../session/session';
import { nowMs } from '../../utils/nowMs';

interface UseFormationArgs {
  /** The chip's edit field: its text, and whether it is open (App state). */
  formationInputValue: string;
  setFormationInputMode: Dispatch<SetStateAction<boolean>>;
  setFormationInputValue: Dispatch<SetStateAction<string>>;
  /** A typed code locks the formation for the next games too (App state). */
  setFormationLocked: Dispatch<SetStateAction<boolean>>;
  setLockedFormationKey: Dispatch<SetStateAction<string | null>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setPreviewTopology: Dispatch<SetStateAction<TopologyState | null>>;
  setSearchEvalFromWhite: Dispatch<SetStateAction<number | null>>;
  setSearchMateInPlies: Dispatch<SetStateAction<number | null>>;
  /** QA-01 — everything the previous game left behind (App). */
  resetGameEndState: () => void;
  /** Memory's autosave: a new position is a new play session. */
  liveSavedGameIdRef: RefObject<string>;
}

/**
 * The 960 code chip's editor (PositionCodeRow): a valid code starts a new
 * game on that formation and locks it; Escape or an empty field cancels;
 * leaving the field applies a valid code and gives up on an invalid one.
 * Plain handlers, no React hooks inside: what they read is passed in from
 * App's render, so the call's position changes no effect order.
 */
export function useFormation({
  formationInputValue,
  setFormationInputMode,
  setFormationInputValue,
  setFormationLocked,
  setLockedFormationKey,
  setSelected,
  setPreviewTopology,
  setSearchEvalFromWhite,
  setSearchMateInPlies,
  resetGameEndState,
  liveSavedGameIdRef,
}: UseFormationArgs) {
  function applyFormationCode() {
    const raw = formationInputValue.trim().toUpperCase();
    if (!raw) {
      setFormationInputMode(false);
      setFormationInputValue('');
      return;
    }
    if (!isValidChess960Key(raw)) {
      setFormationInputValue(raw);
      return;
    }
    const initial = createPositionFromBackRankKey(raw);
    // A new log, named after now; the seed stays (the code names the board).
    session.dispatch({ type: 'newGame', initial, now: nowMs() });
    setSelected(null);
    setPreviewTopology(null);
    setFormationLocked(true);
    setLockedFormationKey(raw);
    setFormationInputMode(false);
    setFormationInputValue('');
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = newLiveSnapshotId();
  }

  function cancelFormationInput() {
    setFormationInputMode(false);
    setFormationInputValue('');
  }

  /**
   * V1 — blur means "I'm done", so it must always leave the editor.
   *
   * `applyFormationCode` returns early on an invalid code without
   * clearing the mode, which used to keep the field open forever. That
   * was survivable while a separate "Set position" button existed; now
   * that the code chip IS the control and the only place the starting
   * rank is shown, a stuck editor hides the position behind a half-typed
   * string. Clicking away on garbage just gives up, like Escape.
   */
  function commitFormationOnBlur() {
    const raw = formationInputValue.trim().toUpperCase();
    if (raw && !isValidChess960Key(raw)) {
      cancelFormationInput();
      return;
    }
    applyFormationCode();
  }

  return { applyFormationCode, cancelFormationInput, commitFormationOnBlur };
}
