import type { BoardUi } from '../features/game/useBoardUi';

interface ReplayDialogProps {
  /** The board's own UI state (useBoardUi). */
  ui: BoardUi;
  /** Loads the pasted log onto the board (App's importReplayFromNotation). */
  importReplayFromNotation: () => void;
}

/**
 * Load replay: a move log pasted in the "Copy to clipboard" format, loaded
 * onto the board as a game to continue. The rules check (replayImport.ts)
 * and what follows a load stay in App; this is the dialog. App renders it
 * while showReplayDialog is set. Order does not matter.
 */
export function ReplayDialog({
  ui,
  importReplayFromNotation,
}: ReplayDialogProps) {
  const { replayText, setReplayText, replayError, setShowReplayDialog } = ui;
  return (
    <div className="help-backdrop" onClick={() => setShowReplayDialog(false)}>
      <div className="help-dialog replay-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Replay from log</h2>
        <p>Paste a move log in the same format as “Copy to clipboard”.</p>
        <textarea
          className="replay-textarea"
          value={replayText}
          onChange={(e) => setReplayText(e.target.value)}
          placeholder='[Chess960 "RQKRNBBN"]\n[Seed "123"]\n\n1. e2→e4  e7→e5\n2. A→B  g8→f6\n…'
          rows={10}
          aria-label="Move log to replay"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
        {replayError && <div className="replay-error">{replayError}</div>}
        <div className="replay-actions">
          <button type="button" className="help-close-btn" onClick={importReplayFromNotation}>
            Load replay
          </button>
          <button
            type="button"
            className="help-close-btn"
            onClick={() => setShowReplayDialog(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
