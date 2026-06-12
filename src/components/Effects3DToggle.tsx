import { useEffect, useState } from 'react';
import { Box, Square } from 'lucide-react';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';
import { deviceTier } from '../utils/deviceTier';

const STORAGE_KEY = 'subutai_3d';

function readInitial(): boolean {
  if (typeof window === 'undefined') return true;
  // Explicit user choice always wins.
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === '0') return false;
  if (stored === '1') return true;
  // Sprint 4.5 — no stored choice: default OFF on low-end devices
  // (perspective transforms + per-tile transitions are the priciest
  // paint work we do). The header toggle re-enables in one tap.
  return deviceTier() === 'high';
}

/**
 * Sprint 3.5.1 — header button that toggles the [data-3d] attribute
 * on <html>. All 3D rules in App.css are scoped to [data-3d="on"]
 * so flipping the attribute to "off" instantly flattens the board,
 * piece lift, and topology flip animation. Persisted in localStorage.
 */
export function Effects3DToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(readInitial);

  // Apply the attribute on mount AND every state flip. The toast lives
  // in the click handler (not here) so it never fires on hydration.
  useEffect(() => {
    document.documentElement.setAttribute('data-3d', enabled ? 'on' : 'off');
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* private mode / quota — no-op */
    }
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    audio.play('click');
    toast.show(
      next ? '3D effects enabled' : '3D effects disabled',
      'info',
      1500,
    );
  }

  return (
    <Tooltip
      text={enabled ? 'Disable 3D effects' : 'Enable 3D effects'}
      side="bottom"
    >
      <button
        type="button"
        className="header-action-btn"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? 'Disable 3D effects' : 'Enable 3D effects'}
      >
        <Icon icon={enabled ? Box : Square} size="md" aria-hidden />
      </button>
    </Tooltip>
  );
}
