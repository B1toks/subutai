/**
 * R12 — the music score window. Beat points used to ride inside the
 * floating "PERFECT ×7" toast; now the toast is pure feedback and the
 * running tally lives here: a compact pill pinned bottom-right that
 * appears with the first scored hit. Click to expand the session
 * breakdown (perfect / on beat / off, best streak) and reset.
 * Self-subscribed to beatBridge, so App never re-renders for it.
 */

import { useEffect, useState } from 'react';
import { Music2, RotateCcw } from 'lucide-react';
import { Icon } from './Icon';
import { beatBridge, comboTier, type BeatSessionStats } from '../music/beatBridge';

export function MusicScorePanel() {
  const [stats, setStats] = useState<BeatSessionStats>(() => beatBridge.getStats());
  const [open, setOpen] = useState(false);

  useEffect(
    () => beatBridge.onMove(() => setStats(beatBridge.getStats())),
    [],
  );

  if (stats.hits === 0) return null;

  const tier = comboTier(stats.streak);

  return (
    <div className={`music-score${open ? ' is-open' : ''}`} role="status" aria-label="Music score">
      <button
        type="button"
        className="music-score-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Beat points this session. Click for details"
      >
        <Icon icon={Music2} size="sm" aria-hidden />
        <span className="music-score-total">{stats.totalPoints}</span>
        {stats.streak > 1 && (
          <span className={`music-score-streak beat-tier-${tier}`}>×{stats.streak}</span>
        )}
      </button>
      {open && (
        <div className="music-score-details">
          <div className="music-score-row">
            <span>Perfect</span>
            <span>{stats.perfect}</span>
          </div>
          <div className="music-score-row">
            <span>On beat</span>
            <span>{stats.good}</span>
          </div>
          <div className="music-score-row">
            <span>Off beat</span>
            <span>{stats.off}</span>
          </div>
          <div className="music-score-row">
            <span>Best streak</span>
            <span>×{stats.bestStreak}</span>
          </div>
          <button
            type="button"
            className="music-score-reset"
            onClick={() => {
              beatBridge.resetSession();
              setOpen(false);
            }}
          >
            <Icon icon={RotateCcw} size="sm" aria-hidden /> Reset
          </button>
        </div>
      )}
    </div>
  );
}
