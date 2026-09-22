/**
 * V1 — the endgame cinematic, for a win AND for a loss.
 *
 * Supersedes VictoryScene. Two things used to happen at the end of a game
 * and they never met: the checkmate iris closed on the king and shattered
 * it (any mode, any result), and — only on a come-from-behind win — a
 * separate pixel cinematic played. The king's death and the payoff were
 * two unrelated clips.
 *
 * They are one shot now:
 *
 *   iris (DOM, unchanged)  the room goes black around the mated king
 *   ─────────── hand-off ───────────
 *   lift        the king rematerialises AS PIXELS on the spot it stood on
 *               and flies to the centre of the screen, growing
 *   build       victory: the light warms, a crown descends
 *               defeat : the colour drains, cracks open, the king leans
 *   impact      victory: white flash, burst, the crown lands
 *               defeat : the king topples — the resign gesture — and the
 *                        floor takes the hit
 *   drop        victory: beat-synced strobe, "VICTORY" slams in
 *               defeat : a slow red heartbeat, "DEFEAT" bleeds in, ash
 *   settle      one steady colour, film grain, fade
 *
 * The two storyboards share the machinery and share nothing else: the
 * loss is quiet, slow and grey where the win is loud, fast and lit. A
 * loss that plays the victory rhythm in another colour reads as a bug.
 *
 * Everything draws into a small offscreen buffer that is blitted up with
 * smoothing off, so the king, the crown and the lettering are real pixels
 * rather than a filter over something smooth. Click anywhere to skip.
 *
 * Console seams (see App.tsx): subutaiVictory() / subutaiDefeat() /
 * subutaiEndgame('victory' | 'defeat', { full: true }).
 */

import { useEffect, useRef } from 'react';
import { beatEngine } from '../music/beatEngine';

export type VictoryTheme = 'red' | 'blue';
export type EndgameKind = 'victory' | 'defeat';

/** Where the king stood when the game ended, in viewport pixels. */
export interface KingOrigin {
  x: number;
  y: number;
  /** Tile size, so the pixel king starts at the scale it had on the board. */
  size: number;
  color: 'white' | 'black';
}

interface Props {
  kind: EndgameKind;
  /** Victory colour roll. Ignored by the defeat storyboard. */
  theme: VictoryTheme;
  king: KingOrigin | null;
  /**
   * Dark lead-in before the lift, in ms. 0 when the checkmate iris has
   * already blacked the room out; ~650 when the game ended some other way
   * (resign, flag, king capture) and the scene has to do its own fade.
   */
  prelude: number;
  onDone: () => void;
}

/** Internal pixel-buffer height; width follows the viewport aspect. */
const BUFFER_H = 200;
const SYNTH_BEAT_MS = 430; // ~140 BPM fallback when no music grid runs

const LIFT_MS = 1000;
const BUILD_MS = 1400;
const IMPACT_MS = 800;
const DROP_MS = 2400;
const SETTLE_MS = 1400;

/** Where the king comes to rest, as a fraction of the buffer height. */
const KING_REST_Y = 0.56;

interface Palette {
  r: number;
  g: number;
  b: number;
  spark: string;
  word: string;
}

const VICTORY_PALETTE: Record<VictoryTheme, Palette> = {
  red: { r: 255, g: 54, b: 58, spark: '#ffd0a0', word: 'VICTORY' },
  blue: { r: 60, g: 150, b: 255, spark: '#c8f0ff', word: 'VICTORY' },
};

const DEFEAT_PALETTE: Palette = {
  r: 158, g: 34, b: 44, spark: '#6f7482', word: 'DEFEAT',
};

/** Lettering colour: the win burns white, the loss is bone. */
const WORD_INK: Record<EndgameKind, string> = {
  victory: '#ffffff',
  defeat: '#cbc4d0',
};

const KING_SKIN: Record<'white' | 'black', { fill: string; edge: string }> = {
  white: { fill: '#ece9f5', edge: '#3b3550' },
  // A black king on a black screen is nothing, so it is rim-lit instead:
  // dark body, bright edge. Same silhouette, still legible.
  black: { fill: '#2a2636', edge: '#b9b3cc' },
};

