import { useState } from 'react';
import { applyRotationMove, getSquarePosition } from '../engine/auxetic';
import { applyMove } from '../engine/moves';
import { createPositionFromBackRankKey } from '../engine';
import type { SquareId } from '../engine';
import type { PieceType } from '../engine';
import type { SavedGame } from './types';

const PIECE_LABELS: Record<PieceType, string> = {
  pawn: 'P',
  knight: 'N',
  bishop: 'B',
  rook: 'R',
  queen: 'Q',
  king: 'K',
};

function heatmapFromMoves(moves: SavedGame['moves']): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { move } of moves) {
    if (move.from) {
      counts.set(move.from, (counts.get(move.from) ?? 0) + 1);
    }
    if (move.to) {
      counts.set(move.to, (counts.get(move.to) ?? 0) + 1);
    }
  }
  return counts;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function pieceHistogramFromMoves(
  config960: string,
  moves: SavedGame['moves'],
): { white: Record<PieceType, number>; black: Record<PieceType, number> } | null {
  const empty: Record<PieceType, number> = {
    pawn: 0,
    knight: 0,
    bishop: 0,
    rook: 0,
    queen: 0,
    king: 0,
  };
  const white = { ...empty };
  const black = { ...empty };
  try {
    let state = createPositionFromBackRankKey(config960);
    for (const { move } of moves) {
      if (move.kind === 'topologyToggle') {
        state = applyRotationMove(state);
        continue;
      }
      if (!move.from || !move.to) continue;
      const piece = state.pieces[move.from];
      if (!piece) continue;
      const counts = piece.color === 'white' ? white : black;
      counts[piece.type]++;
      state = applyMove(state, move);
    }
    return { white, black };
  } catch {
    return null;
  }
}

