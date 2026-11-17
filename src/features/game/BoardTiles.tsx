import type { MouseEvent } from 'react';
import type { SquareId } from '../../engine';
import { tilePixelCenter, toTileFrame } from '../../engine/auxetic';
import { useSession } from '../../session/useSession';
import type { useEndgame } from '../endgame/useEndgame';
import type { recentPlies } from './boardMarks';
import {
  allowedPieceTypesOf,
  boardOf,
  lastMoveOf,
  modeOf,
  usedRouletteSlotsOf,
  gameStatusOf,
} from './boardView';
import { glyphForPiece } from './pieceGlyph';
import { isPieceMovableInRoulette } from './roulette';
import type { useBoardFxState } from './useBoardFxState';
import type { useBoardMarks } from './useBoardMarks';
import type { BoardUi } from './useBoardUi';
import type { MoveVerdicts } from './useMoveVerdicts';

type Marks = ReturnType<typeof useBoardMarks>;
type Fx = ReturnType<typeof useBoardFxState>;
type Endgame = ReturnType<typeof useEndgame>;

interface BoardTilesProps {
  /** The classifier's marks (useMoveVerdicts). */
  verdicts: MoveVerdicts;
  /** The board's own UI state (useBoardUi). */
  ui: BoardUi;
  /** The board's marks (useBoardMarks), effects (useBoardFxState) and the
   *  tiles' layout with the checkmate sequence (useEndgame), as App holds them. */
  marks: Marks;
  fx: Fx;
  endgame: Endgame;
  isMultiplayer: boolean;
  /** The 64 squares, a8..h1 (App). */
  squares: string[];
  opponentMode: 'ai' | 'friend' | 'local';
  /** Whose turn from this seat, and the seat's colour (App, useEval). */
  currentPlayer: 'human' | 'ai';
  myColor: 'white' | 'black';
  /** The last plies' marks and a castling rook's slide (App). */
  recentPlyHighlights: ReturnType<typeof recentPlies>;
  castleRookSlide: { from: SquareId; to: SquareId } | null;
  /** The board's marks (useBoardMarks) and effects (useBoardFxState). */
  /** The tiles' layout and scale, and the checkmate sequence (useEndgame). */
  boardSize: number;
  tileBase: number;
  /** Input on a tile (App): click to select and move, right-drag to annotate. */
  onSquareClick: (square: string) => void;
  handleTileContextMenu: (e: MouseEvent) => void;
  handleTileMouseDown: (e: MouseEvent, sq: SquareId) => void;
  handleTileMouseUp: (e: MouseEvent, sq: SquareId) => void;
}

/**
 * The 64 tiles of the board, each with its piece and its marks (the
 * selection and legal targets, check and checkmate, the last move,
 * threats, the hint, the classifier's verdict, the Roulette bag's pieces,
 * right-click colours) and the pieces' slides. A fragment: the tiles stay
 * direct children of .board, before the overlays, as before. The position,
 * the last move, the mode, the status and the Roulette bag come from the
 * session (the match's while one is played here); the input handlers and
 * the marks App or its hooks work out. Order does not matter beyond that
 * DOM order.
 */
