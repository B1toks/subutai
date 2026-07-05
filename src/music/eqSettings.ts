/**
 * M.15 — perimeter-equalizer "temperature".
 *
 * A single user-controlled sensitivity knob: how hard the equalizer
 * reacts to the audio. Low = calm idle wave; high = hard tracks slam the
 * bars to full reach ("розйобувало"). Lives outside React as a tiny
 * singleton (like beatMode) so the self-driving PerimeterEqualizer can
 * read it every frame with zero React overhead, and the dock slider can
 * write + persist it.
 */

const KEY = 'subutai_eq_sensitivity';
// M.20 — MIN dropped 0.3 → 0.05: the bottom of the range is now truly
// tiny bars. The dock slider walks this range LOGARITHMICALLY, so the
// old minimum (0.3 — the "calm but alive" look the user wants to keep)
// sits ~40% along the track with real selection room on both sides.
export const EQ_SENS_MIN = 0.05;
export const EQ_SENS_MAX = 3.4;
export const EQ_SENS_DEFAULT = 1.2;

const clamp = (v: number) =>
  Math.max(EQ_SENS_MIN, Math.min(EQ_SENS_MAX, v));

type Listener = (sensitivity: number) => void;

class EqSettingsStore {
  private sensitivity: number;
  private listeners = new Set<Listener>();

  constructor() {
    let v = EQ_SENS_DEFAULT;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== null) {
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed)) v = clamp(parsed);
      }
    } catch { /* private mode */ }
    this.sensitivity = v;
  }

  getSensitivity(): number {
    return this.sensitivity;
  }

  setSensitivity(v: number): void {
    const next = clamp(v);
    if (next === this.sensitivity) return;
    this.sensitivity = next;
    try {
      localStorage.setItem(KEY, String(next));
    } catch { /* private mode */ }
    this.listeners.forEach((cb) => {
      try {
        cb(next);
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

export const eqSettings = new EqSettingsStore();
