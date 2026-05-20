import { memo } from 'react';

// Sprint M.3 — viewport-relative perimeter equalizer ring. Sits as an
// overlay around the board (inset: -24px from board edges), with N
// bars per side. Bars on the top/bottom extend outward vertically;
// left/right bars extend outward horizontally — so the ring "breathes"
// away from the board, never inward over the pieces.
//
// The `bands` array carries normalized 0..1 amplitudes (any length —
// we wrap modulo). React.memo + identity-stable inline styles keeps
// the per-frame reconciliation cheap; a 30fps emit cap from the
// equalizer sources prevents thrash.

interface Props {
  bands: number[];
  barsPerSide?: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';

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
    out.push(
      <span
        key={`${side}-${i}`}
        className={`eq-bar eq-bar-${isVertical ? 'vertical' : 'horizontal'}`}
        style={{ ['--amplitude' as never]: amplitude }}
      />,
    );
  }
  return out;
}

function PerimeterEqualizerImpl({ bands, barsPerSide = 10 }: Props) {
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
