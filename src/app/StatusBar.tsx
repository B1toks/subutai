import type { MultiplayerSyncHandle } from '../components/MultiplayerGameView';
import { boardOf, logOf, gameStatusOf } from '../features/game/boardView';
import type { WatchingGame } from '../features/review/watching';
import { useSession } from '../session/useSession';

interface StatusBarProps {
  isMultiplayer: boolean;
  /** The live match (useOnlineMatch); null outside one. */
  mpSync: MultiplayerSyncHandle | null;
  watchingGame: WatchingGame | null;
  /** Hot-seat: both sides play on this device. */
  isLocalMode: boolean;
  /** Whose turn it is from this seat (App's currentPlayer). */
  currentPlayer: 'human' | 'ai';
  /** How the game ended, in words (useNotation); null while it runs. */
  gameOverMessage: string | null;
}

/**
 * V1 — the status bar at the foot of the page. It used to say "Ready" /
 * "In play" and a raw move, which told the player nothing they could act
 * on. It now answers the one question a status bar should: whose move is
 * it, and how far along are we. The game comes from the session (the
 * match's while one is played here, boardView.ts); who is to act, from App.
 * Order does not matter.
 */
export function StatusBar({
  isMultiplayer,
  mpSync,
  watchingGame,
  isLocalMode,
  currentPlayer,
  gameOverMessage,
}: StatusBarProps) {
  const log = useSession(logOf(isMultiplayer));
  const state = useSession(boardOf(isMultiplayer));
  const gameStatus = useSession(gameStatusOf);
  return (
    <footer className="app-status-bar">
      {(() => {
        const lastEntry = log.moves[log.moves.length - 1];
        const lastText = lastEntry
          ? lastEntry.san ?? `${lastEntry.move.from ?? ''}→${lastEntry.move.to ?? ''}`
          : null;
        const fullMoves = Math.ceil(log.moves.length / 2);
        let tone: 'over' | 'mine' | 'theirs' | 'idle' = 'idle';
        let text: string;
        if (gameStatus !== 'active') {
          tone = 'over';
          text = gameOverMessage ?? 'Game over';
        } else if (watchingGame) {
          text = `Watching ${watchingGame.playerName}'s game`;
        } else if (isMultiplayer && mpSync) {
          tone = mpSync.isMyTurn ? 'mine' : 'theirs';
          text = mpSync.isMyTurn
            ? 'Your move'
            : `${mpSync.opponentDisplayName} is thinking`;
        } else if (isLocalMode) {
          tone = 'mine';
          text = `${state.sideToMove === 'white' ? 'White' : 'Black'} to move`;
        } else if (currentPlayer === 'human') {
          tone = 'mine';
          text = log.moves.length === 0 ? 'Your move: make the first one' : 'Your move';
        } else {
          tone = 'theirs';
          text = 'Bot is thinking';
        }
        return (
          <>
            <span className={`status-chip status-chip-${tone}`}>
              <span className="status-dot" aria-hidden />
              {text}
            </span>
            <span className="status-meta">
              <span className="status-meta-item">
                Move <strong>{fullMoves}</strong>
              </span>
              {lastText && (
                <span className="status-meta-item">
                  Last <strong className="status-mono">{lastText}</strong>
                </span>
              )}
            </span>
          </>
        );
      })()}
    </footer>
  );
}
