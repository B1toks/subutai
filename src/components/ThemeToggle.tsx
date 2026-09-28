import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Contrast, Sparkles, Sun, TreePine, Zap } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';
import {
  THEME_CHOICES,
  THEME_LABELS,
  themeStore,
  type ThemeChoice,
} from '../ui/themeStore';

const ICONS: Record<ThemeChoice, LucideIcon> = {
  adaptive: Contrast,
  neon: Zap,
  wood: TreePine,
  'wood-light': Sun,
  fantasy: Sparkles,
};

/** What each pick means, in one line, for the tooltip. */
const BLURB: Record<ThemeChoice, string> = {
  adaptive: 'follows the board: neon in topology A, daylight in topology B',
  neon: 'indigo night, cyan and magenta',
  wood: 'warm wood room at night',
  'wood-light': 'clean daylight board',
  fantasy: 'parchment and arcane gold',
};

/**
 * V1 — the toggle now cycles a CHOICE, not a painted theme: "Adaptive"
 * hands the decision to the board (see src/ui/themeStore.ts), the other
 * four pin one palette. The store owns `<html data-theme>`, so the ambient
 * music stack and the eval-gradient always read the same resolved value.
 *
 * Cyberpunk was retired in V1 — it sat between neon and wood without being
 * either, and every saved copy of it migrates to neon in the store.
 */
export function ThemeToggle() {
  const toast = useToast();
  const [choice, setChoice] = useState<ThemeChoice>(() => themeStore.getChoice());
  // Sprint 4.0 — theme-hopper easter egg. 8 cycles in 10 seconds fires
  // a toast. Sliding window of timestamps; gated by lastEggAt so the
  // toast doesn't keep firing every subsequent cycle.
  const cycleStampsRef = useRef<number[]>([]);
  const lastEggAtRef = useRef<number>(0);

  // Follow the store: adaptive repaints on every committed rotation, and
  // this keeps the icon/tooltip honest without the component owning state.
  useEffect(() => themeStore.subscribe((resolved, next) => {
    setChoice(next);
    audio.setMusicTheme(resolved);
  }), []);

  function cycle() {
    const idx = THEME_CHOICES.indexOf(choice);
    const next = THEME_CHOICES[(idx + 1) % THEME_CHOICES.length];
    themeStore.setChoice(next);
    setChoice(next);
    audio.play('click');

    // Sprint 4.0 — theme-hopper easter egg.
    const now = Date.now();
    const stamps = cycleStampsRef.current;
    stamps.push(now);
    while (stamps.length > 0 && now - stamps[0] > 10_000) {
      stamps.shift();
    }
    if (stamps.length >= 8 && now - lastEggAtRef.current > 10_000) {
      lastEggAtRef.current = now;
      cycleStampsRef.current = [];
      toast.show("Theme Hopper: can't decide?", 'success', 3500);
      return;
    }

    toast.show(
      next === 'adaptive'
        ? 'Theme: Adaptive. The room follows the board.'
        : `Theme: ${THEME_LABELS[next]}`,
      'info',
      1800,
    );
  }

  const nextChoice = THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];

  return (
    <Tooltip text={`Theme: ${THEME_LABELS[choice]} — ${BLURB[choice]}`} side="bottom">
      <button
        type="button"
        className="theme-toggle"
        onClick={cycle}
        aria-label={`Theme: ${THEME_LABELS[choice]}. Click to switch to ${THEME_LABELS[nextChoice]}.`}
      >
        <Icon icon={ICONS[choice]} size="md" aria-hidden />
      </button>
    </Tooltip>
  );
}
