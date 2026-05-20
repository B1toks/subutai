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
 * Sprint 3.8 — header toggle for the ambient music drone. Separate
 * from AudioToggle because users often want SFX without music (or
 * vice versa). Default OFF. The drone fades in over 2s on enable
 * and out over 0.5s on disable. Per-theme synth stacks live in
 * ../audio/ambient.ts.
 */
export function MusicToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(() => audio.isMusicEnabled());

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      audio.setMusicEnabled(true, readCurrentTheme());
      toast.show('Music on', 'info', 1500);
    } else {
      audio.setMusicEnabled(false);
      toast.show('Music off', 'info', 1500);
    }
  }

  return (
    <Tooltip
      text={enabled ? 'Pause ambient music' : 'Play ambient music'}
      side="bottom"
    >
      <button
        type="button"
        className="header-action-btn"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? 'Pause music' : 'Play music'}
      >
        <Icon icon={enabled ? Music : Music2} size="md" aria-hidden />
      </button>
    </Tooltip>
  );
}