function formatPieceHist(counts: Record<PieceType, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return '—';
  return (['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const)
    .filter((t) => counts[t] > 0)
    .map((t) => `${PIECE_LABELS[t]} ${Math.round((counts[t] / total) * 100)}%`)
    .join(', ');
}

function pieceLetterAt(sq: string, config960: string): string {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10);
  if (rank === 1) return config960[file] ?? '';
  if (rank === 2) return 'P';
  if (rank === 8) return config960[file] ?? '';
  if (rank === 7) return 'p';
  return '';
}

function buildBGrid(): string[][] {
  const grid: string[][] = [];
  const map = new Map<string, string>();
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  for (const f of files) {
    for (const r of ranks) {
      const sq = `${f}${r}` as SquareId;
      const pos = getSquarePosition(sq, 'B');
      const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      map.set(key, sq);
    }
  }
  for (let row = 0; row < 8; row++) {
    const rowSqs: string[] = [];
    for (let col = 0; col < 8; col++) {
      rowSqs.push(map.get(`${col},${row}`) ?? '');
    }
    grid.push(rowSqs);
  }
  return grid;
}

const B_GRID = buildBGrid();

interface GameCardProps {
  game: SavedGame;
}

export function GameCard({ game }: GameCardProps) {
  const [copied, setCopied] = useState(false);
  const heatmap = heatmapFromMoves(game.moves);
  const maxHeat = Math.max(1, ...heatmap.values());
  const pieceHist = pieceHistogramFromMoves(game.config960, game.moves);

  function copyNotation() {
    navigator.clipboard.writeText(game.notation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const resultLabel =
    game.status === 'incomplete'
      ? 'Incomplete'
      : game.result === 'win'
        ? 'Win'
        : game.result === 'loss'
          ? 'Loss'
          : 'Draw';
  const resultClass =
    game.status === 'incomplete' ? 'incomplete' : (game.result ?? 'draw');

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

  function renderSparkline(height: number, width: number) {
    if (game.scoreHistory.length < 2) return null;
    const min = Math.min(...game.scoreHistory);
    const max = Math.max(...game.scoreHistory);
    const range = max - min || 1;
    const pad = range * 0.1;
    const scale = (v: number) =>
      ((v - min + pad) / (range + 2 * pad)) * height;
    const pts = game.scoreHistory
      .map((v, i) => {
        const x = (i / (game.scoreHistory.length - 1)) * width;
        const y = height - scale(v);
        return `${x},${y}`;
      })
      .join(' ');
    return (
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent-teal, #0d9488)"
        strokeWidth="1.5"
      />
    );
  }

  return (
    <details className="memory-game-card">
      <summary>
        <span className="memory-game-summary-left">
          <span className="memory-game-date">{formatDate(game.createdAt)}</span>
          <span className={`memory-game-result memory-game-result-${resultClass}`}>
            {resultLabel}
          </span>
          <span className="memory-game-config">{game.config960}</span>
          <span className="memory-game-moves">{game.moveCount} moves</span>
        </span>
        <span className="memory-game-sparkline-inline">
          <svg viewBox="0 0 120 20" preserveAspectRatio="none">
            {renderSparkline(20, 120)}
          </svg>
        </span>
      </summary>
      <div className="memory-game-content">
        <div className="memory-game-expanded-grid">
          <div className="memory-heatmap-wrap">
            <div className="memory-heatmap-label">Square activity</div>
            <div className="memory-heatmaps-row">
              <div className="memory-heatmap-block">
                <div className="memory-heatmap-sublabel">A</div>
                <div className="memory-heatmap memory-heatmap-a">
                {ranks.map((r) =>
                  files.map((f) => {
                    const sq = `${f}${r}`;
                    const n = heatmap.get(sq) ?? 0;
                    const intensity = maxHeat > 0 ? n / maxHeat : 0;
                    const isDark =
                      ((f.charCodeAt(0) - 97) + (parseInt(r, 10) - 1)) % 2 === 1;
                    const letter = pieceLetterAt(sq, game.config960);
                    return (
                      <div
                        key={sq}
                        className={`memory-heatmap-cell ${isDark ? 'dark' : 'light'}`}
                        style={
                          {
                            '--heat': intensity,
                          } as React.CSSProperties
                        }
                        title={`${sq}: ${n}`}
                      >
                        {letter && <span className="memory-heatmap-letter">{letter}</span>}
                      </div>
                    );
                  }),
                )}
                </div>
              </div>
              <div className="memory-heatmap-block">
                <div className="memory-heatmap-sublabel">B</div>
                <div className="memory-heatmap memory-heatmap-b">
                {B_GRID.map((rowSqs, rowIndex) =>
                  rowSqs.map((sq, colIndex) => {
                    const n = sq ? heatmap.get(sq) ?? 0 : 0;
                    const intensity = maxHeat > 0 ? n / maxHeat : 0;
                    const isDark = (colIndex + rowIndex) % 2 === 1;
                    const letter = sq ? pieceLetterAt(sq, game.config960) : '';
                    return (
                      <div
                        key={`b-${rowIndex}-${colIndex}`}
                        className={`memory-heatmap-cell memory-heatmap-cell-b ${isDark ? 'dark' : 'light'}`}
                        style={
                          {
                            '--heat': intensity,
                          } as React.CSSProperties
                        }
                        title={sq ? `${sq}: ${n}` : ''}
                      >
                        {letter && <span className="memory-heatmap-letter">{letter}</span>}
                      </div>
                    );
                  }),
                )}
                </div>
              </div>
            </div>
          </div>
          <div className="memory-game-stats-column">
            <div className="memory-game-summary">
              <div>
                <strong>{game.config960}</strong> · {resultLabel}
                {game.status === 'complete' && game.termination ? ` (${game.termination})` : ''}
                · {game.moveCount} moves
              </div>
              <div className="memory-game-moves-ab">
                A: {game.movesInA} moves · B: {game.movesInB} moves
              </div>
              {pieceHist && (
                <div className="memory-game-piece-histogram">
                  <div className="memory-piece-hist-row">
                    <span className="memory-piece-hist-label">White:</span>
                    <span className="memory-piece-hist-bars">
                      {formatPieceHist(pieceHist.white)}
                    </span>
                  </div>
                  <div className="memory-piece-hist-row">
                    <span className="memory-piece-hist-label">Black:</span>
                    <span className="memory-piece-hist-bars">
                      {formatPieceHist(pieceHist.black)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="memory-sparkline-wrap">
              <div className="memory-sparkline-label">Score (White − Black)</div>
              <svg className="memory-sparkline" viewBox="0 0 120 40" preserveAspectRatio="none">
                {renderSparkline(40, 120)}
              </svg>
            </div>
          </div>
        </div>

        <details className="memory-moves-details">
          <summary>Moves</summary>
          <div className="memory-moves-content">
            <pre className="memory-moves-text">{game.notation}</pre>
            <button
              type="button"
              className="copy-btn"
              onClick={copyNotation}
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          </div>
        </details>
      </div>
    </details>
  );
}
