import { useSyncExternalStore } from 'react';
import { busy } from '../ui/busy';

/**
 * V1 — mounted once, next to <App/>, so it exists on every screen: the
 * board, the leaderboard, the review, the lobby. See src/ui/busy.ts.
 */
export function BusyOverlay() {
  const label = useSyncExternalStore(busy.subscribe, busy.get, () => null);
  if (!label) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-card">
        <span className="spinner" aria-hidden />
        <span className="busy-label">{label}…</span>
      </div>
    </div>
  );
}
