import { memo, useEffect, useMemo, useState } from 'react';
import { Archive, Filter } from 'lucide-react';
import { localStorageAdapter } from './storage';
import { matches960Pattern } from './filter';
import { GameCard } from './GameCard';
import { EmptyState } from '../components/EmptyState';
import type { SavedGame } from './types';

type SortKey = 'date' | 'result' | 'config960' | 'moveCount';
type SortDir = 'asc' | 'desc';

function sortGames(games: SavedGame[], key: SortKey, dir: SortDir): SavedGame[] {
  const cmp =
    key === 'date'
      ? (a: SavedGame, b: SavedGame) =>
          a.createdAt.localeCompare(b.createdAt)
      : key === 'result'
        ? (a: SavedGame, b: SavedGame) => {
            const order: Record<string, number> = { win: 0, loss: 1, draw: 2 };
            const ar = a.result ?? 'draw';
            const br = b.result ?? 'draw';
            return order[ar] - order[br];
          }
        : key === 'config960'
          ? (a: SavedGame, b: SavedGame) =>
              a.config960.localeCompare(b.config960)
          : (a: SavedGame, b: SavedGame) => a.moveCount - b.moveCount;
  const sorted = [...games].sort(cmp);
  return dir === 'desc' ? sorted.reverse() : sorted;
}

function MemoryPanelImpl({
  onGameActivate,
}: {
  onGameActivate?: (game: SavedGame) => void;
}) {
  const [games, setGames] = useState<SavedGame[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterPattern, setFilterPattern] = useState('');

  function loadGames() {
    localStorageAdapter.loadGames().then(setGames);
  }

  useEffect(() => {
    loadGames();
  }, []);

  // useMemo so the children-list reference is stable across re-renders
  // triggered by unrelated state changes (the trimmed pattern and sort
  // key/dir change rarely).
  const sorted = useMemo(() => {
    const trimmed = filterPattern.trim();
    const filtered = trimmed
      ? games.filter((g) => matches960Pattern(g.config960, trimmed))
      : games;
    return sortGames(filtered, sortKey, sortDir);
  }, [games, filterPattern, sortKey, sortDir]);

  return (
    <details
      className="memory-details"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) loadGames();
      }}
    >
      <summary>Memory ({games.length})</summary>
      <div className="memory-content">
        <div className="memory-toolbar">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="memory-sort-select"
          >
            <option value="date">Date</option>
            <option value="result">Result</option>
            <option value="config960">960 config</option>
            <option value="moveCount">Moves</option>
          </select>
          <button
            type="button"
            className="memory-sort-dir"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? '\u2191' : '\u2193'}
          </button>
          <input
            type="text"
            className="memory-filter-input"
            placeholder="Filter: R****BBN"
            value={filterPattern}
            onChange={(e) => setFilterPattern(e.target.value)}
          />
          {filterPattern.trim() && (
            <button
              type="button"
              className="memory-filter-clear"
              onClick={() => setFilterPattern('')}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="memory-refresh-btn"
            onClick={loadGames}
            title="Refresh list"
          >
            Refresh
          </button>
        </div>
        <div className="memory-list">
          {sorted.length === 0 ? (
            games.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="No saved games"
                description="Completed games are saved locally and show up here."
              />
            ) : (
              <EmptyState
                icon={Filter}
                title="No matches"
                description="No games match the filter. Try a different pattern or clear it."
              />
            )
          ) : (
            sorted.map((game) => (
              <div
                key={game.id}
                className="memory-game-row"
                onDoubleClick={() => onGameActivate?.(game)}
              >
                <GameCard game={game} />
              </div>
            ))
          )}
        </div>
      </div>
    </details>
  );
}

/**
 * Memoized so App re-renders driven by chess state (every click) don't tear
 * through 300+ saved-game cards. The only prop is `onGameActivate`; App must
 * pass a stable callback (via useCallback / ref pattern) for this to work.
 */
export const MemoryPanel = memo(MemoryPanelImpl);
