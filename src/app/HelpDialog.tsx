interface HelpDialogProps {
  /** R14 — the display scale (CSS zoom on <body>) and its setter (useBoardSize). */
  uiScale: number;
  pickUiScale: (scale: number) => void;
  onClose: () => void;
  /** Closes the dialog and starts the tutorial again. */
  onReplayTutorial: () => void;
}

/**
 * The Help dialog: the rules in short, the display scale, a way back into
 * the tutorial, and the build's version. App renders it while showHelp is
 * set; it reads nothing of the game. Order does not matter.
 */
export function HelpDialog({ uiScale, pickUiScale, onClose, onReplayTutorial }: HelpDialogProps) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Subutai &mdash; Auxetic Chess960</h2>
        <p>
          Subutai combines <strong>Chess960</strong> (Fischer random chess) with an
          <strong> <a href="https://www.youtube.com/shorts/RLO48ETn6LE" target="_blank" rel="noopener noreferrer"> auxetic board</a></strong> that can rotate between two stable states.
        </p>
        <p><strong>How it works:</strong></p>
        <ul>
          <li>The board is divided into 4&times;4 blocks of 2&times;2 squares.</li>
          <li>Pressing <em>Rotate</em> flips all blocks &plusmn;90&deg;, reshuffling
            which squares are adjacent. This <strong>costs your turn</strong> but
            earns a <strong>+15 point bonus</strong> (up to 4 per game), and
            <strong> +25 more</strong> if you capture within your next two moves.</li>
          <li>Hover the eye button to preview the rotation; <strong>click</strong> the eye to
            temporarily lock the rotated view for inspection (click again to unlock). This is not the move.</li>
          <li><em>Support map</em> (arrow button): shows which of your pieces are backed up by others (arrows from supporter to supported).</li>
          <li><em>Threat map</em> (warning button): tints squares the opponent attacks. Hover a threatened square to highlight the threatening pieces.</li>
          <li>The starting position is a random Chess960 arrangement.</li>
          <li><strong>Classic mode:</strong> standard chess rules — you cannot move into check, checkmate ends the game.</li>
          <li><strong>Roulette mode:</strong> capture-the-king variant. Each turn you spin a 4-slot bag of random
            piece types and get <strong>2 actions</strong>. Each action is either a move (using one of the slot's
            piece types) or a Rotate. There's no check rule — leaving your king attacked is legal, but the
            opponent can capture it on their next move to win.</li>
        </ul>
        <p>
          <a href="https://en.wikipedia.org/wiki/Fischer_random_chess" target="_blank" rel="noopener noreferrer">
            Chess960 on Wikipedia
          </a>
        </p>
        {/* R14 — display scale: CSS zoom on <body>, persisted. The fix
            for "everything is tiny on a big monitor". */}
        <div className="help-scale-row">
          <label htmlFor="ui-scale">
            Display scale
            <span className="help-scale-val">{Math.round(uiScale * 100)}%</span>
          </label>
          <input
            id="ui-scale"
            type="range"
            min={0.8}
            max={1.5}
            step={0.05}
            value={uiScale}
            onChange={(e) => pickUiScale(Number.parseFloat(e.target.value))}
            aria-label="Interface scale"
          />
          {uiScale !== 1 && (
            <button
              type="button"
              className="help-scale-reset"
              onClick={() => pickUiScale(1)}
              aria-label="Reset interface scale to 100%"
            >
              100%
            </button>
          )}
        </div>
        <div className="help-dialog-actions">
          <button
            type="button"
            className="help-tour-btn"
            onClick={onReplayTutorial}
          >
            Replay tutorial
          </button>
          <button type="button" className="help-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {/* fix/v1.1.4 — which build this is, for bug reports. */}
        <p className="help-version">Subutai v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
