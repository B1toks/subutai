import { Eye } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { WatchingGame } from './watching';

interface WatchBannerProps {
  /** The leaderboard game being watched (App's watchingGame). */
  watchingGame: WatchingGame;
  /** Shows the position after this many moves (App's seekWatchTo). */
  onSeek: (moveIdx: number) => void;
  onToggleAutoplay: () => void;
  /** Stops watching and puts the player's own game back. */
  onStop: () => void;
}

/**
 * The bar above the board while a leaderboard game is watched: whose game
 * and which move, and the transport (previous, next, auto play, stop).
 * App renders it only while watching; the replay itself (the board, the
 * autoplay timer) stays in App. Order does not matter.
 */
export function WatchBanner({ watchingGame, onSeek, onToggleAutoplay, onStop }: WatchBannerProps) {
  return (
    <div className="watch-banner">
      <span className="watch-banner-label">
        <Icon icon={Eye} size="sm" aria-hidden /> Watching <strong>{watchingGame.playerName}</strong>’s game ·
        move {Math.floor((watchingGame.currentMoveIdx + 1) / 2)}/
        {Math.floor(watchingGame.log.moves.length / 2)}
      </span>
      <div className="watch-banner-controls">
        <button
          type="button"
          className="watch-btn"
          onClick={() => onSeek(watchingGame.currentMoveIdx - 1)}
          disabled={watchingGame.currentMoveIdx === 0}
          title="Previous move"
        >
          ← Prev
        </button>
        <button
          type="button"
          className="watch-btn"
          onClick={() => onSeek(watchingGame.currentMoveIdx + 1)}
          disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
          title="Next move"
        >
          Next →
        </button>
        <button
          type="button"
          className={`watch-btn${watchingGame.autoplay ? ' watch-btn-active' : ''}`}
          onClick={onToggleAutoplay}
          disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
          title="Auto play"
        >
          {watchingGame.autoplay ? '⏸ Pause' : '▶ Auto'}
        </button>
        <button
          type="button"
          className="watch-btn watch-btn-stop"
          onClick={onStop}
          title="Stop and return to your game"
        >
          ✕ Stop
        </button>
      </div>
    </div>
  );
}
