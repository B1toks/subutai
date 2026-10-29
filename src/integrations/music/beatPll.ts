/**
 * M.27 — beat PLL: continuous phase glue between essentia passes.
 *
 * The grid's TEMPO is owned by the detectors (histogram scout + essentia
 * judge). But between their discrete corrections the phase can drift a
 * few ms per second (tempo is never measured perfectly), and each 6-12s
 * correction then lands as a visible "step". The PLL removes the steps:
 * every detected kick near a grid beat pulls the phase a fraction of the
 * error toward it — the classic phase-locked loop DJs' gear runs.
 *
 * Deliberately phase-only (no tempo integration): tempo correction
 * arrives from essentia anyway, and a phase-only loop cannot spiral.
 * Deliberately gated: onsets farther than ~a fifth of a period from any
 * beat are syncopation/ghost notes, not evidence the grid is wrong.
 * Wall-base live capture only — file/Spotify grids are already exact.
 */

import { beatEngine } from './beatEngine';
import { liveBpm } from './liveBpm';

const KP = 0.12; // fraction of the phase error corrected per onset
const MAX_NUDGE_MS = 12;
const GATE_FRACTION = 0.22; // of the beat period

class BeatPll {
  private off: (() => void) | null = null;
  /** Diagnostics: |phase error| EMA, exposed for tuning/tests. */
  private errEma = 0;

  isRunning(): boolean {
    return this.off !== null;
  }

  start(): void {
    if (this.off) return;
    this.errEma = 0;
    this.off = liveBpm.onOnset((t) => this.correct(t));
  }

  stop(): void {
    this.off?.();
    this.off = null;
  }

  getErrEma(): number {
    return this.errEma;
  }

  private correct(onsetMs: number): void {
    if (!beatEngine.isRunning() || beatEngine.getBase() !== 'wall') return;
    const p = beatEngine.getIntervalMs();
    if (p <= 0) return;
    const err = beatEngine.phaseErrorAt(onsetMs);
    if (Math.abs(err) > p * GATE_FRACTION) return;
    this.errEma = this.errEma * 0.8 + Math.abs(err) * 0.2;
    beatEngine.nudgePhase(Math.max(-MAX_NUDGE_MS, Math.min(MAX_NUDGE_MS, err * KP)));
  }
}

export const beatPll = new BeatPll();

// Dev seam (same pattern as __liveBpm).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __beatPll?: BeatPll }).__beatPll = beatPll;
}
