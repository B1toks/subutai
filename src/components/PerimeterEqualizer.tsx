import { memo } from 'react';

// Sprint M.3 + M.4 — viewport-relative perimeter equalizer ring. 60
// bars total, 15 per side. Bars on top/bottom grow vertically away
// from the board; left/right bars grow horizontally outward — so the
// ring "breathes" away from the board, never inward over pieces.
//
// M.4 additions:
//   • Peak detection — bands above PEAK_THRESHOLD get .is-peak so CSS
//     can layer a brighter glow + a small scale-pop animation.
//   • Amplitude is still wired through the --amplitude custom prop so
//     transitions stay 100% CSS-driven (no rAF re-render thrash).

interface Props {
  bands: number[];
  barsPerSide?: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';

const PEAK_THRESHOLD = 0.75;

function sideOffset(side: Side, barsPerSide: number): number {
  switch (side) {
    case 'top':
      return 0;
    case 'right':
      return barsPerSide;
    case 'bottom':
      return barsPerSide * 2;
    case 'left':
      return barsPerSide * 3;
  }
}

function renderSide(side: Side, bands: number[], barsPerSide: number) {
  const offset = sideOffset(side, barsPerSide);
  const isVertical = side === 'top' || side === 'bottom';
  const out: React.ReactNode[] = [];
  for (let i = 0; i < barsPerSide; i++) {
    const amplitude = bands[(offset + i) % bands.length] ?? 0;
    const peak = amplitude > PEAK_THRESHOLD ? ' is-peak' : '';
    const orient = isVertical ? 'vertical' : 'horizontal';
    out.push(
      <span
        key={`${side}-${i}`}
        className={`eq-bar eq-bar-${orient}${peak}`}
        style={{ ['--amplitude' as never]: amplitude }}
      />,
    );
  }
  return out;
}

function PerimeterEqualizerImpl({ bands, barsPerSide = 15 }: Props) {
  return (
    <div className="perimeter-eq" aria-hidden>
      <div className="eq-side eq-top">{renderSide('top', bands, barsPerSide)}</div>
      <div className="eq-side eq-right">{renderSide('right', bands, barsPerSide)}</div>
      <div className="eq-side eq-bottom">{renderSide('bottom', bands, barsPerSide)}</div>
      <div className="eq-side eq-left">{renderSide('left', bands, barsPerSide)}</div>
    </div>
  );
}

export const PerimeterEqualizer = memo(PerimeterEqualizerImpl);