export function BoardTiles({
  verdicts,
  ui,
  isMultiplayer,
  squares,
  opponentMode,
  currentPlayer,
  myColor,
  recentPlyHighlights,
  castleRookSlide,
  boardSize,
  tileBase,
  onSquareClick,
  handleTileContextMenu,
  handleTileMouseDown,
  handleTileMouseUp,
  marks,
  fx,
  endgame,
}: BoardTilesProps) {
  const { classifiedSquare, sacrificeSquare } = verdicts;
  const { selected, hintMove, beatSnap, squareAnnotations, setHoveredSquare } = ui;
  const { highlightedTargets, enPassantTargets, checkSquares, threatenedSquares, threateningPieceSquares, displayTopology } = marks;
  const { enPassantExplosionSquare, captureFxSquare } = fx;
  const { layout, scale, mateSeq, irisKingPos, mateKingPos } = endgame;
  const state = useSession(boardOf(isMultiplayer));
  const lastMove = useSession(lastMoveOf(isMultiplayer));
  const gameMode = useSession(modeOf(isMultiplayer));
  const gameStatus = useSession(gameStatusOf);
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const usedRouletteSlots = useSession(usedRouletteSlotsOf(isMultiplayer));
  return (
    <>
      {squares.map((sq) => {
        const piece = state.pieces[sq as SquareId];
        const isDark =
          ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) +
            (Number(sq[1]) - 1)) %
          2 ===
          1;
        const isSelected = selected === sq;
        const isTarget = highlightedTargets.has(sq);
        const isEnPassantTarget = enPassantTargets.has(sq);
        const isEnPassantExplosion = enPassantExplosionSquare === sq;
        // Classic uses the single lastMove state; roulette derives the
        // last two piece-plies from the log so both AI sub-moves show.
        const isLastFrom =
          gameMode === 'roulette'
            ? recentPlyHighlights.from.has(sq)
            : lastMove?.from === sq;
        const isLastTo =
          gameMode === 'roulette'
            ? recentPlyHighlights.to.has(sq)
            : lastMove?.to === sq;
        const olderHighlight =
          gameMode === 'roulette' &&
          (recentPlyHighlights.from.get(sq) === 1 ||
            recentPlyHighlights.to.get(sq) === 1);
        const isCheckedKing = checkSquares.king === sq;
        const isCheckingPiece = checkSquares.checkers.has(sq);
        const threatCount = threatenedSquares.get(sq) ?? 0;
        const isThreateningPiece = threateningPieceSquares.has(sq);

        const { cx, cy, angle } = tilePixelCenter(
          sq as SquareId,
          displayTopology,
          layout,
        );

        // T3: orient via coord mirroring rather than CSS rotate(180deg).
        // The parent .board stays unrotated so piece glyphs render right-
        // way-up for both colors; we just flip the per-tile position so
        // the black player sees their own back rank at the bottom.
        const flip = myColor === 'black';
        const cxView = flip ? boardSize - cx : cx;
        const cyView = flip ? boardSize - cy : cy;
        const tx = cxView - tileBase / 2;
        const ty = cyView - tileBase / 2;

        // Sprint 4.2 — coordinate labels moved out of the tiles into
        // a sibling overlay (.board-coords-overlay below) so they no
        // longer rotate with .board. The per-tile showRankLabel /
        // showFileLabel locals + the corresponding <span> children
        // removed accordingly.

        // Sprint 3.2 / M.20 — piece slide-in. When this tile is
        // lastMove.to in classic mode, compute the pixel offset from the
        // lastMove.from tile so the piece starts at the "from" position
        // and glides back to its real center. M.20 lifted the old
        // angle === 0 restriction: that guard meant every move made
        // while topology B was active (EVERY tile has angle ±90 there —
        // see getSquarePosition — so the old check could never pass)
        // silently skipped the slide entirely, i.e. after the game's own
        // signature rotation mechanic fired even once, no move ever
        // animated again. The dx/dy pixel math itself never depended on
        // either tile's angle — only the piece GLYPH's own counter-
        // rotation does, and that's now animated in parallel below
        // (slideRotFromDeg / .is-rotating-in) instead of gating the
        // slide off entirely.
        let slideDx = 0;
        let slideDy = 0;
        let isSliding = false;
        let slideMs = 260;
        // Angle the piece glyph should rotate FROM (its counter-rotation
        // on the origin tile) so App can animate the glyph's rotation in
        // sync with the wrapper's translate. null when not sliding.
        let slideRotFromAngle: number | null = null;
        // V1 — where this tile's piece should glide in from, if anywhere.
        // Two gaps used to make pieces teleport:
        //   · the slide was gated on `gameMode === 'classic'`, so EVERY
        //     roulette move — both of the bot's sub-moves included — just
        //     appeared on its new square;
        //   · a castle only animated the king; the rook jumped.
        const slideFrom: SquareId | null =
          lastMove?.to === sq && lastMove.from && lastMove.from !== lastMove.to
            ? lastMove.from
            : castleRookSlide?.to === sq
              ? castleRookSlide.from
              : null;
        if (piece && slideFrom) {
          const fromTile = tilePixelCenter(slideFrom, displayTopology, layout);
          const fromCxView = flip ? boardSize - fromTile.cx : fromTile.cx;
          const fromCyView = flip ? boardSize - fromTile.cy : fromTile.cy;
          const viewDx = fromCxView - cxView;
          const viewDy = fromCyView - cyView;
          // V1 — the offset is applied INSIDE the tile, and in topology B
          // every tile is rotated ±90° and scaled. A board-space offset
          // used as-is came out rotated by the tile's own angle, so a
          // piece glided in from the side instead of from the square it
          // left — which reads as a jump, not a move. Express it in the
          // tile's own frame instead.
          const local = toTileFrame(viewDx, viewDy, angle, scale);
          slideDx = local.x;
          slideDy = local.y;
          isSliding = true;
          slideRotFromAngle = fromTile.angle;
          // M.20 — scale duration with travel distance: a one-square hop
          // stays snappy, a board-spanning glide gets a touch more time
          // to read as a real "flight" rather than a blur. Narrow band
          // (220-330ms) so it never reads as sluggish.
          const dist = Math.hypot(viewDx, viewDy);
          slideMs = Math.round(
            Math.min(330, Math.max(220, 220 + (dist / (tileBase * 7)) * 110)),
          );
        }

        return (
          <button
            key={sq}
            type="button"
            className={[
              'tile',
              isDark ? 'dark' : 'light',
              isSelected ? 'selected' : '',
              isEnPassantTarget ? 'target-enpassant' : isTarget ? 'target' : '',
              /* V1 — a destination that holds an enemy piece is not the
                 same offer as an empty square, and until now both got
                 the identical 4px ring. A capture keeps the ring; a
                 quiet move becomes a dot in the middle, so the piece
                 underneath a capture target stays fully visible. */
              isTarget && piece && piece.color !== state.sideToMove
                ? 'is-capture-target'
                : '',
              isEnPassantExplosion ? 'enpassant-explosion' : '',
              captureFxSquare === sq ? 'is-capture-burst' : '',
              isLastFrom ? 'last-from' : '',
              isLastTo ? 'last-to' : '',
              olderHighlight ? 'last-older' : '',
              isCheckedKing ? (gameStatus === 'checkmate' ? 'mated-king' : 'checked-king') : '',
              /* V1 — while the iris closes, the mated king rises off
                 the board, so the endgame cut picks up a piece that is
                 already in the air instead of one appearing from
                 nowhere. Uses the existing [data-3d] perspective; with
                 3D off there is no Z to rise along and the rule does
                 not apply. */
              mateSeq === 'iris' && irisKingPos?.sq === sq ? 'is-mate-rise' : '',
              /* Sprint 4.1 — pulse own pieces whose type matches an
                 unused roulette slot for THIS turn. Only on the
                 active client (currentPlayer === 'human') so the
                 opponent doesn't see hints in MP. isPieceMovable
                 InRoulette handles the slot-used + in-check filter. */
              gameMode === 'roulette' &&
              currentPlayer === 'human' &&
              allowedPieceTypes !== null &&
              piece &&
              piece.color === state.sideToMove &&
              isPieceMovableInRoulette(
                piece.type,
                state,
                'roulette',
                allowedPieceTypes,
                usedRouletteSlots,
              )
                ? 'is-roulette-match'
                : '',
              isCheckingPiece ? (gameStatus === 'checkmate' ? 'mating-piece' : 'checking-piece') : '',
              threatCount > 0 ? 'threatened' : '',
              isThreateningPiece ? 'threatening-piece' : '',
              classifiedSquare?.square === sq
                ? `classified-${classifiedSquare.classification}`
                : '',
              sacrificeSquare === sq ? 'is-sacrifice' : '',
              hintMove && 'from' in hintMove && hintMove.from === sq ? 'hint-from' : '',
              hintMove && 'from' in hintMove && hintMove.to === sq ? 'hint-to' : '',
              beatSnap && beatSnap.to === sq ? 'beat-snap-to' : '',
              beatSnap && beatSnap.from === sq ? 'beat-snap-from' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              width: tileBase,
              height: tileBase,
              transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
              ...(threatCount > 0 ? { '--threat-n': threatCount } as React.CSSProperties : {}),
              ...(beatSnap && (beatSnap.to === sq || beatSnap.from === sq)
                ? ({ '--snap-ms': `${beatSnap.ms}ms` } as React.CSSProperties)
                : {}),
            }}
            onClick={() => onSquareClick(sq)}
            onContextMenu={handleTileContextMenu}
            onMouseDown={(e) => handleTileMouseDown(e, sq as SquareId)}
            onMouseUp={(e) => handleTileMouseUp(e, sq as SquareId)}
            onMouseEnter={() => setHoveredSquare(sq)}
            onMouseLeave={() => setHoveredSquare(null)}
            aria-label={piece ? `${piece.color} ${piece.type} on ${sq}` : sq}
          >
            {squareAnnotations.get(sq as SquareId) && (
              <span
                className={`tile-annotation tile-annotation-${squareAnnotations.get(sq as SquareId)}`}
                aria-hidden
              />
            )}
            {piece ? (
              <span
                className={`piece-slide-wrap${isSliding ? ' is-sliding-in' : ''}`}
                /* Glyph is decorative — the tile button's aria-label
                   already says "white pawn on e2"; exposing the raw
                   ♟ char would make the visible text mismatch it. */
                aria-hidden
                style={isSliding ? ({
                  '--slide-dx': `${slideDx}px`,
                  '--slide-dy': `${slideDy}px`,
                  '--slide-ms': `${slideMs}ms`,
                } as React.CSSProperties) : undefined}
              >
                {(() => {
                  // Sprint 4.2 — in local 2P mode flip black pieces 180°
                  // so the opposite-sitting player sees their own
                  // pieces upright. Composes with the existing
                  // topology-B counter-rotation (`-angle`); MP / AI
                  // modes are untouched.
                  const localBlackFlip =
                    opponentMode === 'local' && piece.color === 'black';
                  const totalRot = (angle ? -angle : 0) + (localBlackFlip ? 180 : 0);
                  // M.20 — if this move's origin tile had a different
                  // counter-rotation than the destination (crossing a
                  // topology-B boundary, or simply moving while B is
                  // already active), animate the glyph's OWN rotation in
                  // parallel with the wrapper's slide instead of letting
                  // it snap straight to totalRot on arrival.
                  const fromRot =
                    slideRotFromAngle !== null
                      ? (slideRotFromAngle ? -slideRotFromAngle : 0) + (localBlackFlip ? 180 : 0)
                      : totalRot;
                  const rotSliding = isSliding && fromRot !== totalRot;
                  // M.21 — the mated king fades/shatters in place once
                  // the death cinematic reaches its shatter phase (see
                  // .checkmate-iris/.checkmate-shatter render site and
                  // the mateSeq state machine above the board render).
                  const isMatedKing =
                    mateSeq === 'shatter' && mateKingPos?.sq === sq;
                  return (
                    <span
                      className={[
                        'piece',
                        piece.color === 'white'
                          ? 'piece-white'
                          : 'piece-black',
                        rotSliding ? 'is-rotating-in' : '',
                        isMatedKing ? 'checkmate-king-fade' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        ...(totalRot !== 0 ? { transform: `rotate(${totalRot}deg)` } : {}),
                        ...(rotSliding
                          ? ({
                              '--slide-rot-from': `${fromRot}deg`,
                              '--slide-rot-to': `${totalRot}deg`,
                              '--slide-ms': `${slideMs}ms`,
                            } as React.CSSProperties)
                          : {}),
                      }}
                    >
                      {glyphForPiece(piece.color, piece.type)}
                    </span>
                  );
                })()}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
