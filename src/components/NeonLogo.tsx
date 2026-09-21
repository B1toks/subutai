import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { audio } from '../audio/AudioController';

/* The app-wide brand mark: a diamond with rotation arrows around a crown
 * (rotation = auxetic topology, crown = capture-the-king), plus four riffs
 * on the same language. Click to cycle; the pick persists.
 *
 * V1 — the mark is drawn from THEME TOKENS, not the neon palette it was
 * born in. It shipped with hardcoded cyan/magenta, which read as a sticker
 * from another product on the wood, wood-light and fantasy boards. Inline
 * SVG resolves CSS custom properties normally, so every stroke below
 * follows whatever [data-theme] is active: gold-on-bronze in wood, violet
 * in fantasy, cyan/magenta in neon. */

const STORAGE_KEY = 'subutai_logo_variant';
const NAMES = [
  'Diamond orbit',
  'Twin squares',
  'Checker ring',
  'Hex crown',
  'S monogram',
] as const;

/** Primary line (the frame), secondary (the crown), and the light core. */
const CYAN = 'var(--accent-primary)';
const MAGENTA = 'var(--accent-secondary)';
const ICE = 'var(--text-primary)';

function Crown({ size = 10, y = 0 }: { size?: number; y?: number }) {
  const s = size;
  return (
    <path
      d={`M${-s} ${y + s * 0.7} L${-s} ${y - s * 0.3} L${-s * 0.5} ${y + s * 0.15} L0 ${y - s * 0.7} L${s * 0.5} ${y + s * 0.15} L${s} ${y - s * 0.3} L${s} ${y + s * 0.7} Z`}
      fill={MAGENTA}
      stroke={MAGENTA}
      strokeWidth="1"
      strokeLinejoin="round"
    />
  );
}

/** Curved arrow used for the rotation motif. Rendered at origin pointing
 *  right; place with transform. */
function OrbitArrow({ color = MAGENTA }: { color?: string }) {
  return (
    <g stroke={color} fill="none" strokeWidth="2.4" strokeLinecap="round">
      <path d="M-7 6 A 9 9 0 0 1 7 6" />
      <path d="M7 6 L3.4 4.2 M7 6 L6.2 1.9" strokeWidth="2" />
    </g>
  );
}

function variantSvg(i: number) {
  switch (i) {
    case 0: // Diamond orbit — closest to the Stitch mark
      return (
        <svg viewBox="-32 -32 64 64" role="img" aria-hidden>
          <rect x="-19" y="-19" width="38" height="38" transform="rotate(45)" fill="none" stroke={CYAN} strokeWidth="2.6" strokeLinejoin="round" />
          <circle r="13.5" fill="none" stroke={ICE} strokeWidth="1.4" strokeDasharray="5.3 3.2" opacity="0.85" />
          <g transform="translate(0 2)"><Crown size={7.5} /></g>
          <g transform="translate(20 -20) rotate(45)"><OrbitArrow /></g>
          <g transform="translate(-20 20) rotate(225)"><OrbitArrow /></g>
          <g transform="translate(-20 -20) rotate(-45)"><OrbitArrow color={CYAN} /></g>
          <g transform="translate(20 20) rotate(135)"><OrbitArrow color={CYAN} /></g>
        </svg>
      );
    case 1: // Twin squares — the auxetic A/B flip
      return (
        <svg viewBox="-32 -32 64 64" role="img" aria-hidden>
          <rect x="-17" y="-17" width="34" height="34" fill="none" stroke={CYAN} strokeWidth="2.4" strokeLinejoin="round" opacity="0.9" />
          <rect x="-17" y="-17" width="34" height="34" transform="rotate(30)" fill="none" stroke={MAGENTA} strokeWidth="2.4" strokeLinejoin="round" opacity="0.9" />
          <g transform="translate(0 2)"><Crown size={7} /></g>
        </svg>
      );
    case 2: // Checker ring — board bent into orbit
      return (
        <svg viewBox="-32 -32 64 64" role="img" aria-hidden>
          <circle r="21" fill="none" stroke={CYAN} strokeWidth="2.2" />
          <circle r="15.5" fill="none" stroke={ICE} strokeWidth="5" strokeDasharray="6.1 6.1" opacity="0.75" />
          <g transform="translate(0 2)"><Crown size={7.5} /></g>
          <g transform="translate(24 -13) rotate(65)"><OrbitArrow /></g>
          <g transform="translate(-24 13) rotate(245)"><OrbitArrow /></g>
        </svg>
      );
    case 3: // Hex crown — arena badge
      return (
        <svg viewBox="-32 -32 64 64" role="img" aria-hidden>
          <polygon points="0,-24 21,-12 21,12 0,24 -21,12 -21,-12" fill="none" stroke={CYAN} strokeWidth="2.6" strokeLinejoin="round" />
          <polygon points="0,-17 15,-8.5 15,8.5 0,17 -15,8.5 -15,-8.5" fill="none" stroke={MAGENTA} strokeWidth="1.3" opacity="0.7" />
          <g transform="translate(0 2)"><Crown size={8} /></g>
        </svg>
      );
    default: // S monogram — wordmark seed
      return (
        <svg viewBox="-32 -32 64 64" role="img" aria-hidden>
          <defs>
            {/* stop-color also accepts custom properties, so the monogram
                gradient tracks the theme like every other variant. */}
            <linearGradient id="neon-s-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={CYAN} />
              <stop offset="1" stopColor={MAGENTA} />
            </linearGradient>
          </defs>
          <path
            d="M14 -14 C14 -22 -14 -22 -14 -8 C-14 4 14 -2 14 10 C14 22 -14 22 -14 12"
            fill="none"
            stroke="url(#neon-s-grad)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <g transform="translate(15 -24)"><Crown size={5} /></g>
        </svg>
      );
  }
}

function readInitial(): number {
  if (typeof window === 'undefined') return 0;
  const raw = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isInteger(raw) && raw >= 0 && raw < NAMES.length ? raw : 0;
}

export function NeonLogo() {
  const toast = useToast();
  const [variant, setVariant] = useState<number>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(variant));
    } catch {
      /* private mode — no-op */
    }
  }, [variant]);

  function cycle() {
    const next = (variant + 1) % NAMES.length;
    setVariant(next);
    audio.play('click');
    toast.show(`Logo ${next + 1}/${NAMES.length}: ${NAMES[next]}`, 'info', 1400);
  }

  return (
    <button
      type="button"
      className="neon-logo-btn"
      onClick={cycle}
      title={`Logo: ${NAMES[variant]} (${variant + 1}/${NAMES.length}). Click for the next one.`}
      aria-label={`Logo variant ${NAMES[variant]}, ${variant + 1} of ${NAMES.length}. Click to try the next.`}
    >
      {variantSvg(variant)}
    </button>
  );
}
