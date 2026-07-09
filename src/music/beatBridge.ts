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
import { vizMode } from './vizMode';

export type ComboTier = 'none' | 'good' | 'great' | 'awesome' | 'master';

export interface BeatMoveEvent {
  score: BeatScore;
  streak: number;
  tier: ComboTier;
  achievement: boolean;
  /** M.21 — points earned by THIS move (0 when off-beat). */
  points: number;
  /** M.21 — session-total beat points. */
  totalPoints: number;
}

/** R12 — running session tally shown by the music score window. */
export interface BeatSessionStats {
  totalPoints: number;
  hits: number;
  perfect: number;
  good: number;
  off: number;
  bestStreak: number;
  streak: number;
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
  /** M.21 — session-total beat points (display-only, like the combo). */
  private totalPoints = 0;
  /** M.21.1 — tap refractory (anti multi-finger mash). */
  private lastTapMs = 0;
  private listeners = new Set<Listener>();
  // R12 — session tally for the music score window.
  private perfect = 0;
  private good = 0;
  private off = 0;
  private bestStreak = 0;

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

  /** R12 — snapshot of the running session tally. */
  getStats(): BeatSessionStats {
    return {
      totalPoints: this.totalPoints,
      hits: this.perfect + this.good + this.off,
      perfect: this.perfect,
      good: this.good,
      off: this.off,
      bestStreak: this.bestStreak,
      streak: this.streak,
    };
  }

  /** R12 — zero the tally (the score window's reset button). */
  resetSession() {
    this.streak = 0;
    this.totalPoints = 0;
    this.perfect = 0;
    this.good = 0;
    this.off = 0;
    this.bestStreak = 0;
    // Poke subscribers so the window re-reads the zeroed stats.
    const event: BeatMoveEvent = {
      score: 'off',
      streak: 0,
      tier: 'none',
      achievement: false,
      points: 0,
      totalPoints: 0,
    };
    this.listeners.forEach((cb) => {
      try {
        cb(event);
      } catch {
        /* listener errors must not break the game */
      }
    });
  }

  /** Called by App when a human move lands. No-op (returns null) when
   *  no beat grid is running, or in tap mode — there the TAP is the
   *  scored gesture, and the pointerdown that produced this move has
   *  already been counted (double-scoring would double the pulse too). */
  reportMove(): BeatMoveEvent | null {
    if (!beatEngine.isRunning()) return null;
    if (vizMode.getPulseMode() === 'onmove') return null;
    return this.scoreHit(50, 20);
  }

  /** M.21.1 — tap mode: any tap/click on the board is scored against the
   *  beat. Smaller base than a real move (10/25) — tapping is cheap. A
   *  short refractory blocks multi-finger mashing; honest off-beat taps
   *  still reset the streak, which is the real anti-spam. */
  reportTap(): BeatMoveEvent | null {
    if (!beatEngine.isRunning()) return null;
    const now = performance.now();
    if (now - this.lastTapMs < 150) return null;
    this.lastTapMs = now;
    return this.scoreHit(25, 10);
  }

  private scoreHit(perfectBase: number, goodBase: number): BeatMoveEvent | null {
    const score = beatEngine.scoreNow();
    if (score === 'off') {
      this.streak = 0;
      this.off += 1;
    } else {
      this.streak += 1;
      if (score === 'perfect') this.perfect += 1;
      else this.good += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    }
    const tier = comboTier(this.streak);
    const achievement = this.streak === 10 && this.earnRhythmMaster();
    // M.21 — beat points: base per accuracy, boosted by the streak so a
    // held groove is worth chasing. perfect ×10 streak ⇒ base×1.9.
    const base = score === 'perfect' ? perfectBase : score === 'good' ? goodBase : 0;
    const points = base > 0 ? Math.round(base * (1 + Math.min(9, this.streak - 1) * 0.1)) : 0;
    this.totalPoints += points;
    const event: BeatMoveEvent = {
      score,
      streak: this.streak,
      tier,
      achievement,
      points,
      totalPoints: this.totalPoints,
    };
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
