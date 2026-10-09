/**
 * How big the board should be right now.
 *
 * One formula for BOTH the initial state and the resize handler. They used
 * to disagree: the first render hardcoded `min(innerWidth - 32, 520)` while
 * the effect computed the real value a frame later, so every page load
 * painted a 520px board inside a layout sized for a much bigger one and
 * then snapped — which is the stretch you see on a reload. One formula,
 * used twice, and the first paint is right.
 */
export function computeBoardSize(uiScale: number, dockLeft: number, dockRight: number): number {
  return boardSizeFor({ width: window.innerWidth, height: window.innerHeight }, uiScale, dockLeft, dockRight);
}

/** computeBoardSize for a given viewport (device px). */
export function boardSizeFor(
  viewport: { width: number; height: number },
  uiScale: number,
  dockLeft: number,
  dockRight: number,
): number {
  // Layout runs in zoom space: divide the device viewport by the scale.
  const vw = viewport.width / uiScale;
  const vh = viewport.height / uiScale;
  // Side docks reserve space only on desktop; below the breakpoint the
  // panels become full-width bottom bars and reserve nothing.
  const reserved = viewport.width > 720 ? dockLeft + dockRight : 0;
  // Above the grid collapse (880px, device px — CSS media queries ignore
  // zoom) the right sidebar + gaps/padding stay clear; below it the board
  // takes the full width minus shell padding. The sidebar is not a flat
  // 320: it steps up on big monitors (SIDEBAR_STEPS in
  // src/app/styles/layout-breakpoints.css), so the reserved chrome and the
  // board cap follow the same steps. They must stay in sync or the board
  // overflows its column.
  const w = viewport.width;
  const sidebar = w >= 2100 ? 460 : w >= 1700 ? 400 : 320;
  // QA-15 — below the grid collapse the board still shares the row with
  // things that are not the sidebar: from 721px the fixed icon rail pads
  // .app-root by 84px on the left (the board used to run 13px off the
  // right edge at 768px), and until the eval bar hides at 640px it sits
  // 20px left of the board and needs that much room.
  const chrome = w > 880 ? sidebar + 72 : w > 720 ? 140 : w > 640 ? 48 : 32;
  const capPx = w >= 2100 ? 1000 : w >= 1700 ? 900 : 820;
  const cap = Math.min(capPx, Math.round(vh * 0.7));
  // R9 — floored at 240px: a hidden/headless tab can report innerWidth 0
  // during init, and without the floor boardSize goes NEGATIVE (tile math,
  // dash arrays and overlays all silently break until the next resize).
  return Math.max(240, Math.min(vw - chrome - reserved, cap));
}
