import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  RotateCw,
  Eye,
  Dices,
  BarChart3,
  GraduationCap,
  Swords,
  Settings,
  Disc3,
  Cast,
  Menu,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';

/* S2.2 — first-launch interactive tour. Five coach-mark steps spotlight
 * the elements that make Subutai different from plain chess (the rotate
 * mechanic above all). Targets are located by [data-tour="…"] attributes
 * in App.tsx; a step whose target is missing (e.g. roulette panel not
 * mounted) falls back to a centered card so the tour never breaks. */

export const TUTORIAL_DONE_KEY = 'subutai_tutorial_done';

interface TourStep {
  /** [data-tour] attribute value; omit for a centered card. */
  target?: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    icon: Swords,
    title: 'Welcome to Subutai',
    body:
      'Chess960 on a living board. Pieces start on a random back rank, ' +
      'and the board itself can twist mid-game. Here is the 60-second tour.',
  },
  {
    target: 'board',
    icon: Swords,
    title: 'A fresh start every game',
    body:
      'The back rank is shuffled Chess960-style: no opening theory, just ' +
      'pure play. Pieces move exactly like in regular chess.',
  },
  {
    target: 'rotate',
    icon: RotateCw,
    title: 'The signature move: Rotate',
    body:
      'This button twists every 2×2 block of the board 90°, rewiring which ' +
      'squares touch. It costs your turn: a tempo sacrifice that can open ' +
      'files, save your king, or spring an ambush.',
  },
  {
    target: 'preview',
    icon: Eye,
    title: 'Look before you twist',
    body:
      'Hover the eye to preview what the rotation would do. Click it to ' +
      'lock the preview while you think. Preview is free; only Rotate ' +
      'spends the turn.',
  },
  {
    target: 'coach',
    icon: GraduationCap,
    title: 'Coaching tools',
    body:
      'The cap toggles your helper kit: a support map (who defends whom), ' +
      'a threat map, and the star of the set, the 💡 Hint button: the ' +
      'engine suggests a strong move, and even tells you when rotating ' +
      'the board is the best play. Switch the kit off for a pure game.',
  },
  {
    target: 'modes',
    icon: Dices,
    title: 'Two ways to play',
    body:
      'Classic: standard rules, checkmate wins. Roulette: each turn you ' +
      'spin a bag of piece types and get two actions. Capture the enemy ' +
      'king to win. No check rules, pure chaos.',
  },
  {
    target: 'analysis',
    icon: BarChart3,
    title: 'Learn as you play',
    body:
      'The eval bar shows who is winning in real time, and every move gets ' +
      'graded. After the game, open Review for a move-by-move breakdown ' +
      'with better-move hints.',
  },
  // R11 — the header row, briefly; then the two stars in detail.
  {
    target: 'header',
    icon: Settings,
    title: 'The top bar, in ten seconds',
    body:
      'Everything else lives up here: theme switcher, sound, the music ' +
      'dock, Twitch chat, the leaderboard, your stats and a feedback ' +
      'button. Two of these deserve a closer look.',
  },
  {
    target: 'music',
    icon: Disc3,
    title: 'Music that moves the board',
    body:
      'The disc opens the music dock (beta). Load a Spotify track or a ' +
      'local file, or capture tab audio: the app detects the BPM, locks a ' +
      'beat grid, and the board starts living in rhythm. Beat Mode even ' +
      'lands your moves on the beat. Every control explains itself the ' +
      'first time you press it.',
  },
  {
    target: 'twitch',
    icon: Cast,
    title: 'Let chat play with you',
    body:
      'The cast icon opens Twitch chat (beta). Connect your channel and ' +
      'pick a mode: chat predicts the AI, plays against you, plays FOR ' +
      'you, or guesses your next move for points. Candidate moves appear ' +
      'right on the board as colored dashed arrows.',
  },
];

/**
 * V1 — the tour on a phone.
 *
 * Below 720px the setup panel and the tool rail are drawers that sit off
 * screen until opened, so half of the desktop tour spotlit elements that
 * were not there. The phone tour points at the two buttons that open the
 * drawers instead, talks about tapping rather than hovering (there is no
 * hover on a phone), and drops the steps whose targets only exist on a
 * wide screen.
 */
