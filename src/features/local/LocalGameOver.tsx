interface LocalGameOverProps {
  /** How the game ended, in words (useNotation). */
  gameOverMessage: string | null;
  setLocalGameOverDismissed: (dismissed: boolean) => void;
  startNewGame: () => void;
}

/**
 * The end of a hot-seat game. R13/BUG-5 kept local hot-seat OUT of
 * finishGame/GameSummary on purpose (a 2-humans-one-device game has no
 * "human" to attribute a personal-best/leaderboard entry to), but that
 * meant its ending was just a text banner with no modal and no explicit
 * "new game" prompt, unlike every other mode. This reuses the MP
 * completion dialog's styling (mp-completion-*): same shape, no scoring,
 * just the outcome and a clear way to start again. App renders it once a
 * hot-seat game with moves has ended, until dismissed, and not over the
 * endgame scene. Order does not matter.
 */
export function LocalGameOver({ gameOverMessage, setLocalGameOverDismissed, startNewGame }: LocalGameOverProps) {
  return (
    <div
      className="mp-completion-backdrop"
      onClick={() => setLocalGameOverDismissed(true)}
    >
      <div className="mp-completion-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="mp-completion-title">Game over</h2>
        <p className="mp-completion-headline">{gameOverMessage}</p>
        <div className="mp-completion-actions">
          <button
            type="button"
            className="mp-btn mp-btn-primary"
            onClick={() => {
              setLocalGameOverDismissed(true);
              startNewGame();
            }}
          >
            Start new game
          </button>
          <button
            type="button"
            className="mp-btn mp-btn-secondary"
            onClick={() => setLocalGameOverDismissed(true)}
          >
            Keep viewing board
          </button>
        </div>
      </div>
    </div>
  );
}
