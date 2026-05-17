import { useEffect, useState } from 'react';
import {
  fetchLeaderboardPage,
  type BoardType,
  type LeaderboardCursor,
  type LeaderboardEntry,
} from '../firebase/leaderboard';
import type { GameOutcome } from '../analysis/points';

interface LeaderboardProps {
  currentUid: string | null;
  onBack: () => void;
  onWatchGame: (gameId: string, playerName: string) => void;
}

function outcomeIcon(outcome: GameOutcome): { glyph: string; label: string; tone: string } {
  switch (outcome) {
    case 'human-win':
      return { glyph: '\u{1F3C6}', label: 'Won', tone: 'win' };
    case 'draw':
      return { glyph: '\u{1F91D}', label: 'Draw', tone: 'draw' };
    case 'ai-win':
      return { glyph: '❌', label: 'Lost', tone: 'loss' };
    case 'human-resign':
      return { glyph: '\u{1F3F3}', label: 'Resigned', tone: 'loss' };
  }
}

export function Leaderboard({ currentUid, onBack, onWatchGame }: LeaderboardProps) {
  const [boardType, setBoardType] = useState<BoardType>('classic');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [cursor, setCursor] = useState<LeaderboardCursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    setCursor(null);
    setHasMore(false);
    fetchLeaderboardPage(undefined, boardType)
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[Leaderboard] fetch failed', err);
        setError('Could not load leaderboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardType]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchLeaderboardPage(cursor, boardType);
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error('[Leaderboard] loadMore failed', err);
      setError('Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <button type="button" className="leaderboard-back" onClick={onBack}>
          {'←'} Back
        </button>
        <h2 className="leaderboard-title">
          {'\u{1F3C6}'} Leaderboard
        </h2>
        <span className="leaderboard-spacer" />
      </div>

      <div className="leaderboard-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={boardType === 'classic'}
          className={`leaderboard-tab${boardType === 'classic' ? ' is-active' : ''}`}
          onClick={() => setBoardType('classic')}
        >
          Classic
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={boardType === 'roulette'}
          className={`leaderboard-tab${boardType === 'roulette' ? ' is-active' : ''}`}
          onClick={() => setBoardType('roulette')}
        >
          {'\u{1F3B0}'} Roulette
        </button>
      </div>

      {loading ? (
        <div className="leaderboard-empty">Loading…</div>
      ) : error ? (
        <div className="leaderboard-empty leaderboard-error">{error}</div>
      ) : entries.length === 0 ? (
        <div className="leaderboard-empty">
          No entries yet. Be the first to play a counted game!
        </div>
      ) : (
        <>
          <div className="leaderboard-row leaderboard-row-head">
            <span className="lb-rank">#</span>
            <span className="lb-name">Player</span>
            <span className="lb-points">Best</span>
            <span className="lb-survived">Survived</span>
            <span className="lb-outcome">Outcome</span>
            <span className="lb-action" />
          </div>
          {entries.map((e, idx) => {
            const rank = idx + 1;
            const isMe = currentUid !== null && e.uid === currentUid;
            const snap = e.bestGameSnapshot;
            const outcome = snap ? outcomeIcon(snap.outcome) : null;
            const survived = snap?.moveCount ?? e.longestSurvivalMoves;
            return (
              <div
                key={e.uid}
                className={`leaderboard-row${isMe ? ' is-me' : ''}`}
              >
                <span className="lb-rank">#{rank}</span>
                <span className="lb-name">
                  {e.displayName}
                  {isMe && (
                    <span className="lb-me-badge" title="That’s you">
                      {' '}{'\u{1F451}'}
                    </span>
                  )}
                </span>
                <span className="lb-points">{e.bestGamePoints}</span>
                <span className="lb-survived">
                  {survived > 0 ? `${survived} mvs` : '—'}
                </span>
                <span className={`lb-outcome lb-outcome-${outcome?.tone ?? 'none'}`}>
                  {outcome ? (
                    <>
                      <span className="lb-outcome-glyph">{outcome.glyph}</span>{' '}
                      <span className="lb-outcome-label">{outcome.label}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="lb-action">
                  <button
                    type="button"
                    className="leaderboard-replay-btn"
                    disabled={!e.bestGameId}
                    title={e.bestGameId ? `Watch ${e.displayName}’s best game` : 'No replay available'}
                    onClick={() => {
                      if (e.bestGameId) onWatchGame(e.bestGameId, e.displayName);
                    }}
                  >
                    {'▶'}
                  </button>
                </span>
              </div>
            );
          })}

          {hasMore && (
            <div className="leaderboard-more">
              <button
                type="button"
                className="modal-btn modal-btn-secondary"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Show more (25)'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
