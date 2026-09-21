import { Dices, GraduationCap, Play, RotateCw, Swords } from 'lucide-react';
import { Icon } from './Icon';

export const WELCOME_SEEN_KEY = 'subutai_welcome_seen';

interface WelcomeScreenProps {
  onPlay: () => void;
  onTour: () => void;
}

/**
 * V1 — the first thing a first-time visitor sees.
 *
 * Before this, a cold visit dropped straight into a live board with a
 * name prompt and a ten-step tour already running: three things competing
 * for attention before the player had agreed to any of them. Now there is
 * one screen that says what this is and offers exactly two doors, and the
 * tour only runs for someone who asked for it.
 *
 * Deliberately plain: three facts, two buttons, no carousel. Shown once
 * (localStorage), and never for shared-game links or kiosk modes.
 */
export function WelcomeScreen({ onPlay, onTour }: WelcomeScreenProps) {
  return (
    <div className="welcome-root" role="dialog" aria-modal="true" aria-label="Welcome to Subutai">
      <div className="welcome-card">
        <h1 className="welcome-title">subutai</h1>
        <p className="welcome-tagline">Chess on a board that moves.</p>

        <ul className="welcome-points">
          <li>
            <span className="welcome-point-icon" aria-hidden>
              <Icon icon={Swords} size="md" strokeWidth={1.75} />
            </span>
            <span>
              <strong>Every game starts differently.</strong> The back rank is
              shuffled, so there is no opening theory to memorise.
            </span>
          </li>
          <li>
            <span className="welcome-point-icon" aria-hidden>
              <Icon icon={RotateCw} size="md" strokeWidth={1.75} />
            </span>
            <span>
              <strong>You can rotate the board.</strong> Every 2×2 block turns
              90°, rewiring which squares touch. It costs your turn.
            </span>
          </li>
          <li>
            <span className="welcome-point-icon" aria-hidden>
              <Icon icon={Dices} size="md" strokeWidth={1.75} />
            </span>
            <span>
              <strong>Pieces move like normal chess.</strong> If you can play
              chess, you can play this in one minute.
            </span>
          </li>
        </ul>

        <div className="welcome-actions">
          <button type="button" className="welcome-btn welcome-btn-primary" onClick={onPlay}>
            <Icon icon={Play} size="md" aria-hidden /> Start playing
          </button>
          <button type="button" className="welcome-btn welcome-btn-secondary" onClick={onTour}>
            <Icon icon={GraduationCap} size="md" aria-hidden /> Show me around first
          </button>
        </div>

        <p className="welcome-footnote">
          You can replay the tour any time from Rules &amp; info.
        </p>
      </div>
    </div>
  );
}
