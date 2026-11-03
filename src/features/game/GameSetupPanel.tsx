import type { User } from 'firebase/auth';
import { Bot, Crosshair, Dices, Users, UsersRound } from 'lucide-react';
import { BOT_STRENGTHS, BOT_STRENGTH_LABEL, type BotStrength } from '../../ai/agents';
import { Icon } from '../../components/Icon';
import { session } from '../../session/session';
import { useSession } from '../../session/useSession';
import type { WatchingGame } from '../review/watching';
import { BOT_STRENGTH_HINT, BOT_STRENGTH_SUMMARY } from './botLevel';
import { modeOf } from './boardView';

type OpponentMode = 'ai' | 'friend' | 'local';

interface GameSetupPanelProps {
  isMultiplayer: boolean;
  watchingGame: WatchingGame | null;
  /** A solo or hot-seat game with moves is running (App). */
  gameInProgress: boolean;
  /** The online match is still being played (useGameClocks). */
  mpMatchLive: boolean;
  opponentMode: OpponentMode;
  /** Switches the opponent, through a confirm when a game would be lost
   *  (useNavigationGuards). */
  requestOpponentChange: (next: OpponentMode) => void;
  /** Online needs a signed-in, named player (useAuth). */
  user: User | null;
  displayName: string | null;
  /** The game has started: the mode, the bot and the clock are fixed (App). */
  modeToggleLocked: boolean;
  botLevel: BotStrength;
  setBotLevel: (level: BotStrength) => void;
}

/**
 * Game setup in the right column: the opponent (vs AI, Online, Local), the
 * mode (Classic, Roulette), the bot's strength and the solo time control.
 * The mode and the time control are the session's: read with useSession
 * (the match's mode while one is played here) and set by dispatching to
 * it, as App did. V1: while a replay is playing the whole panel is inert.
 * Its controls used to stay live, so picking "Local" mid-replay mounted the
 * hot-seat UI on top of someone else's game and let it rotate. Nothing in
 * here means anything until the replay is stopped, so nothing in here can
 * be pressed. Order does not matter.
 */
