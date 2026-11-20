import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { Cast, Disc3, HelpCircle, Menu, MessageSquare, SlidersHorizontal, Trophy } from 'lucide-react';
import { AudioToggle } from './AudioToggle';
import { Effects3DToggle } from '../components/Effects3DToggle';
import { Icon } from '../components/Icon';
import type { MultiplayerSyncHandle } from '../components/MultiplayerGameView';
import { MusicToggle } from '../components/MusicToggle';
import { NeonLogo } from '../components/NeonLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { Tooltip } from '../components/Tooltip';
import { UserMenu } from '../components/UserMenu';
import { STREAMING_UI } from '../featureFlags';
import { logOf, modeOf, gameStatusOf } from '../features/game/boardView';
import { useSession } from '../session/useSession';
import { busy } from '../ui/busy';

type MobilePanel = 'none' | 'menu' | 'setup';
type View = 'game' | 'review' | 'leaderboard' | 'friend-lobby';

interface AppHeaderProps {
  isMultiplayer: boolean;
  /** The live match (useOnlineMatch); null outside one. */
  mpSync: MultiplayerSyncHandle | null;
  opponentMode: 'ai' | 'friend' | 'local';
  /** The phone drawers (useMobileDrawers). */
  mobilePanel: MobilePanel;
  setMobilePanel: Dispatch<SetStateAction<MobilePanel>>;
  /** The streaming panels (useMusicState, useTwitchState), STREAMING_UI only. */
  showMusicDock: boolean;
  setShowMusicDock: Dispatch<SetStateAction<boolean>>;
  showTwitch: boolean;
  setShowTwitch: Dispatch<SetStateAction<boolean>>;
  /** Feedback needs a signed-in, named player (useAuth). */
  user: User | null;
  displayName: string | null;
  setShowFeedbackModal: (open: boolean) => void;
  setShowHelp: (open: boolean) => void;
  setShowNameModal: (open: boolean) => void;
  /** Asks before leaving a game in progress (useNavigationGuards). */
  guardLeave: (what: string, destroys: boolean, run: () => void) => void;
  setView: (view: View) => void;
}

/**
 * The top bar: the phone drawers' buttons, the brand with the LIVE / READY
 * / OVER pill and the game's line, the streaming buttons (STREAMING_UI),
 * feedback, rules, the sound / effects / theme toggles, the leaderboard
 * and the player's name. The game's state comes from the session (the
 * match's while one is played here); the dialogs and panels it opens are
 * App's. The data-tour targets (mobile-menu, mobile-setup, header, music,
 * twitch) are on the same elements as before. Order does not matter.
 */
