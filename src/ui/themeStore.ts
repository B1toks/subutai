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
  private swapTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Write the resolved theme to the DOM and tell everyone. */
  apply(): void {
    const resolved = this.getResolved();
    if (typeof document !== 'undefined') {
      const el = document.documentElement;
      // Changing the theme restyles every element in the document. If each
      // of those elements also runs its own transition, the browser is
      // asked to animate the whole page at once, which is most of what a
      // theme change actually costs. Nothing is mid-gesture at this point,
      // so transitions are cut for a moment either side of the swap; see
      // the [data-theme-swap] rule in App.css.
      //
      // A timer, not requestAnimationFrame: rAF is paused in a hidden tab,
      // and an attribute that disables every transition in the app must
      // never be able to get stuck on.
      if (el.getAttribute('data-theme') !== resolved) {
        el.setAttribute('data-theme-swap', '');
        if (this.swapTimer) clearTimeout(this.swapTimer);
        this.swapTimer = setTimeout(() => {
          el.removeAttribute('data-theme-swap');
          this.swapTimer = null;
        }, 90);
      }
      el.setAttribute('data-theme', resolved);
    }
    this.listeners.forEach((cb) => {
      try {
        cb(resolved, this.choice);
      } catch {
        /* a listener must never break theming */
      }
    });
  }
}

export const themeStore = new ThemeStore();

// Paint before React mounts so the first frame is already correct.
themeStore.apply();
