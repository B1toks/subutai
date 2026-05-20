import { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';

/**
 * Sprint 3.7 — header toggle for the Web Audio SFX layer. Default OFF
 * (read from AudioController) so first-visit users don't get
 * surprised; the click itself doubles as the user-gesture that
 * unlocks the audio context, and a 'click' SFX plays on enable as a
 * confirmation tone.
 */
export function AudioToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(() => audio.isEnabled());

  function toggle() {
    const next = !enabled;
    audio.setEnabled(next);
    setEnabled(next);
    if (next) {
      // Confirmation tone + ensures the context resumes from the
      // same user gesture that flipped the toggle.
      audio.play('click');
      toast.show('Sound enabled', 'success', 1500);
    } else {
      toast.show('Sound disabled', 'info', 1500);
    }
  }

  return (
    <Tooltip
      text={enabled ? 'Mute sound effects' : 'Enable sound effects'}
      side="bottom"
    >
      <button
        type="button"
        className="header-action-btn"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? 'Mute sound effects' : 'Enable sound effects'}
      >
        <Icon icon={enabled ? Volume2 : VolumeX} size="md" aria-hidden />
      </button>
    </Tooltip>
  );
}
