import { useState } from 'react';
import { Music, Music2 } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';
import type { AmbientTheme } from '../audio/AudioController';
import { themeStore } from '../ui/themeStore';

function readCurrentTheme(): AmbientTheme {
  // The theme store owns <html data-theme> and already resolves "adaptive"
  // down to a real palette, so reading it here is always a concrete stack.
  return themeStore.getResolved();
}

/**
 * Sprint 3.8 / M.5.2 — header toggle for the ambient music. Separate
 * from AudioToggle because users often want SFX without music (or
 * vice versa). Default OFF.
 *
 * M.5.2/3: Warm is the cozy chord-pad + kalimba direction; Dark keeps the
 * M.5.1 eerie drone as a deliberate mode; Adaptive follows the board —
 * warm when neutral, dark when losing, a victory voice when winning.
 * Per-theme synth stacks live in ../audio/ambient.ts.
 *
 * V1 — the cycle now opens on ADAPTIVE (Off → Adaptive → Warm → Dark →
 * Off), so the first press gives the music that reacts to the game rather
 * than a flat pad. Music still cannot start by itself: browsers only let an
 * AudioContext run after a real click, so "default" here means the default
 * the first press lands on, not autoplay.
 */
type MusicState = 'off' | 'warm' | 'dark' | 'adaptive';

const NEXT_STATE: Record<MusicState, MusicState> = {
  off: 'adaptive',
  adaptive: 'warm',
  warm: 'dark',
  dark: 'off',
};

const STATE_TOAST: Record<Exclude<MusicState, 'off'>, string> = {
  warm: 'Music: Warm ☀',
  dark: 'Music: Dark ☾',
  adaptive: 'Music: Adaptive ⚖ (follows the board)',
};

export function MusicToggle() {
  const toast = useToast();
  const [state, setState] = useState<MusicState>(() =>
    audio.isMusicEnabled() ? audio.getMusicStyle() : 'off',
  );

  function cycle() {
    const next = NEXT_STATE[state];
    setState(next);
    if (next === 'off') {
      audio.setMusicEnabled(false);
      toast.show('Music off', 'info', 1500);
      return;
    }
    audio.setMusicStyle(next);
    audio.setMusicEnabled(true, readCurrentTheme());
    toast.show(STATE_TOAST[next], 'info', 1500);
  }

  const tooltip =
    state === 'off'
      ? 'Play music (adaptive: follows the board)'
      : state === 'adaptive'
        ? 'Switch music to warm'
        : state === 'warm'
          ? 'Switch music to dark'
          : 'Turn music off';

  return (
    <Tooltip text={tooltip} side="bottom">
      <button
        type="button"
        className="header-action-btn"
        onClick={cycle}
        aria-pressed={state !== 'off'}
        aria-label={tooltip}
      >
        <Icon icon={state !== 'off' ? Music : Music2} size="md" aria-hidden />
        {state !== 'off' && (
          <span className="music-style-dot" data-style={state} aria-hidden />
        )}
      </button>
    </Tooltip>
  );
}
