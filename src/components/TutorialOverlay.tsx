import { useEffect, useLayoutEffect, useState } from 'react';
import { RotateCw, Eye, Dices, BarChart3, Swords } from 'lucide-react';
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
      'The back rank is shuffled Chess960-style — no opening theory, just ' +
      'pure play. Pieces move exactly like in regular chess.',
  },
  {
    target: 'rotate',
    icon: RotateCw,
    title: 'The signature move: Rotate',
    body:
      'This button twists every 2×2 block of the board 90°, rewiring which ' +
      'squares touch. It costs your turn — a tempo sacrifice that can open ' +
      'files, save your king, or spring an ambush.',
  },
  {
    target: 'preview',
    icon: Eye,
    title: 'Look before you twist',
    body:
      'Hover the eye to preview what the rotation would do. Click it to ' +
      'lock the preview while you think. Preview is free — only Rotate ' +
      'spends the turn.',
  },
  {
    target: 'modes',
    icon: Dices,
    title: 'Two ways to play',
    body:
      'Classic: standard rules, checkmate wins. Roulette: each turn you ' +
      'spin a bag of piece types and get two actions — capture the enemy ' +
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

  const step = STEPS[stepIdx];

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
        setStepIdx((i) => (i < STEPS.length - 1 ? i + 1 : (onClose(), i)));
      }
      if (e.key === 'ArrowLeft') setStepIdx((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLast = stepIdx === STEPS.length - 1;

  // Place the card below the spotlight when there's room, otherwise above;
  // centered when there's no target.
  const cardStyle: React.CSSProperties = rect
    ? rect.top + rect.height + 220 < window.innerHeight
      ? { top: rect.top + rect.height + 16, left: clampLeft(rect.left, rect.width) }
      : { top: Math.max(16, rect.top - 236), left: clampLeft(rect.left, rect.width) }
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
      <div className="tour-card" style={cardStyle}>
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
          <span className="tour-dots" aria-label={`Step ${stepIdx + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
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
  const CARD_W = 340;
  const centered = left + width / 2 - CARD_W / 2;
  return Math.max(12, Math.min(centered, window.innerWidth - CARD_W - 12));
}
