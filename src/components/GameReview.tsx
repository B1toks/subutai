import { useEffect, useState } from 'react';
import type { GameLog } from '../recording/log';
import { analyzeGame, type GameReviewResult } from '../analysis/analyzeGame';
import type { MoveClass } from '../analysis/classify';

interface Props {
  readonly log: GameLog;
  readonly onBack: () => void;
}

const CLASS_MARKER: Record<MoveClass, string> = {
  best: '⭐',
  good: '',
  mistake: '?',
  blunder: '??',
  brilliant: '!!',
  checkmate: '#',
};

const CLASS_LABEL: Record<MoveClass, string> = {
  best: 'best',
  good: 'good',
  mistake: 'mistake',
  blunder: 'blunder',
  brilliant: 'brilliant',
  checkmate: 'checkmate',
};

function shortMoveText(entry: GameLog['moves'][number]): string {
  const move = entry.move;
  if (move.kind === 'topologyToggle') {
    const from = entry.topology ?? 'A';
    return `${from}→${from === 'A' ? 'B' : 'A'}`;
  }
  if (move.kind === 'castle') {
    return move.to && move.to[0] === 'c' ? 'O-O-O' : 'O-O';
  }
  if (move.from && move.to) {
    let san = `${move.from}→${move.to}`;
    if (move.kind === 'promotion' && move.promotion) {
      san += `=${move.promotion[0].toUpperCase()}`;
    }
    return san;
  }
  return entry.san ?? '?';
}

export function GameReview({ log, onBack }: Props) {
  const [result, setResult] = useState<GameReviewResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: log.moves.length,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setProgress({ done: 0, total: log.moves.length });
    analyzeGame(log, {
      onProgress: (done, total) => {
        if (!cancelled) setProgress({ done, total });
      },
    }).then((out) => {
      if (cancelled) return;
      setResult(out);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [log]);

  return (
    <div className="game-review">
      <header className="game-review-header">
        <button type="button" className="game-review-back" onClick={onBack}>
          ← Back
        </button>
        <h2>Game Review</h2>
      </header>

      {loading && (
        <div className="game-review-loading">
          <div className="spinner" />
          <span>
            Analyzing {progress.done}/{progress.total} moves…
          </span>
        </div>
      )}

      {result && (
        <>
          <div className="game-review-stats">
            <Stat label="Brilliants" value={result.stats.brilliants} tone="brilliant" />
            <Stat label="Best" value={result.stats.bestCount} tone="best" />
            <Stat label="Mistakes" value={result.stats.mistakes} tone="mistake" />
            <Stat label="Blunders" value={result.stats.blunders} tone="blunder" />
            <Stat label="Avg. CPL" value={result.stats.averageCpl} tone="neutral" />
          </div>

          <ol className="game-review-list">
            {log.moves.map((entry, idx) => {
              const a = result.moves[idx];
              const cls = a.classification;
              const moveNum = Math.floor(idx / 2) + 1;
              const side = idx % 2 === 0 ? 'White' : 'Black';
              const showCpl = cls === 'blunder' || cls === 'mistake';
              const showBetter = cls === 'blunder' && (a.bestPvSan || a.bestMoveSan);
              const betterText = (() => {
                if (!showBetter) return null;
                if (a.bestPvSan && a.bestPvSan.length > 0) {
                  const head = a.bestPvSan.slice(0, 4).join(' ');
                  return a.bestPvSan.length > 4 ? `${head} …` : head;
                }
                return a.bestMoveSan ?? null;
              })();
              return (
                <li key={idx} className={`review-row review-row-${cls}`}>
                  <span className="review-num">
                    {moveNum}.{side === 'Black' && '..'}
                  </span>
                  <span className="review-san">{shortMoveText(entry)}</span>
                  <span className="review-marker">{CLASS_MARKER[cls]}</span>
                  <span className="review-label">{CLASS_LABEL[cls]}</span>
                  {showCpl && <span className="review-cpl">(−{a.cpl} cp)</span>}
                  {betterText && (
                    <span className="review-better">← краще: {betterText}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'brilliant' | 'best' | 'mistake' | 'blunder' | 'neutral';
}) {
  return (
    <div className={`review-stat review-stat-${tone}`}>
      <div className="review-stat-value">{value}</div>
      <div className="review-stat-label">{label}</div>
    </div>
  );
}
