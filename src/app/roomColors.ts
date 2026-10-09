import type { TopologyState } from '../engine';

// Map a White-perspective centipawn score to a pair of HSL colors that drive
// the linear-gradient. tanh squashes extreme positions into [-1, 1] so the
// gradient eases off rather than running away on crushing material wins.
//
// "Rotation changes the room" (docs/IDEAS.md): topology A gets the original
// warm gold/crimson ramp; topology B gets a cool cyan/violet ramp of the
// same shape. This is a TINT, not a theme swap — it lives entirely inside
// the ambient background gradient, which was already identical across every
// [data-theme], so it never touches piece colors, accents, or panel chrome
// (ThemeToggle keeps full control of those). The existing @property-
// registered --eval-c1/--eval-c2 transition (0.6s ease, in
// src/app/styles/shell.css) does the cross-fade for free — this only
// changes which hue pair feeds it.
export function evalToColors(evalCp: number, topology: TopologyState): { c1: string; c2: string } {
  return roomColors(evalCp, topology, document.documentElement.getAttribute('data-theme'));
}

/** evalToColors under a given data-theme value. */
export function roomColors(
  evalCp: number,
  topology: TopologyState,
  theme: string | null,
): { c1: string; c2: string } {
  const t = Math.tanh(evalCp / 400);
  // M.23 — the room's background is the ONE thing in this app that's
  // deliberately theme-INDEPENDENT: it's a soft, always-on hint of "how
  // is this going" (warm/gold = winning, cool/red = losing), not a mood
  // board. Every dark theme shares one dark-tuned ramp below since they
  // already read fine together; wood-light needed its OWN ramp (same
  // shape, high-lightness cream tones) instead of just being defeated
  // outright — see the removed [data-theme="wood-light"] .app-shell
  // override that used to flatten this to a static color.
  if (theme === 'wood-light') {
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(42, ${25 + 30 * i}%, ${92 - 6 * i}%)`,
        c2: `hsl(36, ${20 + 25 * i}%, ${88 - 6 * i}%)`,
      };
    }
    if (t < -0.1) {
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(355, ${25 + 30 * i}%, ${92 - 8 * i}%)`,
        c2: `hsl(348, ${20 + 25 * i}%, ${87 - 8 * i}%)`,
      };
    }
    return { c1: '#f6f1e8', c2: '#ede5d5' };
  }
  // Neon: the room lives in the indigo family. Topology A leans cyan when
  // winning / magenta when losing; topology B swaps to teal / violet so
  // the "rotation tints the room" beat survives on this theme too.
  if (theme === 'neon') {
    const win = topology === 'B' ? 170 : 195;
    const lose = topology === 'B' ? 275 : 320;
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(${win}, ${40 + 30 * i}%, ${13 + 5 * i}%)`,
        c2: `hsl(${win + 40}, ${30 + 20 * i}%, ${9 + 3 * i}%)`,
      };
    }
    if (t < -0.1) {
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(${lose}, ${35 + 35 * i}%, ${12 + 4 * i}%)`,
        c2: `hsl(${lose - 35}, ${28 + 22 * i}%, ${8 + 3 * i}%)`,
      };
    }
    return topology === 'B'
      ? { c1: '#141a33', c2: '#0f1224' }
      : { c1: '#1a1533', c2: '#12101f' };
  }
  if (topology === 'B') {
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(195, ${30 + 30 * i}%, ${15 + 5 * i}%)`,
        c2: `hsl(210, ${20 + 20 * i}%, ${8 + 3 * i}%)`,
      };
    }
    if (t < -0.1) {
      // V1 — this used to go violet (hsl 275). Neon can carry violet;
      // wood and fantasy cannot — a purple room over a bronze board and
      // gothic gold read as a rendering fault, not as "you are losing".
      // The room just goes dark instead, with barely enough red left in
      // it to feel warm rather than switched off. Losing badly is the
      // light going out, which is the right feeling anyway.
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(350, ${8 + 10 * i}%, ${11 - 5 * i}%)`,
        c2: `hsl(345, ${6 + 8 * i}%, ${6 - 3 * i}%)`,
      };
    }
    return { c1: '#1a1c2a', c2: '#12131f' };
  }
  if (t > 0.1) {
    const i = Math.min(t, 1);
    return {
      c1: `hsl(45, ${30 + 30 * i}%, ${15 + 5 * i}%)`,
      c2: `hsl(35, ${20 + 20 * i}%, ${8 + 3 * i}%)`,
    };
  }
  if (t < -0.1) {
    const i = Math.min(-t, 1);
    return {
      c1: `hsl(355, ${25 + 35 * i}%, ${12 + 4 * i}%)`,
      c2: `hsl(345, ${20 + 25 * i}%, ${6 + 3 * i}%)`,
    };
  }
  return { c1: '#2a2520', c2: '#1a1612' };
}
