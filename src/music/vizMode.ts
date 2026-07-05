/**
 * M.15 — background "sound grid" toggle.
 *
 * An optional full-screen mode: a dot-mesh wave behind the whole app that
 * breathes with the audio. Off by default (it's a heavier, full-viewport
 * canvas). Tiny singleton like beatMode/eqSettings so the dock can toggle
 * it and App can mount the canvas reactively.
 */

const KEY = 'subutai_bg_grid';
const PULSE_KEY = 'subutai_pulse_mode';

type Listener = (enabled: boolean) => void;

/** M.21 — how the board reacts to the beat.
 *  'always' — the classic heartbeat: board pulses on every beat.
 *  'onmove' — TAP mode (experiment): the board pulses ONLY when the
 *  player taps it in time — any click/tap on the board is scored against
 *  the beat and earns points. The metronome itself stays visual-silent.
 *  (Storage value kept as 'onmove' for compat with saved settings.) */
export type PulseMode = 'always' | 'onmove';
type PulseListener = (mode: PulseMode) => void;

class VizModeStore {
  private bgGrid: boolean;
  private pulseMode: PulseMode;
  private listeners = new Set<Listener>();
  private pulseListeners = new Set<PulseListener>();

  constructor() {
    let initial = false;
    let pulse: PulseMode = 'always';
    try {
      initial = localStorage.getItem(KEY) === '1';
      if (localStorage.getItem(PULSE_KEY) === 'onmove') pulse = 'onmove';
    } catch { /* private mode */ }
    this.bgGrid = initial;
    this.pulseMode = pulse;
  }

  getPulseMode(): PulseMode {
    return this.pulseMode;
  }

  setPulseMode(mode: PulseMode): void {
    if (mode === this.pulseMode) return;
    this.pulseMode = mode;
    try {
      localStorage.setItem(PULSE_KEY, mode);
    } catch { /* private mode */ }
    this.pulseListeners.forEach((cb) => {
      try {
        cb(mode);
      } catch { /* listener errors must not propagate */ }
    });
  }

  onPulseModeChange(cb: PulseListener): () => void {
    this.pulseListeners.add(cb);
    return () => {
      this.pulseListeners.delete(cb);
    };
  }

  isBgGrid(): boolean {
    return this.bgGrid;
  }

  setBgGrid(enabled: boolean): void {
    if (enabled === this.bgGrid) return;
    this.bgGrid = enabled;
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0');
    } catch { /* private mode */ }
    this.listeners.forEach((cb) => {
      try {
        cb(enabled);
      } catch { /* listener errors must not propagate */ }
    });
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const vizMode = new VizModeStore();
