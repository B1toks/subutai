import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MoonStar, Sparkles, Sun, TreePine } from 'lucide-react';
import { Icon } from './Icon';
import { useToast } from './Toast';

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
  // Suppress the toast for the very first effect run (initial mount); we
  // only want it on user-initiated cycles, not page-load.
  const firstRunRef = useRef(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage may be unavailable (private mode, quota) — no-op */
    }
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    toast.show(`Theme: ${LABELS[theme]}`, 'info', 1500);
  }, [theme, toast]);

  function cycle() {
    const idx = THEMES.indexOf(theme);
    setTheme(THEMES[(idx + 1) % THEMES.length]);
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
