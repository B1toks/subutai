import { useState, useCallback, useEffect } from 'react';

/**
 * Which phone drawer is open, if any: the menu rail or the setup panel.
 * Escape, or a window grown past 720px, closes it; App closes it itself
 * whenever a match starts or the lobby opens.
 */
export function useMobileDrawers() {
  /**
   * V1 — mobile panels.
   *
   * On a phone the icon rail was folded into the header as a second row
   * of small targets and GAME SETUP was pushed below the board, where
   * nobody scrolled to find it. Both become off-canvas drawers instead:
   * the rail slides in from the left, the setup panel from the right, one
   * at a time, behind a scrim. Buttons rather than swipes — this is a web
   * page, a horizontal swipe belongs to the browser's back gesture, and a
   * control the user cannot see is a control they do not have.
   */
  const [mobilePanel, setMobilePanel] = useState<'none' | 'menu' | 'setup'>('none');
  const closeMobilePanel = useCallback(() => setMobilePanel('none'), []);
  useEffect(() => {
    if (mobilePanel === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobilePanel('none');
    };
    // A drawer is a narrow-screen idea. Growing past the breakpoint with
    // one open would leave the page scrimmed over a panel that is back in
    // the normal layout anyway.
    const onResize = () => {
      if (window.innerWidth > 720) setMobilePanel('none');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [mobilePanel]);
  return { mobilePanel, setMobilePanel, closeMobilePanel };
}
