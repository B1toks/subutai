import { useEffect, useRef, useState } from 'react';
import { beatBridge, type BeatMoveEvent } from '../music/beatBridge';

/* SP-2 — on-beat combo overlay. Self-subscribed to beatBridge so App
 * never re-renders for it; shows the score of the latest human move
 * ("PERFECT ×7") in tier colors and fades after a beat or two.
 * Mounts permanently (cheap: renders null when idle). */

export function BeatCombo() {
  const [event, setEvent] = useState<BeatMoveEvent | null>(null);
  // M.23 — each toast pops at a RANDOM spot around the board (rhythm-game
  // style floating scores) instead of the same fixed corner every time.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = beatBridge.onMove((e) => {
      setEvent(e);
      setPos({ x: 30 + Math.random() * 40, y: 22 + Math.random() * 42 });
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
    <div
      // key forces a remount per toast so the pop animation replays even
      // when hits land back-to-back; random pos is unique per event.
      key={pos ? `${pos.x}-${pos.y}` : 'combo'}
      className={`beat-combo beat-combo-${event.score} beat-tier-${event.tier}`}
      style={pos ? { left: `${pos.x}%`, top: `${pos.y}%` } : undefined}
      role="status">
      <span className="beat-combo-label">{label}</span>
      {event.streak > 1 && <span className="beat-combo-streak">×{event.streak}</span>}
      {/* M.21 — beat points: what this move earned + the session total. */}
      {event.points > 0 && (
        <span className="beat-combo-points">
          +{event.points} · {event.totalPoints}
        </span>
      )}
      {event.achievement && (
        <span className="beat-combo-achievement">🏆 Rhythm Master!</span>
      )}
    </div>
  );
}
