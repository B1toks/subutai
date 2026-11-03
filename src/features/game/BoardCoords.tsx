import type { TopologyState } from '../../engine';

interface BoardCoordsProps {
  /** The colour this seat plays: black sees the board from its side (useEval). */
  myColor: 'white' | 'black';
  /** A rotation previewed (hover) or locked: the labels follow the preview's style. */
  previewTopology: TopologyState | null;
  previewLocked: boolean;
  displayTopology: TopologyState;
  boardSize: number;
  tileBase: number;
}

/**
 * The board's rank and file labels. Sprint 4.2: the overlay lives OUTSIDE
 * .board (a sibling inside .board-with-coords) so the labels stay still
 * while the board itself rotates or previews a rotation; earlier attempts
 * kept them inside the tiles, and the .board rotation transform dragged
 * them along. It renders the same single element the block did, in the
 * same place. Order does not matter.
 */
export function BoardCoords({
  myColor,
  previewTopology,
  previewLocked,
  displayTopology,
  boardSize,
  tileBase,
}: BoardCoordsProps) {
  const flip = myColor === 'black';
  const previewing = !!(previewTopology || previewLocked);
  return (
    <div
      className={`board-coords-overlay${previewing ? ' previewing' : ''}`}
      data-topology={displayTopology}
      aria-hidden
      style={{ width: boardSize, height: boardSize }}
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const rankChar = flip ? String(i + 1) : String(8 - i);
        const fileChar = flip
          ? String.fromCharCode('a'.charCodeAt(0) + (7 - i))
          : String.fromCharCode('a'.charCodeAt(0) + i);
        return (
          <span key={`coord-row-${i}`}>
            <span
              className="board-coord board-coord-rank"
              style={{ top: i * tileBase + 3, left: 4 }}
            >
              {rankChar}
            </span>
            <span
              className="board-coord board-coord-file"
              style={{ left: (i + 1) * tileBase - 12, bottom: 3 }}
            >
              {fileChar}
            </span>
          </span>
        );
      })}
    </div>
  );
}