/**
 * The king, 11 × 13. Deliberately blunt: at the size this ends up on
 * screen the silhouette is the whole read, and fine detail just turns
 * into noise once it is upscaled ~6×.
 */
const KING_SPRITE = [
  '.....#.....',
  '.....#.....',
  '...#####...',
  '.....#.....',
  '..#.###.#..',
  '..#######..',
  '..#######..',
  '...#####...',
  '....###....',
  '...#####...',
  '..#######..',
  '.#########.',
  '.#########.',
];
const SPRITE_W = 11;
const SPRITE_H = 13;

/**
 * Per-pixel appearance order for the materialise effect, fixed at module
 * load so the king assembles the same way every time instead of shimmering
 * differently on each frame.
 */
const SPRITE_ORDER: number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < SPRITE_W * SPRITE_H; i++) out.push(i);
  // deterministic shuffle
  let seed = 1337;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  const rank = new Array<number>(out.length);
  out.forEach((cell, idx) => {
    rank[cell] = idx / out.length;
  });
  return rank;
})();

// 5×7 pixel glyphs for the word we slam in. 1 = lit pixel.
const GLYPHS: Record<string, string[]> = {
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
};

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 → 0
  size: number;
}

export function EndgameScene({ kind, theme, king, prelude, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = canvas.getContext('2d');
    if (!view) return;
    // Non-null aliases: TS drops control-flow narrowing across the nested
    // rAF/resize closures below, so pin the proven-non-null values here.
    const cv: HTMLCanvasElement = canvas;
    const vx: CanvasRenderingContext2D = view;

    const win = kind === 'victory';
    const col = win ? VICTORY_PALETTE[theme] : DEFEAT_PALETTE;
    const skin = KING_SKIN[king?.color ?? 'white'];

    // Phase boundaries, absolute ms from scene start.
    const T_LIFT = prelude + LIFT_MS;
    const T_BUILD = T_LIFT + BUILD_MS;
    const T_IMPACT = T_BUILD + IMPACT_MS;
    const T_DROP = T_IMPACT + DROP_MS;
    const DURATION = T_DROP + SETTLE_MS;

    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d')!;
    let bw = 0;
    let bh = BUFFER_H;
    // Where the king starts, in buffer coordinates, and how big it is
    // there. Recomputed on resize so a rotated phone doesn't tear the
    // flight path.
    let startX = 0;
    let startY = 0;
    let startPx = 1;

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      cv.width = w;
      cv.height = h;
      bh = BUFFER_H;
      bw = Math.max(1, Math.round((BUFFER_H * w) / h));
      buf.width = bw;
      buf.height = bh;
      vx.imageSmoothingEnabled = false;
      if (king) {
        startX = (king.x / w) * bw;
        startY = (king.y / h) * bh;
        startPx = Math.max(0.6, ((king.size / h) * bh) / SPRITE_H);
      } else {
        startX = bw / 2;
        startY = bh / 2;
        startPx = 1.2;
      }
    }
    resize();
    window.addEventListener('resize', resize);

    const sparks: Spark[] = [];
    const spawnBurst = (n: number, power: number, ox: number, oy: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const sp = power * (0.5 + Math.random());
        sparks.push({
          x: ox,
          y: oy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 0.6,
          life: 1,
          size: 1 + Math.floor(Math.random() * 2),
        });
      }
    };

    // Ash for the defeat storyboard: slow, falls straight, never bursts.
    const ash: Spark[] = [];

    let beatPulse = 0; // 0..1, decays; spikes on each beat during the drop
    const offBeat = beatEngine.onBeat(() => {
      beatPulse = 1;
    });
    let lastSynth = performance.now();
    let impactFired = false;

    // The clock starts at the FIRST PAINTED FRAME, not at mount. Mounting
    // this scene means resolving a lazy chunk and a React commit while the
    // machine is already busy finishing a game; measured in the preview
    // pane, the gap between the effect running and the first rAF callback
    // was close to a second. Timing from mount would silently eat the
    // opening beat — the king would already be sitting in the middle of
    // the screen by the time anything was drawn.
    let start = 0;
    let prev = 0;
    let raf = 0;
    let bail = 0;

    const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
    const easeIn = (k: number) => k * k;

    /**
     * The king. `reveal` < 1 assembles it pixel by pixel (the board glyph
     * turning into pixels), `tilt` rotates it about the middle of its
     * base — which is the pivot a real king topples over.
     */
    const drawKing = (
      cx: number,
      cy: number,
      px: number,
      alpha: number,
      reveal = 1,
      tilt = 0,
      crack = 0,
    ) => {
      const w = SPRITE_W * px;
      const h = SPRITE_H * px;
      bctx.save();
      bctx.globalAlpha = alpha;
      // pivot: bottom centre
      bctx.translate(cx, cy + h / 2);
      if (tilt) bctx.rotate(tilt);
      bctx.translate(-w / 2, -h);

      const cell = (r: number, c: number) => KING_SPRITE[r][c] === '#';
      // 1px rim: the sprite dilated by one pixel underneath the body.
      bctx.fillStyle = skin.edge;
      for (let r = 0; r < SPRITE_H; r++) {
        for (let c = 0; c < SPRITE_W; c++) {
          if (!cell(r, c)) continue;
          if (SPRITE_ORDER[r * SPRITE_W + c] > reveal) continue;
          bctx.fillRect((c - 0.35) * px, (r - 0.35) * px, px * 1.7, px * 1.7);
        }
      }
      bctx.fillStyle = skin.fill;
      for (let r = 0; r < SPRITE_H; r++) {
        for (let c = 0; c < SPRITE_W; c++) {
          if (!cell(r, c)) continue;
          if (SPRITE_ORDER[r * SPRITE_W + c] > reveal) continue;
          bctx.fillRect(c * px, r * px, px, px);
        }
      }
      // Cracks: two dark seams widening across the body as the loss lands.
      if (crack > 0) {
        bctx.fillStyle = `rgba(10,6,12,${0.55 + crack * 0.45})`;
        const cw = Math.max(1, px * 0.5);
        for (let r = 4; r < SPRITE_H; r++) {
          const wobble = ((r * 7) % 3) - 1;
          if (r / SPRITE_H > crack + 0.25) continue;
          bctx.fillRect((5 + wobble) * px, r * px, cw, px);
          if (r > 7) bctx.fillRect((3 + wobble) * px, r * px, cw, px);
        }
      }
      bctx.restore();
      bctx.globalAlpha = 1;
    };

    const drawCrown = (cx: number, cy: number, s: number, alpha: number) => {
      bctx.globalAlpha = alpha;
      bctx.fillStyle = '#e8c24a';
      bctx.fillRect(cx - 3 * s, cy + 1 * s, 6 * s, 2 * s);
      for (let i = -1; i <= 1; i++) {
        bctx.fillRect(cx + i * 2 * s - 0.5 * s, cy - 2 * s, s, 3 * s);
        bctx.fillRect(cx + i * 2 * s - 0.5 * s, cy - 3 * s, s, s); // jewel tip
      }
      bctx.globalAlpha = 1;
    };

    // The word carries its own colour. It used to inherit whatever
    // fillStyle the previous draw happened to leave behind, which was the
    // background tint in the old victory-only scene — and, once the king
    // started being drawn first, the king's near-black crack colour. The
    // lettering was rendered, in black, on black.
    const drawWord = (
      word: string,
      cx: number,
      cy: number,
      px: number,
      alpha: number,
      color: string,
    ) => {
      const gw = 5 * px + px; // glyph + gap
      const totalW = word.length * gw - px;
      let x0 = cx - totalW / 2;
      bctx.fillStyle = color;
      bctx.globalAlpha = alpha;
      for (const ch of word) {
        const g = GLYPHS[ch];
        if (g) {
          for (let row = 0; row < g.length; row++) {
            for (let cxi = 0; cxi < 5; cxi++) {
              if (g[row][cxi] === '1') {
                bctx.fillRect(x0 + cxi * px, cy + row * px, px, px);
              }
            }
          }
        }
        x0 += gw;
      }
      bctx.globalAlpha = 1;
    };

    /** A soft dark vignette closing in — continues the DOM iris. */
    const drawVignette = (k: number) => {
      const g = bctx.createRadialGradient(
        bw / 2, bh * KING_REST_Y, 0,
        bw / 2, bh * KING_REST_Y, bw * (0.75 - k * 0.3),
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(3,2,6,${0.55 + k * 0.4})`);
      bctx.fillStyle = g;
      bctx.fillRect(0, 0, bw, bh);
    };

    function frame(now: number) {
      if (!start) {
        start = now;
        lastSynth = now;
        // Arm the safety net from the first frame, for the same reason the
        // clock starts here.
        bail = window.setTimeout(() => doneRef.current(), DURATION + 2500);
      }
      const t = now - start;
      // Every per-frame delta below is scaled by this, so sparks fall and
      // strobes decay at the same speed on a 30Hz laptop and a 144Hz
      // monitor. Clamped, so one long stall does not teleport everything.
      const dt = prev ? Math.min(3, (now - prev) / 16.67) : 1;
      prev = now;
      const restX = bw / 2;
      const restY = bh * KING_REST_Y;

      // synthetic beat when no real grid is running (victory only — the
      // loss is not a party and never strobes)
      if (win && !beatEngine.isRunning() && now - lastSynth >= SYNTH_BEAT_MS) {
        beatPulse = 1;
        lastSynth = now;
        if (t >= T_IMPACT && t < T_DROP) spawnBurst(10, 2.4, restX, restY - 10);
      }
      beatPulse = Math.max(0, beatPulse - 0.05 * dt);

      // ── background base colour per phase ──
      bctx.fillStyle = '#040307';
      bctx.fillRect(0, 0, bw, bh);

      let shakeX = 0;
      let shakeY = 0;
      if (win && t >= T_IMPACT && t < T_DROP) {
        shakeX = (Math.random() - 0.5) * beatPulse * 6;
        shakeY = (Math.random() - 0.5) * beatPulse * 6;
      }
      // The loss gets exactly one shake: the moment the king hits the floor.
      if (!win && t >= T_IMPACT && t < T_IMPACT + 260) {
        const k = 1 - (t - T_IMPACT) / 260;
        shakeX = (Math.random() - 0.5) * k * 7;
        shakeY = (Math.random() - 0.5) * k * 5;
      }
      bctx.save();
      bctx.translate(shakeX, shakeY);

      // ── phase: prelude + lift ──────────────────────────────────────
      if (t < T_LIFT) {
        const lt = Math.max(0, t - prelude) / LIFT_MS; // 0..1
        const reveal = Math.min(1, lt / 0.28); // materialise first
        const travel = easeOut(Math.min(1, lt));
        const px = startPx + (bh * 0.42 / SPRITE_H - startPx) * travel;
        const kx = startX + (restX - startX) * travel;
        const ky = startY + (restY - startY) * travel;
        drawVignette(Math.min(1, lt));
        // a short trail so the flight has weight
        if (lt > 0.1 && lt < 0.95) {
          for (let i = 1; i <= 2; i++) {
            const bk = easeOut(Math.max(0, lt - i * 0.07));
            drawKing(
              startX + (restX - startX) * bk,
              startY + (restY - startY) * bk,
              startPx + (bh * 0.42 / SPRITE_H - startPx) * bk,
              0.12 / i,
              reveal,
            );
          }
        }
        drawKing(kx, ky, px, 1, reveal);
      } else if (t < T_BUILD) {
        // ── phase: build ─────────────────────────────────────────────
        const k = (t - T_LIFT) / BUILD_MS;
        const px = bh * 0.42 / SPRITE_H;
        if (win) {
          // the light warms from the floor up
          const g = bctx.createLinearGradient(0, bh, 0, 0);
          g.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${0.05 + k * 0.18})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          bctx.fillStyle = g;
          bctx.fillRect(0, 0, bw, bh);
          drawVignette(1 - k * 0.4);
          drawKing(restX, restY, px, 1);
          // the crown descends onto the king's head
          const drop = easeOut(k);
          const headY = restY - (SPRITE_H * px) / 2;
          drawCrown(restX, headY - 26 + drop * 16, 2 + k * 1.2, 0.25 + k * 0.7);
          bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},0.5)`;
          bctx.fillRect(0, bh - 2, Math.round(bw * k), 2);
        } else {
          // the colour drains out of the room and the king starts to lean
          drawVignette(1);
          bctx.fillStyle = `rgba(90,96,110,${0.05 + k * 0.05})`;
          bctx.fillRect(0, 0, bw, bh);
          drawKing(restX, restY, px, 1, 1, -k * 0.09, k * 0.6);
          if (Math.random() < 0.25) {
            ash.push({
              x: Math.random() * bw,
              y: -2,
              vx: (Math.random() - 0.5) * 0.12,
              vy: 0.18 + Math.random() * 0.22,
              life: 1,
              size: 1,
            });
          }
        }
      } else if (t < T_IMPACT) {
        // ── phase: impact ────────────────────────────────────────────
        const it = t - T_BUILD; // 0..IMPACT_MS
        const k = it / IMPACT_MS;
        const px = bh * 0.42 / SPRITE_H;
        if (win) {
          if (!impactFired) {
            spawnBurst(120, 3.4, restX, restY - 8);
            impactFired = true;
          }
          const white = it < 120 ? 1 : Math.floor(it / 70) % 2 === 0 ? 0.55 : 0.05;
          bctx.fillStyle = `rgba(255,255,255,${white})`;
          bctx.fillRect(0, 0, bw, bh);
          const rr = k * bw * 0.7;
          bctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${0.6 * (1 - k)})`;
          bctx.lineWidth = 3;
          bctx.strokeRect(restX - rr, restY - rr, rr * 2, rr * 2);
          drawKing(restX, restY, px, 1);
          const headY = restY - (SPRITE_H * px) / 2;
          drawCrown(restX, headY - 10, 3.2, 1);
        } else {
          // The topple. Gravity, not a transition: it accelerates.
          drawVignette(1);
          const fall = easeIn(Math.min(1, it / 520));
          const tilt = -0.09 - fall * (Math.PI / 2 - 0.09);
          drawKing(restX, restY, px, 1, 1, tilt, 0.6 + k * 0.4);
          if (it >= 520 && !impactFired) {
            spawnBurst(48, 1.5, restX - SPRITE_H * px * 0.5, restY + (SPRITE_H * px) / 2);
            impactFired = true;
          }
          bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${it >= 520 ? 0.16 : 0.04})`;
          bctx.fillRect(0, 0, bw, bh);
        }
      } else if (t < T_DROP) {
        // ── phase: drop ──────────────────────────────────────────────
        const dt = t - T_IMPACT;
        const px = bh * 0.42 / SPRITE_H;
        const wpx = Math.max(1, Math.round(bh / 46));
        if (win) {
          const glow = 0.12 + beatPulse * 0.72;
          bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${glow})`;
          bctx.fillRect(0, 0, bw, bh);
          drawKing(restX, restY + 6, px * 0.72, 0.9);
          const slam = Math.min(1, dt / 260);
          drawWord(
            col.word,
            restX,
            bh * 0.24 - (1 - slam) * 8,
            Math.max(1, Math.round(wpx * slam)),
            slam,
            WORD_INK.victory,
          );
          const headY = restY + 6 - (SPRITE_H * px * 0.72) / 2;
          drawCrown(restX, headY - 8, 2.4, 0.9);
        } else {
          // A slow heartbeat instead of a strobe: two beats, then quiet.
          const beat = Math.max(0, Math.sin((dt / 1100) * Math.PI * 2)) ** 3;
          bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.08 + beat * 0.14})`;
          bctx.fillRect(0, 0, bw, bh);
          // the king lies where it fell
          drawKing(restX, restY, px, 0.85, 1, -Math.PI / 2, 1);
          const fade = Math.min(1, dt / 700);
          drawWord(col.word, restX, bh * 0.24, wpx, fade * 0.92, WORD_INK.defeat);
          if (Math.random() < 0.35) {
            ash.push({
              x: Math.random() * bw,
              y: -2,
              vx: (Math.random() - 0.5) * 0.12,
              vy: 0.18 + Math.random() * 0.22,
              life: 1,
              size: 1,
            });
          }
        }
      } else {
        // ── phase: settle ────────────────────────────────────────────
        const ft = (t - T_DROP) / SETTLE_MS; // 0..1
        const px = bh * 0.42 / SPRITE_H;
        const wpx = Math.max(1, Math.round((bh / 46) * (win ? 1 + ft * 0.25 : 1)));
        bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${(win ? 0.3 : 0.16) - ft * 0.1})`;
        bctx.fillRect(0, 0, bw, bh);
        if (win) {
          drawKing(restX, restY + 6, px * 0.72, 0.9);
          drawWord(col.word, restX, bh * 0.24, wpx, 1, WORD_INK.victory);
          const headY = restY + 6 - (SPRITE_H * px * 0.72) / 2;
          drawCrown(restX, headY - 8, 2.4, 0.9);
        } else {
          drawVignette(1);
          drawKing(restX, restY, px, 0.85 - ft * 0.35, 1, -Math.PI / 2, 1);
          drawWord(col.word, restX, bh * 0.24, wpx, 0.92 - ft * 0.3, WORD_INK.defeat);
        }
      }

      // ── sparks / dust ──
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 0.12 * dt; // gravity
        s.life -= 0.02 * dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        bctx.globalAlpha = Math.max(0, s.life);
        bctx.fillStyle =
          win && Math.random() < 0.5 ? col.spark : win ? `rgb(${col.r},${col.g},${col.b})` : col.spark;
        bctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
      }
      // ── ash (defeat only) ──
      for (let i = ash.length - 1; i >= 0; i--) {
        const a = ash[i];
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        if (a.y > bh) {
          ash.splice(i, 1);
          continue;
        }
        bctx.globalAlpha = 0.25;
        bctx.fillStyle = col.spark;
        bctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
      }
      bctx.globalAlpha = 1;
      bctx.restore();

      // film grain in the settle
      if (t >= T_DROP) {
        for (let i = 0; i < 60; i++) {
          bctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
          bctx.fillRect(Math.floor(Math.random() * bw), Math.floor(Math.random() * bh), 1, 1);
        }
      }

      // blit buffer → screen, upscaled, no smoothing (pixel look)
      vx.clearRect(0, 0, cv.width, cv.height);
      vx.drawImage(buf, 0, 0, bw, bh, 0, 0, cv.width, cv.height);

      if (t >= DURATION) {
        doneRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Safety nets. rAF is paused in a hidden or throttled tab, so a player
    // who alts away mid-cinematic would otherwise come back to a
    // full-screen canvas that never ends. `bail` (armed on the first frame)
    // covers a scene that started and stalled; `mountBail` covers a scene
    // whose first frame never arrives at all.
    //
    // 10s, not 4: a hidden tab pauses rAF completely, and a browser pane
    // that is merely busy can go several seconds without a frame. At 4s
    // this fired on a scene that was about to play perfectly well. Longer
    // than this and the player is clearly away, and would rather come back
    // to the result than to a cinematic that ambushes them.
    const mountBail = window.setTimeout(() => {
      if (!start) doneRef.current();
    }, 10_000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(bail);
      window.clearTimeout(mountBail);
      offBeat();
      window.removeEventListener('resize', resize);
    };
  }, [kind, theme, king, prelude]);

  return (
    <div
      className="victory-scene"
      onClick={() => doneRef.current()}
      role="button"
      tabIndex={0}
      aria-label={kind === 'victory' ? 'Victory. Click to skip' : 'Defeat. Click to skip'}
    >
      <canvas ref={canvasRef} className="victory-canvas" />
      <div className="victory-skip">click to skip</div>
    </div>
  );
}

export default EndgameScene;
