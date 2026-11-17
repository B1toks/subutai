import { Pencil, Upload } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { isValidChess960Key } from '../../engine';
import type { WatchingGame } from '../review/watching';
import type { BoardUi } from './useBoardUi';

interface PositionCodeRowProps {
  /** The board's own UI state (useBoardUi). */
  ui: BoardUi;
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  /** Asks before anything that replaces a game in progress (useNavigationGuards). */
  guardLeave: (what: string, destroys: boolean, run: () => void) => void;
  /** This game's Chess960 starting rank, e.g. RNBQKBNR (App). */
  positionLabel: string;
  /** Editing the code: what Enter, Escape and leaving the field do
   *  (useFormation); whether it is open, the field (App focuses it in an
   *  effect) and its text are in ui. */
  applyFormationCode: () => void;
  cancelFormationInput: () => void;
  commitFormationOnBlur: () => void;
}

/**
 * The row under the board's actions: Load replay, and the game's Chess960
 * code. V1 rev 3: the code IS the control: it sits quiet and flat until
 * touched, then turns into the field the new code is typed in. Online and
 * while watching it is a plain label and Load replay is gone (S2.1: both
 * would replace the board's game under the match or the watched replay).
 * The field's ref is passed in: App's effect focuses it after the commit
 * that attaches it, as before. Order does not matter.
 */
export function PositionCodeRow({
  ui,
  isMultiplayer,
  watchingGame,
  guardLeave,
  positionLabel,
  applyFormationCode,
  cancelFormationInput,
  commitFormationOnBlur,
}: PositionCodeRowProps) {
  const { setReplayError, setShowReplayDialog, formationInputMode, setFormationInputMode, formationInputRef, formationInputValue, setFormationInputValue } = ui;
  return (
    <div className="position-label-wrap">
      {/* S2.1 — Replay import and formation editing clobber local game
          state, which in MP would split-brain against the Firestore
          board, and while watching would corrupt the stop-restore
          backup. Both controls are live-local-game-only. */}
      {!isMultiplayer && !watchingGame && (
      <button
        type="button"
        className="position-replay-btn"
        onClick={() =>
          guardLeave('Load a replay', true, () => {
            setReplayError(null);
            setShowReplayDialog(true);
          })
        }
        title="Paste a move log to replay a game"
      >
        <Icon icon={Upload} size={12} aria-hidden /> Load replay
      </button>
      )}
      {/* V1 rev 3 — the code IS the control.
          It used to be a read-only label with a separate "Set position"
          button next to it, which put two objects on screen for one
          idea. The code now sits quiet and flat until you touch it;
          clicking it grows the chip and turns the code itself into the
          field you type in. Nothing else on the row changes size, so
          the growth is the whole affordance. */}
      {isMultiplayer || watchingGame ? (
        <span className="position-code is-static" title="This game's Chess960 starting rank">
          <span className="position-label-key">960</span>
          <span className="position-code-value">{positionLabel}</span>
        </span>
      ) : formationInputMode ? (
        <span className="position-code is-editing">
          <span className="position-label-key">960</span>
          <input
            ref={formationInputRef}
            type="text"
            className="position-input"
            value={formationInputValue}
            onChange={(e) => setFormationInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFormationCode();
              if (e.key === 'Escape') cancelFormationInput();
            }}
            onBlur={commitFormationOnBlur}
            placeholder="RQKRNBBN"
            maxLength={8}
            aria-label="Chess960 starting rank"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
          />
          {formationInputValue && !isValidChess960Key(formationInputValue.trim().toUpperCase()) && (
            <span className="position-input-error">Invalid 960 code</span>
          )}
        </span>
      ) : (
        <button
          type="button"
          className="position-code"
          onClick={() =>
            guardLeave('Set a new position', true, () => {
              setFormationInputValue(positionLabel);
              setFormationInputMode(true);
            })
          }
          title="Click to start from a specific Chess960 position"
        >
          <span className="position-label-key">960</span>
          <span className="position-code-value">{positionLabel}</span>
          <Icon icon={Pencil} size={11} className="position-code-pencil" aria-hidden />
        </button>
      )}
    </div>
  );
}