export function AppHeader({
  isMultiplayer,
  mpSync,
  opponentMode,
  mobilePanel,
  setMobilePanel,
  showMusicDock,
  setShowMusicDock,
  showTwitch,
  setShowTwitch,
  user,
  displayName,
  setShowFeedbackModal,
  setShowHelp,
  setShowNameModal,
  guardLeave,
  setView,
}: AppHeaderProps) {
  const gameStatus = useSession(gameStatusOf);
  const log = useSession(logOf(isMultiplayer));
  const seed = useSession((s) => s.seed);
  const gameMode = useSession(modeOf(isMultiplayer));
  return (
    <header className="app-header">
      {/* V1 — the left drawer opens from the LEFT edge of the header, the
          right one from the right: each button sits on the side its
          panel comes in from. */}
      <button
        type="button"
        className="mobile-panel-btn mobile-panel-btn-menu"
        data-tour="mobile-menu"
        onClick={() => setMobilePanel((v) => (v === 'menu' ? 'none' : 'menu'))}
        aria-expanded={mobilePanel === 'menu'}
        aria-label="Tools and settings"
      >
        <Icon icon={Menu} size="md" aria-hidden />
      </button>
      <div className="app-brand">
        <NeonLogo />
        <h1>subutai</h1>
        {/* Stitch layout: the mock's LIVE strip replaces
            the plain tagline. Solo shows a short seed-derived game tag. */}
        <div className="live-strip">
          {/* V1 — the pill reports the real game state: LIVE while a
              game is running, READY before the first move, OVER after
              the result. */}
          {(() => {
            const mpLive = isMultiplayer && mpSync
              ? mpSync.matchState.status === 'active' && !mpSync.matchState.outcome
              : false;
            const phase: 'live' | 'ready' | 'over' = isMultiplayer
              ? (mpLive ? 'live' : 'over')
              : gameStatus !== 'active'
                ? 'over'
                : log.moves.length > 0
                  ? 'live'
                  : 'ready';
            return (
              <span className={`live-pill is-${phase}`}>
                <span className="live-dot" aria-hidden />
                {phase === 'live' ? 'LIVE' : phase === 'over' ? 'OVER' : 'READY'}
              </span>
            );
          })()}
          {(() => {
            // V1 — this line is the first thing to go when the header
            // runs out of room. It is context, not a control: which
            // opponent and which game id. Below 600px it moves into the
            // LIVE pill's own tooltip, where a hover or a long-press
            // still reaches it, and the header stops being three things
            // fighting over one row.
            // The seed-derived game tag means nothing to read, so it
            // lives in the tooltip only; Classic's goal there is the one
            // Help states (checkmate), not the 50-move survival milestone.
            const label =
              isMultiplayer && mpSync
                ? `vs ${mpSync.opponentDisplayName} · ${mpSync.matchState.code}`
                : 'vs AI';
            const gameTag = `Game #${Math.abs(seed).toString(36).toUpperCase().slice(-5) || '0'}`;
            const hint =
              !isMultiplayer && gameMode === 'classic' && opponentMode === 'ai'
                ? "Checkmate the AI's king to win"
                : undefined;
            const title = isMultiplayer && mpSync ? label : hint ? `${hint} · ${gameTag}` : gameTag;
            return (
              <span className="live-title" title={title} data-label={label}>
                {isMultiplayer && mpSync ? (
                  <>
                    vs <strong>{mpSync.opponentDisplayName}</strong> · {mpSync.matchState.code}
                  </>
                ) : (
                  label
                )}
              </span>
            );
          })()}
        </div>
      </div>
      <div className="mobile-panel-buttons">
        <button
          type="button"
          className="mobile-panel-btn"
          data-tour="mobile-setup"
          onClick={() => setMobilePanel((v) => (v === 'setup' ? 'none' : 'setup'))}
          aria-expanded={mobilePanel === 'setup'}
          aria-label="Game setup"
        >
          <Icon icon={SlidersHorizontal} size="md" aria-hidden />
        </button>
      </div>
      <div className="header-controls" data-tour="header">
        {STREAMING_UI && (
          <>
        <Tooltip text={showMusicDock ? 'Hide music dock' : 'Spotify + beat sync (beta)'} side="bottom">
          <button
            type="button"
            className={`header-action-btn${showMusicDock ? ' is-active' : ''}`}
            onClick={() => setShowMusicDock((v) => !v)}
            aria-label="Toggle music dock (beta)"
            aria-pressed={showMusicDock}
            data-tour="music"
          >
            <Icon icon={Disc3} size="md" aria-hidden />
            <span className="beta-corner" aria-hidden>β</span>
          </button>
        </Tooltip>
        <Tooltip text={showTwitch ? 'Hide Twitch chat' : 'Twitch chat + predictions (beta)'} side="bottom">
          <button
            type="button"
            className={`header-action-btn${showTwitch ? ' is-active' : ''}`}
            onClick={() => setShowTwitch((v) => !v)}
            aria-label="Toggle Twitch chat (beta)"
            aria-pressed={showTwitch}
            data-tour="twitch"
          >
            <Icon icon={Cast} size="md" aria-hidden />
            <span className="beta-corner" aria-hidden>β</span>
          </button>
        </Tooltip>
        <span className="rail-sep" aria-hidden />
          </>
        )}
        {/* fix/v1.1.4 — on a phone these two sit in the left drawer, and
            their dialogs render under it (and its scrim): close it first,
            as Change name does. */}
        <Tooltip
          text={user && displayName ? 'Send feedback' : 'Sign in to send feedback'}
          side="bottom"
          disabled={!user || !displayName}
        >
          <button
            type="button"
            className="header-action-btn"
            onClick={() => {
              setMobilePanel('none');
              setShowFeedbackModal(true);
            }}
            disabled={!user || !displayName}
            aria-label="Send feedback"
          >
            <Icon icon={MessageSquare} size="md" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip text="Rules & info" side="bottom">
          <button
            type="button"
            className="header-action-btn"
            onClick={() => {
              setMobilePanel('none');
              setShowHelp(true);
            }}
            aria-label="Rules & info"
          >
            <Icon icon={HelpCircle} size="md" aria-hidden />
          </button>
        </Tooltip>
        <span className="rail-sep rail-sep-tray" aria-hidden />
        <MusicToggle />
        <AudioToggle />
        <Effects3DToggle />
        <ThemeToggle />
      </div>
      {/* V1 — the two things a player reaches for most often stay in the
          top bar on every viewport: the leaderboard and their own name.
          Everything else lives in the left rail (desktop) / header row
          (mobile). */}
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-btn"
          onClick={() =>
            guardLeave('Open leaderboard', false, () =>
              busy.navigate('Opening leaderboard', () => setView('leaderboard')),
            )
          }
          aria-label="Leaderboard"
          title="Leaderboard"
        >
          <Icon icon={Trophy} size="md" aria-hidden />
          <span className="topbar-btn-label">Leaderboard</span>
        </button>
        {/* fix/v1.1.4 — the name is back here from 721px, where the
            header has room; CSS hides it on a phone, where PlayerRow
            in the setup drawer carries it. */}
        {displayName && (
          <UserMenu
            displayName={displayName}
            onChangeName={() => setShowNameModal(true)}
          />
        )}
      </div>
    </header>
  );
}
