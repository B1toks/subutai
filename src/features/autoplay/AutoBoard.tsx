import type { SquareId, TopologyState } from '../../engine';
import { tilePixelCenter, type BoardLayout } from '../../engine/auxetic';
import { boardOf, lastMoveOf } from '../game/boardView';
import { glyphForPiece } from '../game/pieceGlyph';
import { useSession } from '../../session/useSession';

interface AutoBoardProps {
  isMultiplayer: boolean;
  /** The 64 squares, a8..h1 (App's squares). */
  squares: string[];
  /** The board has just rotated (the rotation animation). */
  recentRotation: boolean;
  boardSize: number;
  /** The topology the board is drawn in (useBoardMarks). */
  displayTopology: TopologyState;
  /** Where each tile sits, and the tiles' scale (useEndgame). */
  layout: BoardLayout;
  scale: number;
  tileBase: number;
}

/**
 * The self-play run's board (?auto): the tiles, the pieces and the last
 * move, no interaction. App hands it to AutoPlayView as its board. The
 * position comes from the session. Order does not matter.
 */
export function AutoBoard({
  isMultiplayer,
  squares,
  recentRotation,
  boardSize,
  displayTopology,
  layout,
  scale,
  tileBase,
}: AutoBoardProps) {
  const state = useSession(boardOf(isMultiplayer));
  const lastMove = useSession(lastMoveOf(isMultiplayer));
  return (
    <div
      className={`board${recentRotation ? ' is-rotated' : ''}`}
      style={{ width: boardSize, height: boardSize }}
    >
      {squares.map((sq) => {
        const piece = state.pieces[sq as SquareId];
        const isDark =
          ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) +
            (Number(sq[1]) - 1)) %
            2 ===
          1;
        const isLastFrom = lastMove?.from === sq;
        const isLastTo = lastMove?.to === sq;
        const { cx, cy, angle } = tilePixelCenter(
          sq as SquareId,
          displayTopology,
          layout,
        );
        const tx = cx - tileBase / 2;
        const ty = cy - tileBase / 2;
        return (
          <div
            key={sq}
            className={[
              'tile',
              isDark ? 'dark' : 'light',
              isLastFrom ? 'last-from' : '',
              isLastTo ? 'last-to' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              width: tileBase,
              height: tileBase,
              transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
            }}
          >
            {piece && (
              <span
                className={`piece piece-${piece.color}`}
                style={angle ? { transform: `rotate(${-angle}deg)` } : undefined}
              >
                {glyphForPiece(piece.color, piece.type)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
