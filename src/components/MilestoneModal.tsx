interface MilestoneModalProps {
  fullMoves: number;
  currentScoreEstimate: number;
  onKeepPlaying: () => void;
  onResignNow: () => void;
}

export function MilestoneModal({
  fullMoves,
  currentScoreEstimate,
  onKeepPlaying,
  onResignNow,
}: MilestoneModalProps) {
  return (
    <div className="modal-backdrop" onClick={onKeepPlaying}>
      <div
        className="modal-dialog milestone-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="milestone-celebration" aria-hidden>
          {'\u{1F389}'}
        </div>
        <h2 className="modal-title milestone-title">{fullMoves} Moves!</h2>
        <p className="milestone-message">
          You’ve survived {fullMoves} moves against Subutai — that’s a real
          achievement.
        </p>
        <p className="milestone-message milestone-message-muted">
          Keep playing to push the record further, or resign now to lock in
          your score.
        </p>
        <div className="milestone-score">
          Current score estimate:{' '}
          <strong>{currentScoreEstimate}+ points</strong>
        </div>
        <div className="modal-actions summary-actions">
          <button
            type="button"
            className="modal-btn modal-btn-secondary summary-action-btn"
            onClick={onResignNow}
          >
            Resign now
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-primary summary-action-btn"
            onClick={onKeepPlaying}
          >
            Keep playing
          </button>
        </div>
      </div>
    </div>
  );
}
