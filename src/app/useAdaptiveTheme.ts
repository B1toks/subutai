import { useEffect } from 'react';
import { themeStore } from '../ui/themeStore';
import type { BoardState } from '../engine';

interface UseAdaptiveThemeArgs {
  state: BoardState;
}

/**
 * Hands the committed topology to the theme store after the board has
 * finished turning, so an adaptive theme follows the board (A night, B
 * day). Themes the player pinned ignore it.
 */
export function useAdaptiveTheme({ state }: UseAdaptiveThemeArgs) {
  // V1 — Adaptive theme: the room follows the COMMITTED topology (never the
  // rotate button's hover preview, same rule the dust-wave FX follows), so
  // topology A is the neon night room and B is daylight. No-op for anyone
  // who pinned a specific theme. See src/ui/themeStore.ts.
  //
  // Deliberately DELAYED past the board's rotation animation (560-650ms).
  // Swapping `data-theme` restyles every element in the document; doing
  // that in the same frame as a transform animation on the board and all
  // 64 tiles turned the rotation into a visible stutter. Letting the board
  // finish turning before the light changes costs nothing and reads better
  // anyway — the board turns, then the room follows it.
  //
  // The store cross-fades the swap itself (a short dip, see themeStore),
  // so this only has to clear the rotation, not hide the change: 560ms
  // here plus the veil's own 170ms lead-in lands the swap right as the
  // board settles.
  useEffect(() => {
    const t = setTimeout(() => themeStore.setTopology(state.topologyState), 560);
    return () => clearTimeout(t);
  }, [state.topologyState]);
}
