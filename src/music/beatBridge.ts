/**
 * SP-2 — the bridge between the game and the beat engine.
 *
 * App's move handlers call reportMove() after a human move lands; if a
 * beat grid is running the move gets scored against the nearest beat
 * (perfect < 90ms, good < 170ms), the combo streak updates, and the
 * BeatCombo overlay (a subscriber) flashes the result. Display-only:
 * leaderboard points are untouched on this experimental branch.
 *
 * Combo tiers (ported from the M.2 design):
 *   1+ good · 3+ great · 5+ awesome · 10+ master (→ Rhythm Master
 *   achievement, localStorage).
 */

import { beatEngine, type BeatScore } from './beatEngine';

export type ComboTier = 'none' | 'good' | 'great' | 'awesome' | 'master';

export interface BeatMoveEvent {
  score: BeatScore;
  streak: number;
  tier: ComboTier;
  achievement: boolean;
}

const ACHIEVEMENTS_KEY = 'subutai_achievements';
const RHYTHM_MASTER_ID = 'rhythm-master';

export function comboTier(streak: number): ComboTier {
  if (streak >= 10) return 'master';
  if (streak >= 5) return 'awesome';
  if (streak >= 3) return 'great';
  if (streak >= 1) return 'good';
  return 'none';
}

type Listener = (e: BeatMoveEvent) => void;

class BeatBridge {
  private streak = 0;
  private listeners = new Set<Listener>();

  onMove(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  getStreak(): number {
    return this.streak;
  }

  resetStreak() {
    this.streak = 0;
  }

  /** Called by App when a human move lands. No-op (returns null) when
   *  no beat grid is running. */
  reportMove(): BeatMoveEvent | null {
    if (!beatEngine.isRunning()) return null;
    const score = beatEngine.scoreNow();
    if (score === 'off') {
      this.streak = 0;
    } else {
      this.streak += 1;
    }
    const tier = comboTier(this.streak);
    const achievement = this.streak === 10 && this.earnRhythmMaster();
    const event: BeatMoveEvent = { score, streak: this.streak, tier, achievement };
    this.listeners.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // listener errors must not break the game
      }
    });
    return event;
  }

  /** True only the first time the achievement is earned. */
  private earnRhythmMaster(): boolean {
    try {
      const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
      const earned = raw ? (JSON.parse(raw) as string[]) : [];
      if (earned.includes(RHYTHM_MASTER_ID)) return false;
      earned.push(RHYTHM_MASTER_ID);
      localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(earned));
      return true;
    } catch {
      return false;
    }
  }
}

export const beatBridge = new BeatBridge();

// Dev-only hook — see beatEngine.ts.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __beatBridge?: BeatBridge }).__beatBridge = beatBridge;
}
