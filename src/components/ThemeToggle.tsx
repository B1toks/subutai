import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MoonStar, Sparkles, Sun, TreePine } from 'lucide-react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';

type Theme = 'wood' | 'wood-light' | 'cyberpunk' | 'fantasy';

const STORAGE_KEY = 'subutai_theme';
const THEMES: readonly Theme[] = ['wood', 'wood-light', 'cyberpunk', 'fantasy'] as const;

const ICONS: Record<Theme, LucideIcon> = {
  wood: TreePine,
  'wood-light': Sun,
  cyberpunk: MoonStar,
  fantasy: Sparkles,
};

const LABELS: Record<Theme, string> = {
  wood: 'Wood',
  'wood-light': 'Wood Light',
  cyberpunk: 'Cyberpunk',
  fantasy: 'Fantasy',
};

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'wood';
  const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  return saved && THEMES.includes(saved) ? saved : 'wood';
}

export function ThemeToggle() {
  const toast = useToast();
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  // Sprint 4.0 — theme-hopper easter egg. 8 cycles in 10 seconds fires
  // a toast. Sliding window of timestamps; gated by lastEggAt so the
  // toast doesn't keep firing every subsequent cycle.
  const cycleStampsRef = useRef<number[]>([]);
  const lastEggAtRef = useRef<number>(0);

  // Sprint 3.4.1 — apply theme on mount AND every state change, but do
  // NOT toast from this effect. The previous version called toast.show
  // from inside the effect, which fired on hydration + every render
  // where any context-value reference changed → toast spam loop. The
  // user-initiated toast now lives in cycle() below.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage may be unavailable (private mode, quota) — no-op */
    }
  }, [theme]);

  function cycle() {
    const idx = THEMES.indexOf(theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
    audio.play('click');
    // Sprint 3.8 — hand the new theme to the ambient music sub-system
    // so the drone cross-fades to the matching stack (no-op if music
    // is disabled).
    audio.setMusicTheme(next);

    // Sprint 4.0 — theme-hopper easter egg. Track cycle timestamps;
    // if ≥8 fall inside a 10s window, fire a one-off toast (gated by
    // lastEggAt so it doesn't keep firing every subsequent cycle).
    const now = Date.now();
    const stamps = cycleStampsRef.current;
    stamps.push(now);
    while (stamps.length > 0 && now - stamps[0] > 10_000) {
      stamps.shift();
    }
    if (stamps.length >= 8 && now - lastEggAtRef.current > 10_000) {
      lastEggAtRef.current = now;
      cycleStampsRef.current = [];
      toast.show("Theme Hopper — can't decide?", 'success', 3500);
      return;
    }

    toast.show(`Theme: ${LABELS[next]}`, 'info', 1500);
  }

  const nextLabel = LABELS[THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={`Theme: ${LABELS[theme]} — click for ${nextLabel}`}
      aria-label={`Theme: ${LABELS[theme]}. Click to switch to ${nextLabel}.`}
    >
      <Icon icon={ICONS[theme]} size="md" aria-hidden />
    </button>
  );
}