const STEPS_MOBILE: TourStep[] = [
  STEPS[0],
  STEPS[1],
  STEPS[2],
  {
    target: 'preview',
    icon: Eye,
    title: 'Look before you twist',
    body:
      'Tap the eye to see what a rotation would do, and tap it again to put ' +
      'it away. Looking is free; only Rotate spends your turn.',
  },
  {
    target: 'coach',
    icon: GraduationCap,
    title: 'Coaching tools',
    body:
      'The cap switches on your helper kit: who defends whom, what is under ' +
      'attack, and a Hint button that suggests a strong move. Turn it off ' +
      'for a pure game.',
  },
  {
    target: 'mobile-setup',
    icon: SlidersHorizontal,
    title: 'Game setup',
    body:
      'This slides in the setup panel from the right: your opponent (the ' +
      'bot, someone online, or a friend on this phone), Classic or ' +
      'Roulette, how strong the bot plays, and a clock.',
  },
  {
    target: 'mobile-menu',
    icon: Menu,
    title: 'Everything else',
    body:
      'Music, Twitch chat, the theme, sound and the rules live in the ' +
      'drawer behind this button, on the left.',
  },
  {
    icon: BarChart3,
    title: 'Learn as you play',
    body:
      'The bar beside the board shows who is winning, move by move. After ' +
      'a game, Review walks you through your best and worst moments.',
  },
];

interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TutorialOverlayProps {
  onClose: () => void;
}

export function TutorialOverlay({ onClose }: TutorialOverlayProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<SpotRect | null>(null);
  // Chosen once, when the tour opens: switching step lists mid-tour
  // because a phone was rotated would renumber the steps under the user.
  const [steps] = useState<TourStep[]>(() =>
    typeof window !== 'undefined' && window.innerWidth <= 720 ? STEPS_MOBILE : STEPS,
  );

  const step = steps[stepIdx];

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  // The card's real height, kept current: a step with more text, a wrap
  // change on resize, a font or UI-scale change all resize it.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const read = () => {
      const h = card.offsetHeight;
      if (h) setCardH(h);
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  // Measure the target; re-measure on resize/scroll so the spotlight
  // tracks the element across layout changes.
  useLayoutEffect(() => {
    function measure() {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const r = el.getBoundingClientRect();
      const pad = 8;
      setRect({
        top: r.top - pad,
        left: r.left - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step.target]);

  // Esc closes (counts as done — the user chose to skip).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        setStepIdx((i) => (i < steps.length - 1 ? i + 1 : (onClose(), i)));
      }
      if (e.key === 'ArrowLeft') setStepIdx((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, steps.length]);

  const isLast = stepIdx === steps.length - 1;

  // Place the card below the spotlight when there's room, otherwise above;
  // centered when there's no target. QA-21: the room needed is the card's
  // measured height, not a guess (it is 225px tall on a 375px phone, where
  // the text wraps more), and the final top is clamped so the card and its
  // Next button never leave the screen, whichever side it landed on.
  const cardStyle: React.CSSProperties = rect
    ? (() => {
        const below = rect.top + rect.height + 16;
        const above = rect.top - cardH - 16;
        const top = below + cardH + 12 <= window.innerHeight ? below : above >= 12 ? above : below;
        return {
          top: Math.max(12, Math.min(top, window.innerHeight - cardH - 12)),
          left: clampLeft(rect.left, rect.width),
        };
      })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Tutorial">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : (
        <div className="tour-backdrop" />
      )}
      <div className="tour-card" style={cardStyle} ref={cardRef}>
        <div className="tour-card-header">
          <span className="tour-card-icon" aria-hidden>
            <Icon icon={step.icon} size="lg" strokeWidth={1.75} />
          </span>
          <h3 className="tour-card-title">{step.title}</h3>
        </div>
        <p className="tour-card-body">{step.body}</p>
        <div className="tour-card-footer">
          <button type="button" className="tour-skip-btn" onClick={onClose}>
            Skip
          </button>
          <span className="tour-dots" role="img" aria-label={`Step ${stepIdx + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={`tour-dot${i === stepIdx ? ' is-active' : ''}`} />
            ))}
          </span>
          <span className="tour-nav">
            {stepIdx > 0 && (
              <button
                type="button"
                className="tour-back-btn"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="tour-next-btn"
              onClick={() => (isLast ? onClose() : setStepIdx((i) => i + 1))}
            >
              {isLast ? 'Play!' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function clampLeft(left: number, width: number): number {
  // The card is 340px wide, or the screen minus its margins on a phone.
  const CARD_W = Math.min(340, window.innerWidth - 24);
  const centered = left + width / 2 - CARD_W / 2;
  return Math.max(12, Math.min(centered, window.innerWidth - CARD_W - 12));
}
