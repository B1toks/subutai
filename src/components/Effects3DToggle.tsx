import { useEffect, useState } from 'react';
import { Box, Square } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';

const STORAGE_KEY = 'subutai_3d';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  // Explicit user choice always wins.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* storage blocked — fall through to the default */
  }
  // No stored choice: 3D starts OFF on every device. The tilt and the
  // piece lift are an opt-in look, one tap on the rail button away.
  return false;
}

/**
 * Sprint 3.5.1 — header button that toggles the [data-3d] attribute
 * on <html>. All 3D rules in App.css are scoped to [data-3d="on"]
 * so flipping the attribute to "off" instantly flattens the board,
 * piece lift, and topology flip animation. Persisted in localStorage,
 * but only once the player has pressed the button: the default is not
 * a choice, so it is never written down as one.
 */
export function Effects3DToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(readInitial);

  // Apply the attribute on mount AND every state flip. The toast lives
  // in the click handler (not here) so it never fires on hydration.
  useEffect(() => {
    document.documentElement.setAttribute('data-3d', enabled ? 'on' : 'off');
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* private mode / quota — no-op */
    }
    audio.play('click');
    toast.show(
      next ? '3D on: the board tilts and pieces lift' : '3D off: flat board',
      'info',
      1500,
    );
  }

  return (
    <Tooltip
      text={enabled ? 'Turn 3D off (flat board)' : 'Turn 3D on (tilted board, pieces lift)'}
      side="bottom"
    >
      <button
        type="button"
        className="header-action-btn"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label="3D board"
      >
        <Icon icon={enabled ? Box : Square} size="md" aria-hidden />
      </button>
    </Tooltip>
  );
}
