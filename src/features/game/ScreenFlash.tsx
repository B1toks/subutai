import { Sparkles } from 'lucide-react';
import { Icon } from '../../components/Icon';

interface ScreenFlashProps {
  /** The classifier's flash for the last move (useClassifier), or none. */
  flashEffect: 'blunder' | 'brilliant' | null;
  /** Fresh positions for each brilliant flash (useClassifier). */
  sparklePositions: Array<{ x: number; y: number; delay: number; rot: number }>;
}

/**
 * The full-screen flash after a blunder or a brilliant move, and the
 * sparkles of a brilliant one (board-overlays.css). It sits at the top of the
 * shell, before .app-root, as before; it holds no state, so rendering
 * nothing while there is no flash is the same as not being rendered.
 */
export function ScreenFlash({ flashEffect, sparklePositions }: ScreenFlashProps) {
  return (
    <>
      {flashEffect && (
        <div
          className={`screen-flash-effect screen-flash-${flashEffect}`}
          aria-hidden
        />
      )}
      {flashEffect === 'brilliant' && (
        <div className="brilliant-sparkles" aria-hidden>
          {sparklePositions.map((s, i) => (
            <span
              key={i}
              className="brilliant-sparkle"
              style={{
                left: `${s.x}vw`,
                top: `${s.y}vh`,
                animationDelay: `${s.delay}ms`,
                ['--sparkle-rot' as string]: `${s.rot}deg`,
              } as React.CSSProperties}
            >
              <Icon icon={Sparkles} size="md" aria-hidden />
            </span>
          ))}
        </div>
      )}
    </>
  );
}
