import { useEffect, useState } from 'react';

type Theme = 'wood' | 'wood-light' | 'cyberpunk';

const STORAGE_KEY = 'subutai_theme';
const THEMES: readonly Theme[] = ['wood', 'wood-light', 'cyberpunk'] as const;

const ICONS: Record<Theme, string> = {
  wood: '\u{1FAB5}',
  'wood-light': '\u{2600}\u{FE0F}',
  cyberpunk: '\u{1F303}',
};

const LABELS: Record<Theme, string> = {
  wood: 'Wood',
  'wood-light': 'Wood Light',
  cyberpunk: 'Cyberpunk',
};

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'wood';
  const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  return saved && THEMES.includes(saved) ? saved : 'wood';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

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
      {ICONS[theme]}
    </button>
  );
}
