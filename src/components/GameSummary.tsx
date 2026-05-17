import type { GameOutcome, GamePoints, MoveQualityCounts } from '../analysis/points';
import { FeedbackPrompt } from './FeedbackPrompt';

interface GameSummaryProps {
  points: GamePoints;
  outcome: GameOutcome;
  personalBest: number | null;
  isNewPersonalBest: boolean;
  currentRank: number | null;
  saving: boolean;
  saveError: string | null;
  chess960Id: string;
  gameId: string | null;
  /** uid + name come from useAuth; null when sign-in hasn't completed. */
  playerId: string | null;
  playerName: string | null;
  /** Stage P addendum 7: wall-clock duration of this run, in ms. */
  durationMs?: number;
  /** Stage R: drives roulette-specific row labels ("Speed bonus", "Win bonus"). */
  gameMode?: 'classic' | 'roulette';
  onClose: () => void;
  onPlayAgain: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min === 0 ? `${sec}s` : `${min}m ${sec}s`;
}

function headline(outcome: GameOutcome, moveCount: number): string {
  switch (outcome) {
    case 'human-win':
      return `You won in ${moveCount} moves`;
    case 'ai-win':
      return `You lost in ${moveCount} moves`;
    case 'draw':
      return `Draw after ${moveCount} moves`;
    case 'human-resign':
      return `You resigned after ${moveCount} moves`;
  }
}

export function GameSummary({
  points,
  outcome,
  personalBest,
  isNewPersonalBest,
  currentRank,
  saving,
  saveError,
  chess960Id,
  gameId,
  playerId,
  playerName,
  durationMs,
  gameMode = 'classic',
  onClose,
  onPlayAgain,
}: GameSummaryProps) {
  const counted = points.counted;
  const isRoulette = gameMode === 'roulette';
  const movePointsLabel = isRoulette ? 'Speed bonus' : 'Move points';
  const outcomeBonusLabel =
    isRoulette && outcome === 'human-win' ? 'Win bonus' : 'Outcome bonus';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog summary-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Game over</h2>
        <p className="modal-subtitle">{headline(outcome, points.moveCount)}</p>
        {typeof durationMs === 'number' && (
          <p className="modal-subtitle summary-duration">
            Game time: {formatDuration(durationMs)}
          </p>
        )}

        {counted ? (
          <>
            <div className="summary-table">
              <div className="summary-row">
                <span>{movePointsLabel}</span>
                <span className="summary-num">{points.movePoints}</span>
              </div>
              <div className="summary-row">
                <span>Capture points</span>
                <span className="summary-num">{points.capturePoints}</span>
              </div>
              {points.qualityPoints > 0 && (
                <div className="summary-row summary-row-quality">
                  <span>
                    Move quality
                    <QualityBreakdown counts={points.moveQualityCounts} />
                  </span>
                  <span className="summary-num">{points.qualityPoints}</span>
                </div>
              )}
              <div className="summary-row">
                <span>{outcomeBonusLabel}</span>
                <span className="summary-num">{points.outcomeBonus}</span>
              </div>
              <div className="summary-row summary-total">
                <span>This game</span>
                <span className="summary-num">{points.total}</span>
              </div>
            </div>

            <div className="summary-extras">
              <div className="summary-row">
                <span>Personal best</span>
                <span className="summary-num">
                  {isNewPersonalBest ? (
                    <>
                      {points.total} <span className="summary-badge">NEW BEST</span>
                    </>
                  ) : personalBest !== null ? (
                    personalBest
                  ) : saving ? (
                    '…'
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="summary-row">
                <span>Rank</span>
                <span className="summary-num">
                  {saving
                    ? '…'
                    : currentRank !== null
                      ? `#${currentRank}`
                      : '—'}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="summary-uncounted">
            <strong>This game wasn’t counted</strong>
            <p>Games under 10 moves don’t earn points.</p>
          </div>
        )}

        {saveError && <div className="modal-error">{saveError}</div>}

        {playerId && playerName && (
          <FeedbackPrompt
            playerId={playerId}
            playerName={playerName}
            gameId={gameId}
            gameContext={{
              outcome,
              moveCount: points.moveCount,
              points: points.total,
              chess960Id,
            }}
          />
        )}

        <div className="modal-actions summary-actions">
          <button
            type="button"
            className="modal-btn modal-btn-secondary summary-action-btn"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-primary summary-action-btn"
            onClick={onPlayAgain}
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}

function QualityBreakdown({ counts }: { counts: MoveQualityCounts }) {
  const parts: string[] = [];
  if (counts.brilliant > 0) parts.push(`${counts.brilliant} brilliant`);
  if (counts.best > 0) parts.push(`${counts.best} best`);
  if (counts.good > 0) parts.push(`${counts.good} good`);
  if (parts.length === 0) return null;
  return <span className="summary-quality-detail">{parts.join(' · ')}</span>;
}
