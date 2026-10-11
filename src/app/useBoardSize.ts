import { useState, useEffect, useCallback } from 'react';
import { dockLayout, type DockState } from '../ui/dockLayout';
import { computeBoardSize } from './boardSize';

/**
 * How big the board is: the columns docked panels reserve, the UI scale
 * the player picked (saved, applied as zoom on <body>), and the board size
 * those and the window give, kept current on every resize.
 */
export function useBoardSize() {
  // R3 — reserved side columns when the Twitch / music panels are docked
  // into the layout (not floating). The board sizes down by them so it
  // never hides behind a panel; the shell pads by them so content slides.
  const [dock, setDock] = useState<DockState>(() => dockLayout.get());
  useEffect(() => dockLayout.on(setDock), []);

  // R14 — manual UI scale (0.8–1.5×), persisted. Applied as CSS zoom on
  // <body>, so every panel (portaled ones included) grows with it; the
  // board-size math below divides the viewport by it since layout then
  // happens in zoomed coordinates.
  const [uiScale, setUiScale] = useState<number>(() => {
    try {
      const v = Number.parseFloat(localStorage.getItem('subutai_ui_scale') ?? '1');
      return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      uiScale === 1 ? '' : String(uiScale);
    return () => {
      (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = '';
    };
  }, [uiScale]);
  const pickUiScale = useCallback((v: number) => {
    const clamped = Math.max(0.8, Math.min(1.5, v));
    setUiScale(clamped);
    try {
      localStorage.setItem('subutai_ui_scale', String(clamped));
    } catch {
      /* private mode */
    }
  }, []);

  // R14 — the cap is no longer a flat 520: it follows the viewport
  // (70% of height, up to 820) so big monitors actually get a big board.
  // Docks start closed, so reserving nothing for them on the very first
  // paint is correct; the effect below re-runs the moment one opens.
  const [boardSize, setBoardSize] = useState(() => computeBoardSize(uiScale, 0, 0));

  useEffect(() => {
    const recompute = () =>
      setBoardSize(computeBoardSize(uiScale, dock.left, dock.right));
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [dock, uiScale]);
  return { dock, uiScale, pickUiScale, boardSize };
}
