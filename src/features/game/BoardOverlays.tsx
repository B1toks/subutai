import type { SquareId } from '../../engine';
import { tilePixelCenter } from '../../engine/auxetic';
import type { useEndgame } from '../endgame/useEndgame';
import type { useTwitchState } from '../twitch/useTwitchState';
import type { ArrowAnnotation } from './annotations';
import type { useBoardFxState } from './useBoardFxState';
import type { useBoardMarks } from './useBoardMarks';

type Marks = ReturnType<typeof useBoardMarks>;
type Fx = ReturnType<typeof useBoardFxState>;
type Endgame = ReturnType<typeof useEndgame>;
type Twitch = ReturnType<typeof useTwitchState>;

interface BoardOverlaysProps {
  /** The support map (a coaching tool): on, the square hovered, and who backs whom (useBoardMarks). */
  showSupport: boolean;
  hoveredSquare: string | null;
  supportPairs: Marks['supportPairs'];
  hoverSupporters: Marks['hoverSupporters'];
  /** The player's right-drag arrows (App). */
  arrowAnnotations: ArrowAnnotation[];
  /** Twitch: chat's live vote round (its arrows) and the guessers' cloud (useTwitchState). */
  voteRound: Twitch['voteRound'];
  guessCloud: Twitch['guessCloud'];
  /** The board's effects (useBoardFxState) and the checkmate sequence (useEndgame). */
  checkVignette: Fx['checkVignette'];
  captureStrobe: Fx['captureStrobe'];
  rotationDust: Fx['rotationDust'];
  fxIntensity: Fx['fxIntensity'];
  irisKingPos: Endgame['irisKingPos'];
  mateSeqActive: Endgame['mateSeqActive'];
  mateKingPos: Endgame['mateKingPos'];
  mateSeq: Endgame['mateSeq'];
  /** The board's geometry: the seat's side, the topology drawn, the tiles' layout and size. */
  myColor: 'white' | 'black';
  displayTopology: Marks['displayTopology'];
  layout: Endgame['layout'];
  boardSize: number;
  tileBase: number;
}

/**
 * What is drawn over the tiles inside .board, in this order: the support
 * map, the player's arrows, chat's vote arrows (Twitch), the effects
 * (check vignette, capture strobe, rotation dust, the checkmate iris and
 * shatter) and the cloud of chat's guessers. A fragment: the overlays stay
 * direct children of .board, after the tiles, as before; each keeps its
 * own condition, and none holds state. Order matters only as the DOM
 * order above, which is the block's.
 */
