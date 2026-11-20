import { AlarmClock } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { MultiplayerSyncHandle } from './useMultiplayerSync';

interface MatchBannersProps {
  /** A shared game (?game=<id>) or a watched one that could not be shown. */
  sharedGameError: string | null;
  onDismissSharedError: () => void;
  isMultiplayer: boolean;
  /** The live match (useOnlineMatch); null outside one. */
  mpSync: MultiplayerSyncHandle | null;
}

/**
 * The banners above the board: a game that could not be loaded, and in an
 * online match the opponent's turn, the AFK warning and the match's error.
 * Each keeps its own condition, as in App before; the component holds no
 * state, so it renders the same as the blocks it replaces. Order does not
 * matter.
 */
export function MatchBanners({ sharedGameError, onDismissSharedError, isMultiplayer, mpSync }: MatchBannersProps) {
  return (
    <>
      {sharedGameError && (
        <div className="mp-banner mp-banner-error" role="status">
          {sharedGameError}{' '}
          <button
            type="button"
            className="mp-back-btn"
            style={{ marginLeft: 8 }}
            onClick={onDismissSharedError}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sprint 4.0 — persistent "Your turn / Waiting" MP banner removed
          again (re-grew during the post-3.0 rewrites). Whose turn it is
          reads from the board + opponent panel; the local AFK alert
          covers the attention case. The waiting-for-opponent spinner
          is kept as a slim, non-text indicator so users still know the
          other side is acting — without the heavy banner. */}
      {isMultiplayer
        && mpSync
        && mpSync.matchState.status === 'active'
        && !mpSync.isMyTurn && (
        <div className="mp-banner mp-banner-wait">
          <span className="mp-spinner" aria-hidden />
          {mpSync.isRouletteMode && mpSync.rouletteSlots
            ? `${mpSync.opponentDisplayName} is acting…`
            : `Waiting for ${mpSync.opponentDisplayName}…`}
        </div>
      )}

      {isMultiplayer &&
        mpSync &&
        mpSync.selfAfkWarning &&
        mpSync.matchState.status === 'active' && (
          <div className="mp-banner mp-banner-warn">
            <Icon icon={AlarmClock} size="sm" aria-hidden /> Make a move soon — auto-forfeit in ~30s.
          </div>
        )}

      {isMultiplayer && mpSync && mpSync.error && (
        <div className="mp-banner mp-banner-error">{mpSync.error}</div>
      )}
    </>
  );
}
