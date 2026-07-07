/**
 * R6 — pixel victory cinematic for a hard-fought win.
 *
 * Plays only on a "tense" victory (the player was behind and clawed
 * back — App gates on the worst eval seen). Follows the storyboard the
 * user sketched, compressed to ~9s:
 *
 *   0.0–3.0s  build-up : cold, dim, a crown fades in over a slow zoom,
 *                        tension line ticks — quiet before the drop.
 *   3.0–3.8s  dip      : everything sinks to near-black (the audio-dip
 *                        beat, the held breath).
 *   3.8–4.6s  impact   : white flash → 2-3 strobe frames → smoke burst
 *                        and sparks explode from the centre.
 *   4.6–7.5s  drop     : theme-colour strobe PULSING ON THE BEAT (real
 *                        beat grid if music is running, else a synthetic
 *                        ~140 BPM), screen shake on each hit, sparks,
 *                        "VICTORY" slams in.
 *   7.5–9.0s  freeze   : light settles to one steady colour, slow zoom
 *                        on the word, film grain, gentle fade.
 *
 * The whole frame renders to a small offscreen buffer and is blitted up
 * with smoothing off, so text, crown and haze all read as chunky pixels
 * for free. Click anywhere to skip.
 */

import { useEffect, useRef } from 'react';
import { beatEngine } from '../music/beatEngine';

export type VictoryTheme = 'red' | 'blue';

interface Props {
  theme: VictoryTheme;
  onDone: () => void;
}

const DURATION = 9000;
const T_DIP = 3000;
const T_IMPACT = 3800;
const T_DROP = 4600;
const T_FREEZE = 7500;

/** Internal pixel-buffer height; width follows the viewport aspect. */
const BUFFER_H = 200;
const SYNTH_BEAT_MS = 430; // ~140 BPM fallback when no music grid runs

const THEMES: Record<VictoryTheme, { r: number; g: number; b: number; spark: string }> = {
  red: { r: 255, g: 54, b: 58, spark: '#ffd0a0' },
  blue: { r: 60, g: 150, b: 255, spark: '#c8f0ff' },
};

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 → 0
  size: number;
}

