/* The app-wide brand mark: a diamond with rotation arrows around a crown
 * (rotation = auxetic topology, crown = capture-the-king).
 *
 * It used to cycle through several candidates on click while the identity was
 * being chosen. The diamond won: the picker, the toast and the stored choice
 * are gone, and a leftover subutai_logo_variant in someone's localStorage is
 * simply never read again.
 *
 * The mark is drawn from THEME TOKENS, not the neon palette it was born in.
 * It shipped with hardcoded cyan/magenta, which read as a sticker from another
 * product on the wood, wood-light and fantasy boards. Inline SVG resolves CSS
 * custom properties normally, so every stroke below follows whatever
 * [data-theme] is active: gold-on-bronze in wood, violet in fantasy,
 * cyan/magenta in neon. */

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

export function NeonLogo() {
  return (
    <span className="neon-logo-btn" role="img" aria-label="Subutai">
      <svg viewBox="-32 -32 64 64" aria-hidden>
        <rect x="-19" y="-19" width="38" height="38" transform="rotate(45)" fill="none" stroke={CYAN} strokeWidth="2.6" strokeLinejoin="round" />
        <circle r="13.5" fill="none" stroke={ICE} strokeWidth="1.4" strokeDasharray="5.3 3.2" opacity="0.85" />
        <g transform="translate(0 2)"><Crown size={7.5} /></g>
        <g transform="translate(20 -20) rotate(45)"><OrbitArrow /></g>
        <g transform="translate(-20 20) rotate(225)"><OrbitArrow /></g>
        <g transform="translate(-20 -20) rotate(-45)"><OrbitArrow color={CYAN} /></g>
        <g transform="translate(20 20) rotate(135)"><OrbitArrow color={CYAN} /></g>
      </svg>
    </span>
  );
}
