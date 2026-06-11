import { useState } from 'react';
import { Music, Music2 } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';
import type { AmbientTheme } from '../audio/AudioController';

function readCurrentTheme(): AmbientTheme {
  if (typeof document === 'undefined') return 'wood';
  const raw = document.documentElement.getAttribute('data-theme');
  if (raw === 'wood-light' || raw === 'cyberpunk' || raw === 'fantasy' || raw === 'wood') {
    return raw;
  }
  return 'wood';
}

/**
 * Sprint 3.8 / M.5.2 — header toggle for the ambient music. Separate
 * from AudioToggle because users often want SFX without music (or
 * vice versa). Default OFF.
 *
 * M.5.2: the button now cycles Off → Warm → Dark → Off. Warm is the
 * cozy chord-pad + kalimba direction (default); Dark keeps the M.5.1
 * eerie drone as a deliberate mode. Per-theme synth stacks live in
 * ../audio/ambient.ts.
 */
type MusicState = 'off' | 'warm' | 'dark';

export function MusicToggle() {
  const toast = useToast();
  const [state, setState] = useState<MusicState>(() =>
    audio.isMusicEnabled() ? audio.getMusicStyle() : 'off',
  );

  function cycle() {
    const next: MusicState =
      state === 'off' ? 'warm' : state === 'warm' ? 'dark' : 'off';
    setState(next);
    if (next === 'off') {
      audio.setMusicEnabled(false);
      toast.show('Music off', 'info', 1500);
      return;
    }
    audio.setMusicStyle(next);
    audio.setMusicEnabled(true, readCurrentTheme());
    toast.show(next === 'warm' ? 'Music: Warm ☀' : 'Music: Dark ☾', 'info', 1500);
  }

  const tooltip =
    state === 'off'
      ? 'Play music (warm)'
      : state === 'warm'
        ? 'Switch music to dark mode'
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