// 5×7 pixel glyphs for the word we slam in. 1 = lit pixel.
const GLYPHS: Record<string, string[]> = {
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

export function VictoryScene({ theme, onDone }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
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

    const col = THEMES[theme];
    // Offscreen pixel buffer — everything is drawn here small, then
    // upscaled with smoothing off so it reads as pixel art.
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d')!;
    let bw = 0;
    let bh = BUFFER_H;

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
    }
    resize();
    window.addEventListener('resize', resize);

    const sparks: Spark[] = [];
    const spawnBurst = (n: number, power: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const sp = power * (0.5 + Math.random());
        sparks.push({
          x: bw / 2,
          y: bh / 2,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 0.6,
          life: 1,
          size: 1 + Math.floor(Math.random() * 2),
        });
      }
    };

    let beatPulse = 0; // 0..1, decays; spikes on each beat during the drop
    const offBeat = beatEngine.onBeat(() => {
      beatPulse = 1;
    });
    let lastSynth = performance.now();
    let impactFired = false;

    const start = performance.now();
    let raf = 0;

    const drawCrown = (cx: number, cy: number, s: number, alpha: number) => {
      bctx.globalAlpha = alpha;
      bctx.fillStyle = '#e8c24a';
      // crown base
      bctx.fillRect(cx - 3 * s, cy + 1 * s, 6 * s, 2 * s);
      // three spikes
      for (let i = -1; i <= 1; i++) {
        bctx.fillRect(cx + i * 2 * s - 0.5 * s, cy - 2 * s, s, 3 * s);
        bctx.fillRect(cx + i * 2 * s - 0.5 * s, cy - 3 * s, s, s); // jewel tip
      }
      bctx.globalAlpha = 1;
    };

    const drawWord = (word: string, cx: number, cy: number, px: number, alpha: number) => {
      const gw = 5 * px + px; // glyph + gap
      const totalW = word.length * gw - px;
      let x0 = cx - totalW / 2;
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

    function frame(now: number) {
      const t = now - start;
      // synthetic beat when no real grid is running
      if (!beatEngine.isRunning() && now - lastSynth >= SYNTH_BEAT_MS) {
        beatPulse = 1;
        lastSynth = now;
        if (t >= T_DROP && t < T_FREEZE) spawnBurst(10, 2.4);
      }
      beatPulse = Math.max(0, beatPulse - 0.05);

      // ── background base colour per phase ──
      let bg = '#05060a';
      if (t < T_DIP) {
        // build-up: cold blue-grey, slowly lifting from black
        const k = Math.min(1, t / T_DIP);
        const v = Math.round(8 + k * 18);
        bg = `rgb(${Math.round(v * 0.6)},${Math.round(v * 0.7)},${v})`;
      } else if (t < T_IMPACT) {
        bg = '#020204'; // dip — near black
      }
      bctx.fillStyle = bg;
      bctx.fillRect(0, 0, bw, bh);

      // screen shake amount (drop phase, on beats)
      let shakeX = 0;
      let shakeY = 0;
      if (t >= T_DROP && t < T_FREEZE) {
        shakeX = (Math.random() - 0.5) * beatPulse * 6;
        shakeY = (Math.random() - 0.5) * beatPulse * 6;
      }
      bctx.save();
      bctx.translate(shakeX, shakeY);

      const cx = bw / 2;
      const cy = bh / 2;

      if (t < T_DIP) {
        // build-up: crown fades in over a slow zoom, faint vignette pulse
        const k = t / T_DIP;
        drawCrown(cx, cy, 2 + k * 2.5, 0.15 + k * 0.7);
        // tension line creeping across the bottom
        bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},0.5)`;
        bctx.fillRect(0, bh - 2, Math.round(bw * k), 2);
      } else if (t < T_IMPACT) {
        // dip: a lone dim crown, everything held
        drawCrown(cx, cy, 4.5, 0.25);
      } else if (t < T_DROP) {
        // impact: white flash → strobe → smoke burst
        if (!impactFired) {
          spawnBurst(120, 3.4);
          impactFired = true;
        }
        const it = t - T_IMPACT; // 0..800
        // first 120ms: full white; then strobe every ~70ms
        const white = it < 120 ? 1 : Math.floor(it / 70) % 2 === 0 ? 0.55 : 0.05;
        bctx.fillStyle = `rgba(255,255,255,${white})`;
        bctx.fillRect(0, 0, bw, bh);
        // expanding pixel smoke ring
        const rr = (it / 800) * bw * 0.7;
        bctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${0.6 * (1 - it / 800)})`;
        bctx.lineWidth = 3;
        bctx.strokeRect(cx - rr, cy - rr, rr * 2, rr * 2);
        drawCrown(cx, cy, 5, 1);
      } else if (t < T_FREEZE) {
        // drop: theme strobe pulsing on the beat + VICTORY slam-in
        const glow = 0.12 + beatPulse * 0.72;
        bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${glow})`;
        bctx.fillRect(0, 0, bw, bh);
        const dt = t - T_DROP;
        const px = Math.max(1, Math.round(bh / 46));
        const slam = Math.min(1, dt / 260); // quick slam scale/alpha
        drawWord('VICTORY', cx, cy - 3.5 * px * slam - (1 - slam) * 8, Math.max(1, Math.round(px * slam)), slam);
        drawCrown(cx, cy - 10 * px, 3, 0.9);
      } else {
        // freeze: steady glow, slow zoom on the word, film grain
        const ft = (t - T_FREEZE) / (DURATION - T_FREEZE); // 0..1
        bctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${0.3 - ft * 0.12})`;
        bctx.fillRect(0, 0, bw, bh);
        const px = Math.max(1, Math.round((bh / 46) * (1 + ft * 0.25)));
        drawWord('VICTORY', cx, cy - 3.5 * px, px, 1);
        drawCrown(cx, cy - 11 * px, 3, 0.9);
      }

      // ── sparks ──
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.12; // gravity
        s.life -= 0.02;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        bctx.globalAlpha = Math.max(0, s.life);
        bctx.fillStyle = Math.random() < 0.5 ? col.spark : `rgb(${col.r},${col.g},${col.b})`;
        bctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
      }
      bctx.globalAlpha = 1;
      bctx.restore();

      // film grain in the freeze
      if (t >= T_FREEZE) {
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

    return () => {
      cancelAnimationFrame(raf);
      offBeat();
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <div
      ref={wrapRef}
      className="victory-scene"
      onClick={() => doneRef.current()}
      role="button"
      tabIndex={0}
      aria-label="Victory — click to skip"
    >
      <canvas ref={canvasRef} className="victory-canvas" />
      <div className="victory-skip">click to skip</div>
    </div>
  );
}

export default VictoryScene;
