import { memo, useEffect, useRef } from 'react';
import { micEq } from '../audio/micEqualizer';

/**
 * M.15 — full-screen sound-reactive dot mesh.
 *
 * A grid of dots whose wave displacement + size breathe with the audio
 * (bass energy from micEq), drifting gently on its own when nothing is
 * playing. Sits behind the whole UI (z-index:0; the app content is
 * lifted above it). Optional mode — mounted only when vizMode.bgGrid.
 *
 * Perf: one canvas, DPR capped at 1.5, a SINGLE fillStyle per frame and
 * cheap fillRect dots (no per-dot arc/state changes). Cost scales with
 * viewport/SPACING; idle and loud cost the same.
 */

const SPACING = 26; // px between dots
const DOT_MIN = 1; // px
const DOT_MAX = 2.6; // px at a crest

function BackgroundWaveGridImpl() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Audio energy (bass), eased toward the latest frame's value.
    let energy = 0;
    let energyTarget = 0;
    const off = micEq.onUpdate((bands) => {
      let bass = 0;
      const n = Math.min(10, bands.length);
      for (let i = 0; i < n; i++) bass += bands[i];
      energyTarget = n ? bass / n : 0;
    });

    let t = 0;
    let raf = 0;
    const render = () => {
      energy += (energyTarget - energy) * 0.12;
      // Idle drift always advances; audio speeds it up and swells the wave.
      t += 0.018 + energy * 0.06;
      const amp = 5 + energy * 48; // crest height in px
      const cols = Math.ceil(W / SPACING) + 1;
      const rows = Math.ceil(H / SPACING) + 1;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = `rgba(150, 162, 182, ${(0.16 + energy * 0.55).toFixed(3)})`;
      for (let r = 0; r < rows; r++) {
        const ry = r * SPACING;
        const rp = r * 0.26;
        for (let c = 0; c < cols; c++) {
          const wave =
            Math.sin(c * 0.34 + t + rp) + Math.cos(c * 0.17 - t * 0.7 + rp * 1.3);
          const y = ry + wave * amp * 0.5;
          const s = DOT_MIN + (wave * 0.5 + 0.5) * (DOT_MAX - DOT_MIN);
          ctx.fillRect(c * SPACING, y, s, s);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      off();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-wave-grid" aria-hidden />;
}

export const BackgroundWaveGrid = memo(BackgroundWaveGridImpl);
