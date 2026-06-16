/**
 * M.15 — background "sound grid" toggle.
 *
 * An optional full-screen mode: a dot-mesh wave behind the whole app that
 * breathes with the audio. Off by default (it's a heavier, full-viewport
 * canvas). Tiny singleton like beatMode/eqSettings so the dock can toggle
 * it and App can mount the canvas reactively.
 */

const KEY = 'subutai_bg_grid';

type Listener = (enabled: boolean) => void;

class VizModeStore {
  private bgGrid: boolean;
  private listeners = new Set<Listener>();

  constructor() {
    let initial = false;
    try {
      initial = localStorage.getItem(KEY) === '1';
    } catch { /* private mode */ }
    this.bgGrid = initial;
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