export function GameSetupPanel({
  isMultiplayer,
  watchingGame,
  gameInProgress,
  mpMatchLive,
  opponentMode,
  requestOpponentChange,
  user,
  displayName,
  modeToggleLocked,
  botLevel,
  setBotLevel,
}: GameSetupPanelProps) {
  const gameMode = useSession(modeOf(isMultiplayer));
  const soloTcSec = useSession((s) => s.timeControlSec);
  return (
    <section
      className={`sidebar-panel sidebar-opponent${watchingGame ? ' is-inert' : ''}`}
      inert={watchingGame ? true : undefined}
    >
      <h2 className="sidebar-panel-title">Game setup</h2>
      {watchingGame && (
        <p className="setup-inert-note">
          Replay in progress. Stop it to change the game setup.
        </p>
      )}
      <h3 className="setup-sub-label">Opponent</h3>
      {/* Sprint 4.3.1 — when a local game is in progress, lock all
          non-local opponent tabs behind a confirm dialog so a stray
          tap can't silently abandon the game. The lock is "soft":
          the button is visually dimmed (.is-locked) but still
          dispatches click → confirm, instead of being natively
          disabled (which would also suppress the click handler). */}
      {(() => {
        const oppLocked = gameInProgress && !isMultiplayer && !watchingGame;
        const lockedTitle = 'Finish or resign the current game first';
        // An online match (live, or ended with its result still up)
        // cannot be switched away from here: a hard lock, like the
        // mode cards, since no dialog could leave the match cleanly.
        const oppOnlineLock = isMultiplayer;
        const onlineLockedTitle = mpMatchLive
          ? 'Finish or resign the online match first'
          : 'Close the match result first';
        return (
          <div className="opponent-tabs-vertical">
            <button
              type="button"
              className={`opp-tab${opponentMode === 'ai' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
              onClick={() => requestOpponentChange('ai')}
              aria-disabled={oppLocked || undefined}
              disabled={oppOnlineLock}
              title={oppOnlineLock ? onlineLockedTitle : oppLocked ? lockedTitle : 'Play vs the engine'}
            >
              <Icon icon={Bot} size="md" aria-hidden />
              <span>vs AI</span>
            </button>
            {/* V1 — "vs Friend" undersold this tab: it is the whole
                online side (quick match against a stranger, or a
                private 6-letter code). "Online" pairs naturally with
                "Local" and matches what the lobby actually offers. */}
            <button
              type="button"
              className={`opp-tab${opponentMode === 'friend' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
              onClick={() => requestOpponentChange('friend')}
              aria-disabled={oppLocked || undefined}
              title={
                oppOnlineLock
                  ? onlineLockedTitle
                  : oppLocked
                    ? lockedTitle
                    : 'Play a real opponent: quick match, or a private code'
              }
              disabled={!user || !displayName || oppOnlineLock}
            >
              <Icon icon={Users} size="md" aria-hidden />
              <span>Online</span>
            </button>
            {/* Sprint 4.1 — Local hot-seat. Both colours play from this
                device; the AI scheduler short-circuits via the
                isLocalMode flag in the currentPlayer derivation. */}
            <button
              type="button"
              className={`opp-tab${opponentMode === 'local' ? ' is-active' : ''}`}
              onClick={() => requestOpponentChange('local')}
              disabled={oppOnlineLock}
              title={oppOnlineLock ? onlineLockedTitle : 'Hot-seat: both players on this device'}
            >
              <Icon icon={UsersRound} size="md" aria-hidden />
              <span>Local</span>
            </button>
          </div>
        );
      })()}

      {/* Stitch layout: mode cards moved here from
          above the board — the mock's GAME SETUP panel owns opponent,
          mode and time control together. */}
      <h3 className="setup-sub-label">Mode</h3>
      <div className="game-mode-cards" data-tour="modes">
        <button
          type="button"
          className={`mode-card${gameMode === 'classic' ? ' is-active' : ''}`}
          disabled={modeToggleLocked}
          title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Classic chess rules'}
          onClick={() => {
            if (gameMode === 'classic') return;
            // Also drops a spun bag, and a bag still landing with its
            // clock (step.ts setMode; v1.1.7 fixed this in App).
            session.dispatch({ type: 'setMode', mode: 'classic' });
          }}
        >
          <span className="mode-card-icon" aria-hidden>
            <Icon icon={Crosshair} size="xl" strokeWidth={1.75} />
          </span>
          <span className="mode-card-content">
            <span className="mode-card-title">Classic</span>
            <span className="mode-card-subtitle">
              Standard Chess960 + topology rotation
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`mode-card${gameMode === 'roulette' ? ' is-active' : ''}`}
          disabled={modeToggleLocked}
          title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Spin a 4-slot bag · 2 actions/turn (move or rotate)'}
          onClick={() => {
            if (gameMode === 'roulette') return;
            session.dispatch({ type: 'setMode', mode: 'roulette' });
          }}
        >
          <span className="mode-card-icon" aria-hidden>
            <Icon icon={Dices} size="xl" strokeWidth={1.75} />
          </span>
          <span className="mode-card-content">
            <span className="mode-card-title">Roulette</span>
            <span className="mode-card-subtitle">
              Capture-the-king · spin the wheel
            </span>
          </span>
        </button>
      </div>

      {/* Solo time control: flips the S2.5 elapsed chips into remaining
          countdowns. Display-only — nobody loses on time vs the bot.
          MP time control comes from the lobby, so the pills lock there. */}
      {/* V1 — bot strength. Solo vs AI only; locked once a game is on
          (a mid-game switch would silently change the opponent). */}
      {opponentMode === 'ai' && !isMultiplayer && (
        <>
          <h3 className="setup-sub-label">Bot strength</h3>
          <div className="tc-pills" role="radiogroup" aria-label="Bot strength">
            {BOT_STRENGTHS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={botLevel === level}
                className={`tc-pill${botLevel === level ? ' is-active' : ''}${level === 'strong' ? ' is-ranked' : ''}`}
                disabled={modeToggleLocked}
                title={
                  modeToggleLocked
                    ? 'Finish or restart the game to change the bot'
                    : BOT_STRENGTH_HINT[level]
                }
                onClick={() => setBotLevel(level)}
              >
                {BOT_STRENGTH_LABEL[level]}
              </button>
            ))}
          </div>
          <p className="setup-hint">{BOT_STRENGTH_SUMMARY[botLevel]}</p>
        </>
      )}
      <h3 className="setup-sub-label">Time control</h3>
      <div className="tc-pills" role="radiogroup" aria-label="Time control">
        {([
          [null, 'None'],
          [60, '1 min'],
          [180, '3 min'],
          [600, '10 min'],
        ] as const).map(([sec, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={soloTcSec === sec}
            className={`tc-pill${soloTcSec === sec ? ' is-active' : ''}`}
            disabled={isMultiplayer || modeToggleLocked}
            title={
              isMultiplayer
                ? 'Time control is set in the match lobby'
                : modeToggleLocked
                  ? 'Finish or restart the game to change the clock'
                  : sec === null
                    ? 'Free play: clocks just count time spent'
                    : `Each side gets ${label}. Run out and you lose on time`
            }
            onClick={() => session.dispatch({ type: 'setTimeControl', sec })}
          >
            {label}
          </button>
        ))}
      </div>
      {soloTcSec !== null && !isMultiplayer && (
        <p className="setup-hint">Clocks start on the first move. Out of time = loss.</p>
      )}
    </section>
  );
}
