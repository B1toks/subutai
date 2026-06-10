import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Crown,
  Dices,
  Flag,
  Handshake,
  Trophy,
  XCircle,
} from 'lucide-react';
import {
  fetchLeaderboardPage,
  type BoardType,
  type LeaderboardCursor,
  type LeaderboardEntry,
} from '../firebase/leaderboard';
import type { GameOutcome } from '../analysis/points';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

interface LeaderboardProps {
  currentUid: string | null;
  onBack: () => void;
  onWatchGame: (gameId: string, playerName: string) => void;
  /** S2.1 — true while a multiplayer match is live; Watch would
   *  split-brain the board against the Firestore game, so it's locked. */
  watchDisabled?: boolean;
}

function outcomeIcon(outcome: GameOutcome): { icon: LucideIcon; label: string; tone: string } {
  switch (outcome) {
    case 'human-win':
      return { icon: Trophy, label: 'Won', tone: 'win' };
    case 'draw':
      return { icon: Handshake, label: 'Draw', tone: 'draw' };
    case 'ai-win':
      return { icon: XCircle, label: 'Lost', tone: 'loss' };
    case 'human-resign':
      return { icon: Flag, label: 'Resigned', tone: 'loss' };
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min === 0 ? `${sec}s` : `${min}m ${sec}s`;
}

export function Leaderboard({ currentUid, onBack, onWatchGame, watchDisabled }: LeaderboardProps) {
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
          <Icon icon={ArrowLeft} size="sm" aria-hidden /> Back
        </button>
        <h2 className="leaderboard-title">
          <Icon icon={Trophy} size="lg" aria-hidden /> Leaderboard
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
          <Icon icon={Dices} size="sm" aria-hidden /> Roulette
        </button>
      </div>

      {loading ? (
        <div className="leaderboard-loading">
          <div className="leaderboard-row leaderboard-row-head">
            <span className="lb-rank">#</span>
            <span className="lb-name">Player</span>
            <span className="lb-points">Best</span>
            <span className="lb-survived">Survived</span>
            <span className="lb-outcome">Outcome</span>
            <span className="lb-action" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="leaderboard-row">
              <Skeleton width={26} height={14} />
              <Skeleton width="60%" height={14} />
              <Skeleton width={36} height={14} />
              <Skeleton width={56} height={14} />
              <Skeleton width={72} height={14} />
              <span className="lb-action" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="leaderboard-empty leaderboard-error">{error}</div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No champions yet"
          description="Be the first to survive 50 moves against the AI."
        />
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
            // Stage P addendum 8: glowing golden badge for players whose best
            // game ended in a human-win. Stays gated on the snapshot so old
            // entries (no outcome stored) get nothing.
            const isVictor = snap?.outcome === 'human-win';
            // Stage P addendum 7: tooltip with best-game time when available.
            const rowTitle =
              typeof snap?.durationMs === 'number'
                ? `Best game time: ${formatDuration(snap.durationMs)}`
                : undefined;
            return (
              <div
                key={e.uid}
                className={`leaderboard-row${isMe ? ' is-me' : ''}`}
                title={rowTitle}
              >
                <span className="lb-rank">#{rank}</span>
                <span className="lb-name">
                  {e.displayName}
                  {isMe && !isVictor && (
                    <span className="lb-me-badge" title="That’s you">
                      <Icon icon={Crown} size="sm" aria-hidden />
                    </span>
                  )}
                  {isVictor && (
                    <span
                      className={`victor-badge${isMe ? ' my-victor' : ''}`}
                      title="Defeated the AI!"
                    >
                      <Icon icon={Crown} size={13} strokeWidth={2.4} aria-hidden />
                      <span>Bot Slayer</span>
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
                      <span className="lb-outcome-glyph">
                        <Icon icon={outcome.icon} size="sm" aria-hidden />
                      </span>{' '}
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
                    disabled={!e.bestGameId || watchDisabled}
                    title={
                      watchDisabled
                        ? 'Finish your match first'
                        : e.bestGameId
                          ? `Watch ${e.displayName}’s best game`
                          : 'No replay available'
                    }
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
