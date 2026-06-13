import { useEffect, useRef, useState } from 'react';
import { beatBridge, type BeatMoveEvent } from '../music/beatBridge';

/* SP-2 — on-beat combo overlay. Self-subscribed to beatBridge so App
 * never re-renders for it; shows the score of the latest human move
 * ("PERFECT ×7") in tier colors and fades after a beat or two.
 * Mounts permanently (cheap: renders null when idle). */

export function BeatCombo() {
  const [event, setEvent] = useState<BeatMoveEvent | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = beatBridge.onMove((e) => {
      setEvent(e);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setEvent(null), e.achievement ? 4200 : 1800);
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!event) return null;

  const label =
    event.score === 'off'
      ? 'OFF BEAT'
      : event.score === 'perfect'
        ? 'PERFECT'
        : 'ON BEAT';

  return (
    <div className={`beat-combo beat-combo-${event.score} beat-tier-${event.tier}`} role="status">
      <span className="beat-combo-label">{label}</span>
      {event.streak > 1 && <span className="beat-combo-streak">×{event.streak}</span>}
      {event.achievement && (
        <span className="beat-combo-achievement">🏆 Rhythm Master!</span>
      )}
    </div>
  );
}
