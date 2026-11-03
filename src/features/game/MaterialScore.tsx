import { useState } from 'react';
import type { MaterialBreakdown } from './material';

interface MaterialScoreProps {
  /** The material balance from this seat's side, in centipawns (useMaterial). */
  materialScore: number;
  /** What each side has taken (useMaterial). */
  materialBreakdown: MaterialBreakdown;
}

/**
 * The material balance at the end of the board's action row, and on hover
 * what each side has captured. The hover state was App's and only this
 * used it, so it lives here; the component is always mounted where the
 * block was, so the popup behaves as before. Order does not matter.
 */
export function MaterialScore({ materialScore, materialBreakdown }: MaterialScoreProps) {
  const [showMaterialPopup, setShowMaterialPopup] = useState(false);
  return (
    <div
      className="material-score-wrap"
      onMouseEnter={() => setShowMaterialPopup(true)}
      onMouseLeave={() => setShowMaterialPopup(false)}
    >
      <span
        className={`material-score ${materialScore > 0 ? 'positive' : materialScore < 0 ? 'negative' : 'zero'}`}
      >
        {materialScore > 0 ? '+' : ''}
        {(materialScore / 100).toFixed(1)}
      </span>
      {showMaterialPopup && (
        <div className="material-score-popup" role="tooltip">
          <div className="material-captured-section">
            <div className="material-captured-label">Captured by White</div>
            {materialBreakdown.capturedByWhite.length === 0 ? (
              <div className="material-captured-list">—</div>
            ) : (
              <div className="material-captured-list">
                {materialBreakdown.capturedByWhite
                  .map(({ type, count, value }) => {
                    const label = type === 'knight' ? 'N' : type[0].toUpperCase();
                    return `${label}×${count} (${(value / 100).toFixed(1)})`;
                  })
                  .join(', ')}
                <span className="material-captured-total">
                  {' → '}{(materialBreakdown.capturedByWhiteTotal / 100).toFixed(1)}
                </span>
              </div>
            )}
          </div>
          <div className="material-captured-section">
            <div className="material-captured-label">Captured by Black</div>
            {materialBreakdown.capturedByBlack.length === 0 ? (
              <div className="material-captured-list">—</div>
            ) : (
              <div className="material-captured-list">
                {materialBreakdown.capturedByBlack
                  .map(({ type, count, value }) => {
                    const label = type === 'knight' ? 'N' : type[0].toUpperCase();
                    return `${label}×${count} (${(value / 100).toFixed(1)})`;
                  })
                  .join(', ')}
                <span className="material-captured-total">
                  {' → '}{(materialBreakdown.capturedByBlackTotal / 100).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
