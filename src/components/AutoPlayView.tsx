import type { ReactNode } from 'react';
import type { GameOutcome } from '../analysis/points';

interface AutoPlayViewProps {
  gamesCompleted: number;
  maxGames: number;
  currentGameFullMoves: number;
  lastOutcome: GameOutcome | null;
  avgGameMoves: number | null;
  stopped: boolean;
  stoppedReason: string | null;
  onStop: () => void;
  board: ReactNode;
}

function outcomeLabel(outcome: GameOutcome | null): string {
  if (!outcome) return '—';
  switch (outcome) {
    case 'human-win':
      return 'white wins';
    case 'ai-win':
      return 'black wins';
    case 'draw':
      return 'draw';
    case 'human-resign':
      return 'white resigned';
  }
}

export function AutoPlayView({
  gamesCompleted,
  maxGames,
  currentGameFullMoves,
  lastOutcome,
  avgGameMoves,
  stopped,
  stoppedReason,
  onStop,
  board,
}: AutoPlayViewProps) {
  return (
    <div className="auto-shell">
      <div className="auto-panel">
        <div className="auto-panel-header">
          <span className="auto-badge">{'\u{1F916}'} AUTO MODE</span>
          {!stopped && (
            <button type="button" className="auto-stop-btn" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
        <div className="auto-panel-stats">
          <div className="auto-stat">
            <span className="auto-stat-label">Games completed</span>
            <span className="auto-stat-value">
              {gamesCompleted}
              {maxGames > 0 && (
                <span className="auto-stat-cap"> / {maxGames}</span>
              )}
            </span>
          </div>
          <div className="auto-stat">
            <span className="auto-stat-label">Current game</span>
            <span className="auto-stat-value">
              {stopped ? '—' : `move ${currentGameFullMoves}`}
            </span>
          </div>
          <div className="auto-stat">
            <span className="auto-stat-label">Last outcome</span>
            <span className="auto-stat-value">{outcomeLabel(lastOutcome)}</span>
          </div>
          <div className="auto-stat">
            <span className="auto-stat-label">Avg game length</span>
            <span className="auto-stat-value">
              {avgGameMoves !== null ? `${avgGameMoves} moves` : '—'}
            </span>
          </div>
        </div>
        {stopped && (
          <div className="auto-stopped">
            {stoppedReason ?? 'Stopped.'}
          </div>
        )}
      </div>
      <div className="auto-board-wrap">{board}</div>
    </div>
  );
}
