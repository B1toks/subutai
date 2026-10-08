/**
 * V1 — the single owner of `<html data-theme>`.
 *
 * Themes used to be a plain list that ThemeToggle cycled and wrote straight
 * to the DOM. Adaptive breaks that: the *choice* ("adaptive") and the theme
 * that is actually painted ("neon" right now, "wood-light" after a rotate)
 * are two different things, and two components need to agree on both — the
 * toggle shows the choice, the board drives the topology, and the ambient
 * music stack follows whatever ended up resolved.
 *
 * So the resolution lives here, outside React, and both sides subscribe.
 *
 * ADAPTIVE is the default for a new visitor: topology A plays as neon (the
 * night room), and rotating to topology B flips the whole app to wood-light
 * (day). The board's signature mechanic is the board turning inside out;
 * letting the room turn with it makes the rotation impossible to miss, and
 * it is the one theme behaviour that teaches the mechanic by itself.
 */

export type ThemeChoice = 'adaptive' | 'neon' | 'wood' | 'wood-light' | 'fantasy';
export type ResolvedTheme = 'neon' | 'wood' | 'wood-light' | 'fantasy';
export type Topology = 'A' | 'B';

const STORAGE_KEY = 'subutai_theme';

export const THEME_CHOICES: readonly ThemeChoice[] = [
  'adaptive',
  'neon',
  'wood',
  'wood-light',
  'fantasy',
] as const;

export const THEME_LABELS: Record<ThemeChoice, string> = {
  adaptive: 'Adaptive',
  neon: 'Neon',
  wood: 'Wood',
  'wood-light': 'Wood Light',
  fantasy: 'Fantasy',
};

/** Which theme adaptive paints for each topology. */
const ADAPTIVE_BY_TOPOLOGY: Record<Topology, ResolvedTheme> = {
  A: 'neon',
  B: 'wood-light',
};

type Listener = (resolved: ResolvedTheme, choice: ThemeChoice) => void;

/** Total length of the cross-fade, and where in it the swap happens.
 *  Must match the `theme-veil` keyframes in App.css. */
const VEIL_MS = 440;
const VEIL_PEAK_MS = 170;

function readStoredChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'adaptive';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // 'cyberpunk' was retired in V1; anyone still on it lands on neon,
    // which is the palette it was competing with. Rewrite the key so the
    // dead value doesn't sit in storage being re-migrated forever.
    if (raw === 'cyberpunk') {
      window.localStorage.setItem(STORAGE_KEY, 'neon');
      return 'neon';
    }
    if (raw && (THEME_CHOICES as readonly string[]).includes(raw)) {
      return raw as ThemeChoice;
    }
  } catch {
    /* private mode */
  }
  return 'adaptive';
}

class ThemeStore {
  private choice: ThemeChoice = readStoredChoice();
  private topology: Topology = 'A';
  private listeners = new Set<Listener>();
  private swapTimers: ReturnType<typeof setTimeout>[] = [];
  private veil: HTMLElement | null = null;

  getChoice(): ThemeChoice {
    return this.choice;
  }

  getResolved(): ResolvedTheme {
    return this.choice === 'adaptive'
      ? ADAPTIVE_BY_TOPOLOGY[this.topology]
      : this.choice;
  }

  /** True while the room is following the board rather than a fixed pick. */
  isAdaptive(): boolean {
    return this.choice === 'adaptive';
  }

  setChoice(choice: ThemeChoice): void {
    if (choice === this.choice) return;
    this.choice = choice;
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* private mode — the pick just won't survive a reload */
    }
    this.apply();
  }

  /** Called by App whenever the COMMITTED topology changes (never on the
   *  rotate button's hover preview — the room must not flicker on hover). */
  setTopology(topology: Topology): void {
    if (topology === this.topology) return;
    this.topology = topology;
    if (this.choice === 'adaptive') this.apply();
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** The browser chrome (address bar, PWA title bar) takes its colour from
   *  <meta name="theme-color">. index.html ships neon's background; once a
   *  theme is painted, the meta follows that theme's --bg so wood-light
   *  is not a light page under a dark bar. */
  private syncThemeColor(): void {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.content = bg;
  }

  private notify(resolved: ResolvedTheme): void {
    this.syncThemeColor();
    this.listeners.forEach((cb) => {
      try {
        cb(resolved, this.choice);
      } catch {
        /* a listener must never break theming */
      }
    });
  }

  /**
   * The veil that covers a theme change.
   *
   * Cutting transitions made the swap cheap but it also made it abrupt —
   * the whole room changed between two frames, which reads as the app
   * hiccupping rather than as something it meant to do. So the change
   * happens underneath a short dip: the veil fades in holding the OLD
   * background colour, the theme is swapped while it is at its darkest,
   * and it fades out already holding the NEW one.
   *
   * Driven by a CSS animation, not a transition, for two reasons: the
   * [data-theme-swap] rule that cuts transitions would otherwise cut this
   * one too, and if the animation engine never runs, the failure mode is
   * simply "no dip" — the theme still changes, because the swap is on a
   * timer of its own and never waits for a frame or an event.
   */
  private ensureVeil(): HTMLElement | null {
    if (typeof document === 'undefined' || !document.body) return null;
    if (!this.veil || !this.veil.isConnected) {
      const el = document.createElement('div');
      el.className = 'theme-veil';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      this.veil = el;
    }
    return this.veil;
  }

  /** Write the resolved theme to the DOM and tell everyone. */
  apply(): void {
    const resolved = this.getResolved();
    if (typeof document === 'undefined') {
      this.notify(resolved);
      return;
    }
    const el = document.documentElement;
    const current = el.getAttribute('data-theme');

    // A swap still waiting for the veil's peak is stale either way: the
    // theme it would paint is no longer the choice. Cancel it BEFORE the
    // same-theme early return, or picking Wood and then Neon again inside
    // the dip would still paint Wood a moment later.
    const swapPending = this.swapTimers.length > 0;
    this.swapTimers.forEach(clearTimeout);
    this.swapTimers = [];

    // Same theme, or the very first paint before React mounts: nothing to
    // cross-fade, just write it.
    if (current === resolved || !current) {
      el.setAttribute('data-theme', resolved);
      if (swapPending) {
        // Let a veil that is already dipping fade out on its own timer.
        el.removeAttribute('data-theme-swap');
        const veil = this.veil;
        this.swapTimers.push(
          setTimeout(() => {
            veil?.classList.remove('is-running');
            this.swapTimers = [];
          }, VEIL_MS + 60),
        );
      }
      this.notify(resolved);
      return;
    }

    const veil = this.ensureVeil();
    if (veil) {
      veil.classList.remove('is-running');
      void veil.offsetWidth; // restart the animation on a repeated swap
      veil.classList.add('is-running');
    }

    // Swap while the veil is at its darkest, with per-element transitions
    // cut so the restyle lands in one frame instead of animating the whole
    // document at once.
    this.swapTimers.push(
      setTimeout(() => {
        el.setAttribute('data-theme-swap', '');
        el.setAttribute('data-theme', resolved);
        this.notify(resolved);
      }, VEIL_PEAK_MS),
    );
    this.swapTimers.push(
      setTimeout(() => el.removeAttribute('data-theme-swap'), VEIL_PEAK_MS + 80),
    );
    this.swapTimers.push(
      setTimeout(() => {
        veil?.classList.remove('is-running');
        this.swapTimers = [];
      }, VEIL_MS + 60),
    );
  }
}

export const themeStore = new ThemeStore();

// Paint before React mounts so the first frame is already correct.
themeStore.apply();