export function BoardOverlays({
  showSupport,
  hoveredSquare,
  supportPairs,
  hoverSupporters,
  arrowAnnotations,
  voteRound,
  guessCloud,
  checkVignette,
  captureStrobe,
  rotationDust,
  fxIntensity,
  irisKingPos,
  mateSeqActive,
  mateKingPos,
  mateSeq,
  myColor,
  displayTopology,
  layout,
  boardSize,
  tileBase,
}: BoardOverlaysProps) {
  return (
    <>
      {showSupport && (
        <svg
          className="support-overlay"
          width={boardSize}
          height={boardSize}
          style={{ pointerEvents: 'none' }}
        >
          <defs>
            <marker
              id="support-arrowhead"
              markerWidth="4"
              markerHeight="2.5"
              refX="3.5"
              refY="1.25"
              orient="auto"
            >
              <path
                d="M 0 0 L 3.5 1.25 L 0 2.5"
                fill="none"
                stroke="var(--support-stroke, var(--accent-teal-bright))"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </marker>
            <marker
              id="support-arrowhead-orange"
              markerWidth="4"
              markerHeight="2.5"
              refX="3.5"
              refY="1.25"
              orient="auto"
            >
              <path
                d="M 0 0 L 3.5 1.25 L 0 2.5"
                fill="none"
                stroke="var(--support-hover-stroke, var(--accent-orange))"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
          {supportPairs.map(([from, to], i) => {
            const fromCenter = tilePixelCenter(from, displayTopology, layout);
            const toCenter = tilePixelCenter(to, displayTopology, layout);
            const dx = toCenter.cx - fromCenter.cx;
            const dy = toCenter.cy - fromCenter.cy;
            const dist = Math.hypot(dx, dy) || 1;
            const inset = tileBase * 0.4;
            const endX = toCenter.cx - (dx / dist) * inset;
            const endY = toCenter.cy - (dy / dist) * inset;
            return (
              <line
                key={`${from}-${to}-${i}`}
                x1={fromCenter.cx}
                y1={fromCenter.cy}
                x2={endX}
                y2={endY}
                className="support-arrow"
                markerEnd="url(#support-arrowhead)"
              />
            );
          })}
          {hoveredSquare && hoverSupporters.map((fromSq) => {
            const toSq = hoveredSquare as SquareId;
            const fromCenter = tilePixelCenter(fromSq, displayTopology, layout);
            const toCenter = tilePixelCenter(toSq, displayTopology, layout);
            const dx = toCenter.cx - fromCenter.cx;
            const dy = toCenter.cy - fromCenter.cy;
            const dist = Math.hypot(dx, dy) || 1;
            const inset = tileBase * 0.4;
            const endX = toCenter.cx - (dx / dist) * inset;
            const endY = toCenter.cy - (dy / dist) * inset;
            return (
              <line
                key={`hover-${fromSq}-${toSq}`}
                x1={fromCenter.cx}
                y1={fromCenter.cy}
                x2={endX}
                y2={endY}
                className="support-arrow support-arrow-hover"
                markerEnd="url(#support-arrowhead-orange)"
              />
            );
          })}
        </svg>
      )}
      {arrowAnnotations.length > 0 && (
        <svg
          className="annotation-overlay"
          width={boardSize}
          height={boardSize}
          viewBox={`0 0 ${boardSize} ${boardSize}`}
          aria-hidden
        >
          <defs>
            {(['green', 'red', 'yellow', 'blue'] as const).map((c) => (
              <marker
                key={c}
                id={`annotation-arrowhead-${c}`}
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="4"
                markerHeight="4"
                orient="auto"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className={`annotation-arrow-head annotation-color-${c}`}
                />
              </marker>
            ))}
          </defs>
          {arrowAnnotations.map((arrow, i) => {
            const annFlip = myColor === 'black';
            const fromC = tilePixelCenter(arrow.from, displayTopology, layout);
            const toC = tilePixelCenter(arrow.to, displayTopology, layout);
            const fromX = annFlip ? boardSize - fromC.cx : fromC.cx;
            const fromY = annFlip ? boardSize - fromC.cy : fromC.cy;
            const toX = annFlip ? boardSize - toC.cx : toC.cx;
            const toY = annFlip ? boardSize - toC.cy : toC.cy;
            // Pull the arrow tip in by ~30% of a tile so it doesn't
            // bury itself in the destination piece.
            const dx = toX - fromX;
            const dy = toY - fromY;
            const dist = Math.hypot(dx, dy) || 1;
            const inset = tileBase * 0.3;
            const endX = toX - (dx / dist) * inset;
            const endY = toY - (dy / dist) * inset;
            return (
              <line
                key={`${arrow.from}-${arrow.to}-${arrow.color}-${i}`}
                x1={fromX}
                y1={fromY}
                x2={endX}
                y2={endY}
                className={`annotation-arrow annotation-color-${arrow.color}`}
                markerEnd={`url(#annotation-arrowhead-${arrow.color})`}
              />
            );
          })}
        </svg>
      )}
      {voteRound && (() => {
        // R1 — variant arrows: the live vote round on the board. Slate
        // rounds (predict / vs-streamer) keep candidate order — the color
        // IS the ballot slot (!1 green, !2 red, !3 yellow, !4 blue), so
        // arrows must not reshuffle as counts change. Freeform rounds
        // (chat-vs-bot) have an unbounded slate — show the top 4 by
        // votes, labelled with the count instead of a slot number.
        const VARIANT_COLORS = ['green', 'red', 'yellow', 'blue'] as const;
        const withIdx = voteRound.candidates
          .map((c, idx) => ({ c, idx, count: voteRound.counts[idx] ?? 0 }))
          .filter((x) => x.c.move.from && x.c.move.to);
        const shown = voteRound.freeform
          ? [...withIdx].sort((a, b) => b.count - a.count || a.idx - b.idx).slice(0, 4)
          : withIdx.slice(0, 4);
        if (shown.length === 0) return null;
        const maxCount = Math.max(1, ...shown.map((x) => x.count));
        const revealed = voteRound.revealIdx !== null;
        return (
          <svg
            className="variant-overlay"
            width={boardSize}
            height={boardSize}
            viewBox={`0 0 ${boardSize} ${boardSize}`}
            aria-hidden
          >
            <defs>
              {VARIANT_COLORS.map((c) => (
                <marker
                  key={c}
                  id={`variant-arrowhead-${c}`}
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="3.2"
                  markerHeight="3.2"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className={`annotation-color-${c}`} />
                </marker>
              ))}
            </defs>
            {shown.map(({ c, idx, count }, slot) => {
              const from = c.move.from as SquareId;
              const to = c.move.to as SquareId;
              const color = VARIANT_COLORS[voteRound.freeform ? slot : idx];
              const fromC = tilePixelCenter(from, displayTopology, layout);
              const toC = tilePixelCenter(to, displayTopology, layout);
              const dx = toC.cx - fromC.cx;
              const dy = toC.cy - fromC.cy;
              const dist = Math.hypot(dx, dy) || 1;
              const inset = tileBase * 0.32;
              const endX = toC.cx - (dx / dist) * inset;
              const endY = toC.cy - (dy / dist) * inset;
              // Vote share drives the stroke: even a losing option stays
              // readable, the leader visibly bulks up.
              const width = tileBase * (0.09 + 0.1 * (count / maxCount));
              const isWinner = revealed && voteRound.revealIdx === idx;
              const cls = revealed
                ? isWinner
                  ? 'variant-arrow variant-arrow-winner'
                  : 'variant-arrow variant-arrow-loser'
                : 'variant-arrow';
              // Label sits a third of the way along the arrow, nudged
              // perpendicular so it doesn't ride the line itself.
              const lx = fromC.cx + dx * 0.33 - (dy / dist) * tileBase * 0.28;
              const ly = fromC.cy + dy * 0.33 + (dx / dist) * tileBase * 0.28;
              const label = voteRound.freeform ? `×${count}` : `!${idx + 1}`;
              return (
                <g key={`${from}-${to}-${idx}`}>
                  <line
                    x1={fromC.cx}
                    y1={fromC.cy}
                    x2={endX}
                    y2={endY}
                    className={`${cls} annotation-color-${color}`}
                    style={
                      {
                        strokeWidth: width,
                        strokeDasharray: isWinner
                          ? 'none'
                          : `${tileBase * 0.22} ${tileBase * 0.16}`,
                        // R9 — the march animation must shift by EXACTLY
                        // one dash+gap cycle or the loop restart jumps.
                        '--dash-cycle': `${tileBase * 0.38}px`,
                      } as React.CSSProperties
                    }
                    markerEnd={`url(#variant-arrowhead-${color})`}
                  />
                  <text
                    x={lx}
                    y={ly}
                    className={`variant-arrow-label annotation-color-${color}`}
                    style={{ fontSize: tileBase * 0.3 }}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        );
      })()}
      {checkVignette && (
        <div
          className="check-vignette"
          style={{ '--fx-intensity': fxIntensity } as React.CSSProperties}
          aria-hidden
        />
      )}
      {captureStrobe && (
        <div
          className={`capture-strobe is-${captureStrobe}`}
          style={{ '--fx-intensity': fxIntensity } as React.CSSProperties}
          aria-hidden
        />
      )}
      {rotationDust && <div className="rotation-dust" aria-hidden />}
      {irisKingPos && mateSeqActive && (
        <div
          className="checkmate-iris"
          style={{
            '--iris-cx': `${irisKingPos.cx}px`,
            '--iris-cy': `${irisKingPos.cy}px`,
          } as React.CSSProperties}
          aria-hidden
        />
      )}
      {mateKingPos && mateSeq === 'shatter' && (
        <div
          className="checkmate-shatter"
          style={{ left: `${mateKingPos.cx}px`, top: `${mateKingPos.cy}px` } as React.CSSProperties}
          aria-hidden
        />
      )}
      {guessCloud.length > 0 && (
        <div className="guess-cloud" aria-live="polite">
          {guessCloud.map((n) => (
            <span
              key={n.key}
              className="guess-cloud-nick"
              style={
                {
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  fontSize: `${n.size}rem`,
                  animationDelay: `${n.delay}ms`,
                  '--nick-rot': `${n.rot}deg`,
                  ...(n.color ? { color: n.color } : null),
                } as React.CSSProperties
              }
            >
              {n.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
