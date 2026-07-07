/**
 * R3 — shared dock layout.
 *
 * The Twitch panel and the music dock are portalled to <body> as
 * position:fixed columns, so when "docked" they sit OVER the app shell
 * instead of pushing it aside. This tiny store lets a docked panel
 * reserve its column width; the App subscribes and (a) pads the shell so
 * the centred content slides clear and (b) shrinks the board so nothing
 * hides behind a panel. Same singleton-outside-React pattern as
 * beatEngine / moveVoting: panels publish, App reacts.
 */

/** Width a docked side panel reserves. Both columns use the same width
 *  so the two-panel layout stays symmetric. */
export const DOCK_WIDTH = 340;

export interface DockState {
  /** Reserved px on the left edge (music dock), 0 when floating/closed. */
  left: number;
  /** Reserved px on the right edge (Twitch), 0 when floating/closed. */
  right: number;
}

type Cb = (s: DockState) => void;

class DockLayoutStore {
  private state: DockState = { left: 0, right: 0 };
  private cbs = new Set<Cb>();

  get(): DockState {
    return this.state;
  }

  setLeft(px: number): void {
    if (px === this.state.left) return;
    this.state = { ...this.state, left: px };
    this.emit();
  }

  setRight(px: number): void {
    if (px === this.state.right) return;
    this.state = { ...this.state, right: px };
    this.emit();
  }

  on(cb: Cb): () => void {
    this.cbs.add(cb);
    return () => {
      this.cbs.delete(cb);
    };
  }

  private emit(): void {
    for (const cb of this.cbs) cb(this.state);
  }
}

export const dockLayout = new DockLayoutStore();

// Dev seam (same pattern as __moveVoting) for manual layout inspection.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __dockLayout?: DockLayoutStore }).__dockLayout = dockLayout;
}
