import { ArrowRight } from 'lucide-react';
import { Icon } from './Icon';

export const WELCOME_SEEN_KEY = 'subutai_welcome_seen';

interface WelcomeScreenProps {
  /** Dismiss and run the tour. The primary (and intended) path. */
  onStart: () => void;
  /** Quiet escape hatch for someone who has seen it all before. */
  onSkip: () => void;
}

/**
 * V1 — the first thing a first-time visitor sees.
 *
 * Deliberately one screen, one sentence, one button. The previous version
 * explained three rules and offered two doors, which is a decision to make
 * before you know what the thing is; the tour explains the same three rules
 * better, standing on the actual board. So this screen's only job is to
 * land the idea and push into the tour.
 *
 * The board behind it keeps its own theme, so this reads as the room's
 * front door rather than a separate splash: every colour is a token.
 */
export function WelcomeScreen({ onStart, onSkip }: WelcomeScreenProps) {
  // NOTE: nothing here fades in. An earlier version staggered the title,
  // line and buttons from opacity 0 via CSS transitions, which left the
  // whole screen blank except the mark whenever the transition engine
  // stalled — a first impression of an empty page. The only motion is the
  // mark's own loop, which is decorative: if it never runs, the screen is
  // still complete and readable.
  return (
    <div className="welcome-root" role="dialog" aria-modal="true" aria-label="Welcome to Subutai">
      <div className="welcome-stage">
        <div className="welcome-mark" aria-hidden>
          {/* The board turning inside out, as one glyph: two squares, one
              rotated, sharing a centre. Pure tokens, so it belongs to
              whichever theme is on. */}
          <svg viewBox="-50 -50 100 100" role="img">
            <rect
              className="welcome-mark-a"
              x="-30"
              y="-30"
              width="60"
              height="60"
              rx="4"
              fill="none"
              stroke="var(--accent-primary)"
              strokeWidth="2.5"
            />
            <rect
              className="welcome-mark-b"
              x="-30"
              y="-30"
              width="60"
              height="60"
              rx="4"
              fill="none"
              stroke="var(--accent-secondary)"
              strokeWidth="2.5"
            />
            <circle r="4.5" fill="var(--text-primary)" />
          </svg>
        </div>

        <h1 className="welcome-title">subutai</h1>
        <p className="welcome-lede">
          Chess on a board that turns inside out.
        </p>

        <button type="button" className="welcome-cta" onClick={onStart}>
          Start the 60-second tour
          <Icon icon={ArrowRight} size="md" aria-hidden />
        </button>

        <button type="button" className="welcome-skip" onClick={onSkip}>
          I know chess, just let me play
        </button>
      </div>
    </div>
  );
}
