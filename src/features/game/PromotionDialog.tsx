import type { PieceType } from '../../engine';
import { useSession } from '../../session/useSession';
import { boardOf } from './boardView';
import { glyphForPiece } from './pieceGlyph';

interface PromotionDialogProps {
  isMultiplayer: boolean;
  /** Promotes the pawn to the piece picked (App's handlePromotion). */
  handlePromotion: (pieceType: PieceType) => void;
  /** Takes the move back: the pawn stays where it was (App's cancelPromotion). */
  cancelPromotion: () => void;
}

/**
 * The promotion picker: queen, rook, bishop or knight, in the colour of
 * the side promoting (the side to move while it is open), read from the
 * board in the session. App renders it while a promotion is pending, solo
 * or online. Order does not matter.
 */
export function PromotionDialog({ isMultiplayer, handlePromotion, cancelPromotion }: PromotionDialogProps) {
  const state = useSession(boardOf(isMultiplayer));
  return (
    <div className="promotion-backdrop" onClick={cancelPromotion}>
      <div className="promotion-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="promotion-title">Promote pawn to:</div>
        <div className="promotion-options">
          {(['queen', 'rook', 'bishop', 'knight'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="promotion-option"
              onClick={() => handlePromotion(type)}
              title={type}
            >
              {/* DEF-12: the promoting side owns the pawn on the last
                  rank = the side to move while the dialog is open. The
                  old code hardcoded white, so Black's picker showed white
                  glyphs (cosmetic; the committed piece was always right). */}
              <span className={`piece piece-${state.sideToMove}`}>
                {glyphForPiece(state.sideToMove, type)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
