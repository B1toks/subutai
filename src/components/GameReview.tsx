import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Link2 } from 'lucide-react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import type { GameLog } from '../recording/log';
import { analyzeGame, type GameReviewResult } from '../analysis/analyzeGame';
import type { MoveClass, MoveAnalysis } from '../analysis/classify';
import { QUALITY_BONUS, type GameOutcome } from '../analysis/points';
import { applyMove } from '../engine/moves';
import {
  applyRotationMove,
  computeBoardLayout,
  tilePixelCenter,
} from '../engine/auxetic';
import { allSquares } from '../engine/board';
import type { BoardState, Color, SquareId } from '../engine/types';

// Human is always white in v1 — same convention as App.tsx.
const HUMAN_COLOR: Color = 'white';

export interface GameReviewMeta {
  /** Display label for the player whose POV we're reviewing. */
  readonly playerName: string;
  /** "AI" for solo games, opponent's name for PvP, "Shared game" for ?game= URL loads. */
  readonly opponentName: string;
  readonly outcome?: GameOutcome;
}

interface Props {
  readonly log: GameLog;
  readonly onBack: () => void;
  /** Optional metadata for shared games / PvP review. Plain solo flow
   *  omits this and falls back to the existing "Game Review" title. */
  readonly meta?: GameReviewMeta;
  /** /games/{id} reference. When present, the header renders a Share
   *  button that copies a `?game=<id>` URL. */
  readonly gameId?: string | null;
}

const CLASS_MARKER: Record<MoveClass, string> = {
  best: '⭐',
  good: '',
  mistake: '?',
  blunder: '??',
  brilliant: '!!',
  checkmate: '#',
};

const CLASS_LABEL: Record<MoveClass, string> = {
  best: 'best',
  good: 'good',
  mistake: 'mistake',
  blunder: 'blunder',
  brilliant: 'brilliant',
  checkmate: 'checkmate',
};

function shortMoveText(entry: GameLog['moves'][number]): string {
  const move = entry.move;
  if (move.kind === 'topologyToggle') {
    const from = entry.topology ?? 'A';
    return `${from}→${from === 'A' ? 'B' : 'A'}`;
  }
  if (move.kind === 'castle') {
    return move.to && move.to[0] === 'c' ? 'O-O-O' : 'O-O';
  }
  if (move.from && move.to) {
    let san = `${move.from}→${move.to}`;
    if (move.kind === 'promotion' && move.promotion) {
      san += `=${move.promotion[0].toUpperCase()}`;
    }
    return san;
  }
  return entry.san ?? '?';
}

/** V1 — which log entries were the human's own actions. Replays the log
 *  properly (rotations flip the side too), so roulette's 2-actions-per-turn
 *  economy is handled instead of assuming even = human. */
function humanTurnMask(log: GameLog): boolean[] {
  let state: BoardState = log.initialState;
  const mask: boolean[] = [];
  for (const entry of log.moves) {
    mask.push(state.sideToMove === HUMAN_COLOR);
    if (entry.move.kind === 'topologyToggle') {
      state = applyRotationMove(state);
    } else if (entry.move.from && entry.move.to) {
      state = applyMove(state, entry.move);
    }
  }
  return mask;
}

interface TurningPoint {
  idx: number;
  cpl: number;
  /** The move allowed a forced mate (classic) or hung the king (roulette):
   *  the classifier reports a mate-scale loss there, which reads as a
   *  nonsense number, so the card says what happened instead. */
  decisive: boolean;
  san: string;
  better: string | null;
  /** The human rotated on their previous action and blundered right after. */
  afterOwnRotation: boolean;
}

/** Mate-scale losses (search returns ~100000 for a lost king) would swamp
 *  any average; cap a single move's loss at a queen and a half. */
const CPL_CAP = 1200;
const MATE_SCALE_CPL = 50_000;

/** V1 (data plan §5.1/5.2) — the human move that cost the most. R15 data:
 *  25% of first blunders come straight after the player's OWN rotation,
 *  so that case gets called out explicitly. */
function findTurningPoint(
  log: GameLog,
  analyses: readonly MoveAnalysis[],
  human: readonly boolean[],
): TurningPoint | null {
  let best: TurningPoint | null = null;
  for (let i = 0; i < log.moves.length; i++) {
    const a = analyses[i];
    if (!human[i] || !a || log.moves[i].move.kind === 'topologyToggle') continue;
    if (a.classification === 'brilliant' || a.classification === 'checkmate') continue;
    if (a.cpl < 100) continue;
    if (best && a.cpl <= best.cpl) continue;
    let prevHuman = i - 1;
    while (prevHuman >= 0 && !human[prevHuman]) prevHuman--;
    best = {
      idx: i,
      cpl: Math.round(a.cpl),
      decisive: a.cpl >= MATE_SCALE_CPL,
      san: shortMoveText(log.moves[i]),
      better: a.bestMoveSan ?? a.bestPvSan?.[0] ?? null,
      afterOwnRotation:
        prevHuman >= 0 && log.moves[prevHuman].move.kind === 'topologyToggle',
    };
  }
  return best;
}

interface PhaseRow {
  label: string;
  avgCpl: number | null;
  moves: number;
}

/** V1 (data plan §5.4) — average human CPL by game phase. The R15 corpus
 *  says the opening (moves 1-10) is where people lose games; showing the
 *  split makes that visible per game. */
function phaseReport(
  log: GameLog,
  analyses: readonly MoveAnalysis[],
  human: readonly boolean[],
): PhaseRow[] {
  const buckets = [
    { label: 'Moves 1-10', lo: 1, hi: 10, sum: 0, n: 0 },
    { label: 'Moves 11-20', lo: 11, hi: 20, sum: 0, n: 0 },
    { label: 'Moves 21+', lo: 21, hi: Infinity, sum: 0, n: 0 },
  ];
  let fullMove = 0;
  for (let i = 0; i < log.moves.length; i++) {
    if (human[i]) fullMove++;
    const a = analyses[i];
    if (!human[i] || !a || log.moves[i].move.kind === 'topologyToggle') continue;
    if (a.classification === 'brilliant' || a.classification === 'checkmate') continue;
    const b = buckets.find((bk) => fullMove >= bk.lo && fullMove <= bk.hi);
    if (b) {
      b.sum += Math.min(CPL_CAP, a.cpl);
      b.n++;
    }
  }
  return buckets.map((b) => ({
    label: b.label,
    avgCpl: b.n ? Math.round(b.sum / b.n) : null,
    moves: b.n,
  }));
}

function humanQualityBonus(
  log: GameLog,
  analyses: readonly MoveAnalysis[],
): number {
  let state: BoardState = log.initialState;
  let bonus = 0;
  for (let i = 0; i < log.moves.length; i++) {
    const entry = log.moves[i];
    const a = analyses[i];
    if (state.sideToMove === HUMAN_COLOR && a) {
      bonus += QUALITY_BONUS[a.classification] ?? 0;
    }
    if (entry.move.kind === 'topologyToggle') {
      state = applyRotationMove(state);
    } else {
      state = applyMove(state, entry.move);
    }
  }
  return bonus;
}

/** Replay the first `n` log entries on top of initialState. Used by the
 *  step-through to project an arbitrary half-move snapshot. */
function rebuildBoardAt(log: GameLog, n: number): BoardState {
  let state: BoardState = log.initialState;
  const cap = Math.min(Math.max(0, n), log.moves.length);
  for (let i = 0; i < cap; i++) {
    const entry = log.moves[i];
    if (entry.move.kind === 'topologyToggle') {
      state = applyRotationMove(state);
    } else if (entry.move.from && entry.move.to) {
      state = applyMove(state, entry.move);
    }
  }
  return state;
}

const PIECE_GLYPH: Record<string, string> = {
  pawn: '♟︎',
  knight: '♞',
  bishop: '♝',
  rook: '♜',
  queen: '♛',
  king: '♚',
};

/** Read-only board snapshot for the Review screen. Reuses the same
 *  .board / .tile / .piece classes as App.tsx and routes tile positions
 *  through tilePixelCenter, so topology B (auxetic rotation) renders the
 *  same way it did during live play. Stage T3. T6: responsive size. */
function ReviewBoard({
  state,
  lastFrom,
  lastTo,
  boardSize,
}: {
  state: BoardState;
  lastFrom: SquareId | null;
  lastTo: SquareId | null;
  boardSize: number;
}) {
  const layout = useMemo(
    () => computeBoardLayout(state.topologyState, boardSize),
    [state.topologyState, boardSize],
  );
  const tileBase = boardSize / 8;
  const scale = layout.tileSize / tileBase;
  return (
    <div
      className="board"
      style={
        {
          width: boardSize,
          height: boardSize,
          // T4: .piece font-size is calc(var(--board-size) / 9). Without
          // an ancestor that defines the var, glyphs collapse to inherited
          // body-text size and the pieces look like tiny dark dots.
          '--board-size': `${boardSize}px`,
        } as React.CSSProperties
      }
    >
      {allSquares.map((sq) => {
        const piece = state.pieces[sq];
        const isDark =
          ((sq.charCodeAt(0) - 'a'.charCodeAt(0)) + (Number(sq[1]) - 1)) %
            2 ===
          1;
        const { cx, cy, angle } = tilePixelCenter(
          sq,
          state.topologyState,
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
              lastFrom === sq ? 'last-from' : '',
              lastTo === sq ? 'last-to' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              width: tileBase,
              height: tileBase,
              transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
              pointerEvents: 'none',
            }}
          >
            {piece && (
              <span
                className={`piece piece-${piece.color}`}
                style={angle ? { transform: `rotate(${-angle}deg)` } : undefined}
              >
                {PIECE_GLYPH[piece.type] ?? ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GameReview({ log, onBack, meta, gameId }: Props) {
  const toast = useToast();
  const [shareCopied, setShareCopied] = useState(false);
  function handleShare() {
    if (!gameId) return;
    const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
        toast.show('Share link copied to clipboard', 'success');
      })
      .catch(() => {
        toast.show('Could not copy link. Try again', 'error');
      });
  }

  const [result, setResult] = useState<GameReviewResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: log.moves.length,
  });
  // 0 = initial position; N = after Nth move. Starts at end so the player
  // sees the final position on entry (matches the AI-game "Review" CTA).
  const [reviewIdx, setReviewIdx] = useState<number>(log.moves.length);
  const moveListRef = useRef<HTMLOListElement | null>(null);
  // T6: responsive review board. Caps at 560px so the side panel keeps
  // breathing room on wide screens; on mobile the layout stacks and
  // the board uses up to (viewport - 32px).
  const [boardSize, setBoardSize] = useState(() =>
    Math.min(window.innerWidth - 32, 560),
  );
  useEffect(() => {
    function onResize() {
      setBoardSize(Math.min(window.innerWidth - 32, 560));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const qualityBonus = useMemo(
    () => (result ? humanQualityBonus(log, result.moves) : 0),
    [log, result],
  );
  const humanMask = useMemo(() => humanTurnMask(log), [log]);
  const turningPoint = useMemo(
    () => (result ? findTurningPoint(log, result.moves, humanMask) : null),
    [log, result, humanMask],
  );
  const phases = useMemo(
    () => (result ? phaseReport(log, result.moves, humanMask) : []),
    [log, result, humanMask],
  );

  const boardSnapshot = useMemo(
    () => rebuildBoardAt(log, reviewIdx),
    [log, reviewIdx],
  );

  // Highlight the move that LANDED us at reviewIdx (i.e. log.moves[reviewIdx-1]).
  const lastMoveForIdx = useMemo(() => {
    if (reviewIdx === 0) return { from: null as SquareId | null, to: null as SquareId | null };
    const entry = log.moves[reviewIdx - 1];
    if (!entry || entry.move.kind === 'topologyToggle') {
      return { from: null, to: null };
    }
    return {
      from: (entry.move.from as SquareId | undefined) ?? null,
      to: (entry.move.to as SquareId | undefined) ?? null,
    };
  }, [log, reviewIdx]);

  // Reset to end whenever a different log loads (e.g. switching shared games).
  useEffect(() => {
    setReviewIdx(log.moves.length);
  }, [log]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setProgress({ done: 0, total: log.moves.length });
    analyzeGame(log, {
      onProgress: (done, total) => {
        if (!cancelled) setProgress({ done, total });
      },
    }).then((out) => {
      if (cancelled) return;
      setResult(out);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [log]);

  // Keyboard navigation: arrow keys + Home/End. Ignored when typing in
  // an input — the review screen doesn't have any, but defensive.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        setReviewIdx((i) => Math.max(0, i - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        setReviewIdx((i) => Math.min(log.moves.length, i + 1));
        e.preventDefault();
      } else if (e.key === 'Home') {
        setReviewIdx(0);
        e.preventDefault();
      } else if (e.key === 'End') {
        setReviewIdx(log.moves.length);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log.moves.length]);

  // Scroll the active move into view when reviewIdx changes.
  useEffect(() => {
    if (!moveListRef.current) return;
    const el = moveListRef.current.querySelector<HTMLElement>('.review-row.is-current');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [reviewIdx]);

  const title = meta
    ? `${meta.playerName} vs ${meta.opponentName}`
    : 'Game Review';

  return (
    <div className="game-review">
      <header className="game-review-header">
        <button type="button" className="game-review-back" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" aria-hidden /> Back
        </button>
        <h2>
          {title}
          <span className="beta-tag-inline">BETA</span>
        </h2>
        {gameId ? (
          <button
            type="button"
            className="game-review-share"
            onClick={handleShare}
            title="Copy share link"
          >
            {shareCopied ? (
              <>
                <Icon icon={Check} size="sm" aria-hidden /> Copied
              </>
            ) : (
              <>
                <Icon icon={Link2} size="sm" aria-hidden /> Share
              </>
            )}
          </button>
        ) : (
          <span className="game-review-header-spacer" />
        )}
      </header>

      {meta?.outcome && (
        <p className="game-review-meta-line">
          {meta.outcome === 'human-win'
            ? `${meta.playerName} won.`
            : meta.outcome === 'ai-win'
              ? `${meta.playerName} lost.`
              : meta.outcome === 'draw'
                ? 'Match drawn.'
                : `${meta.playerName} resigned.`}
        </p>
      )}

      <div className="game-review-layout">
        <div className="game-review-board-pane">
          <ReviewBoard
            state={boardSnapshot}
            lastFrom={lastMoveForIdx.from}
            lastTo={lastMoveForIdx.to}
            boardSize={boardSize}
          />
          <div className="game-review-controls">
            <button
              type="button"
              className="game-review-nav"
              onClick={() => setReviewIdx(0)}
              disabled={reviewIdx === 0}
              title="Start (Home)"
            >
              «
            </button>
            <button
              type="button"
              className="game-review-nav"
              onClick={() => setReviewIdx((i) => Math.max(0, i - 1))}
              disabled={reviewIdx === 0}
              title="Previous (←)"
            >
              ‹
            </button>
            <span className="game-review-pos">
              {reviewIdx} / {log.moves.length}
            </span>
            <button
              type="button"
              className="game-review-nav"
              onClick={() =>
                setReviewIdx((i) => Math.min(log.moves.length, i + 1))
              }
              disabled={reviewIdx === log.moves.length}
              title="Next (→)"
            >
              ›
            </button>
            <button
              type="button"
              className="game-review-nav"
              onClick={() => setReviewIdx(log.moves.length)}
              disabled={reviewIdx === log.moves.length}
              title="End (End)"
            >
              »
            </button>
          </div>
        </div>

        <div className="game-review-side">
          {loading && (
            <div className="game-review-loading">
              <div className="spinner" />
              <span>
                Analyzing {progress.done}/{progress.total} moves…
              </span>
            </div>
          )}

          {/* V1 — the one move that decided the game, click to jump to it. */}
          {result && turningPoint && (
            <button
              type="button"
              className={`review-turning${turningPoint.idx + 1 === reviewIdx ? ' is-current' : ''}`}
              onClick={() => setReviewIdx(turningPoint.idx + 1)}
              title="Jump to this position"
            >
              <span className="review-turning-kicker">Turning point</span>
              <span className="review-turning-line">
                Move {Math.floor(turningPoint.idx / 2) + 1}: <strong>{turningPoint.san}</strong>{' '}
                {turningPoint.decisive
                  ? log.gameMode === 'roulette'
                    ? 'left the king to be captured'
                    : 'allowed a forced mate'
                  : `cost ${turningPoint.cpl} cp`}
                {turningPoint.better ? (
                  <>
                    . Better: <strong>{turningPoint.better}</strong>
                  </>
                ) : null}
              </span>
              {turningPoint.afterOwnRotation && (
                <span className="review-turning-note">
                  Right after your own rotation. 1 in 4 first blunders happen exactly here:
                  re-check every piece after you twist the board.
                </span>
              )}
            </button>
          )}
          {result && !turningPoint && (
            <div className="review-turning review-turning-clean">
              <span className="review-turning-kicker">No turning point</span>
              <span className="review-turning-line">
                No move lost 100 cp or more. Clean game.
              </span>
            </div>
          )}

          {result && (
            <div className="game-review-stats">
              <Stat
                label="Accuracy"
                value={`${result.stats.accuracy}%`}
                tone={
                  result.stats.accuracy >= 85
                    ? 'best'
                    : result.stats.accuracy >= 60
                      ? 'neutral'
                      : 'mistake'
                }
              />
              <Stat
                label="Brilliants"
                value={result.stats.brilliants}
                tone="brilliant"
              />
              <Stat label="Best" value={result.stats.bestCount} tone="best" />
              <Stat
                label="Mistakes"
                value={result.stats.mistakes}
                tone="mistake"
              />
              <Stat
                label="Blunders"
                value={result.stats.blunders}
                tone="blunder"
              />
              <Stat
                label="Avg. CPL"
                value={result.stats.averageCpl}
                tone="neutral"
              />
              {qualityBonus > 0 && (
                <Stat
                  label="Quality bonus"
                  value={qualityBonus}
                  tone="best"
                  prefix="+"
                />
              )}
            </div>
          )}

          {/* V1 — your average loss per phase. Bars scale to 300 cp. */}
          {result && phases.some((p) => p.avgCpl !== null) && (
            <div className="review-phases" aria-label="Accuracy by phase">
              <div className="review-phases-title">Your average loss by phase</div>
              {phases.map((p) => (
                <div key={p.label} className="review-phase-row">
                  <span className="review-phase-label">{p.label}</span>
                  <span className="review-phase-bar" aria-hidden>
                    <span
                      className={`review-phase-fill${
                        p.avgCpl === null
                          ? ''
                          : p.avgCpl >= 150
                            ? ' is-bad'
                            : p.avgCpl >= 60
                              ? ' is-mid'
                              : ' is-good'
                      }`}
                      style={{ width: `${p.avgCpl === null ? 0 : Math.min(100, (p.avgCpl / 300) * 100)}%` }}
                    />
                  </span>
                  <span className="review-phase-value">
                    {p.avgCpl === null ? 'no moves' : `${p.avgCpl} cp`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <ol className="game-review-list" ref={moveListRef}>
            {log.moves.map((entry, idx) => {
              const a = result?.moves[idx];
              const cls = a?.classification;
              const moveNum = Math.floor(idx / 2) + 1;
              const side = idx % 2 === 0 ? 'White' : 'Black';
              const showCpl = a && (cls === 'blunder' || cls === 'mistake');
              const showBetter =
                a && cls === 'blunder' && (a.bestPvSan || a.bestMoveSan);
              const betterText = showBetter
                ? (a.bestMoveSan ?? a.bestPvSan?.[0] ?? null)
                : null;
              const isCurrent = idx + 1 === reviewIdx;
              return (
                <li
                  key={idx}
                  className={[
                    'review-row',
                    cls ? `review-row-${cls}` : '',
                    isCurrent ? 'is-current' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setReviewIdx(idx + 1)}
                >
                  <span className="review-num">
                    {moveNum}.{side === 'Black' && '..'}
                  </span>
                  <span className="review-san">{shortMoveText(entry)}</span>
                  {cls && (
                    <>
                      <span className="review-marker">{CLASS_MARKER[cls]}</span>
                      <span className="review-label">{CLASS_LABEL[cls]}</span>
                    </>
                  )}
                  {showCpl && a && (
                    <span className="review-cpl">
                      (−{Math.round(a.cpl)} cp)
                    </span>
                  )}
                  {betterText && (
                    <span className="review-better">
                      ← Better: {betterText}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  prefix,
}: {
  label: string;
  value: number | string;
  tone: 'brilliant' | 'best' | 'mistake' | 'blunder' | 'neutral';
  prefix?: string;
}) {
  return (
    <div className={`review-stat review-stat-${tone}`}>
      <div className="review-stat-value">
        {prefix}
        {value}
      </div>
      <div className="review-stat-label">{label}</div>
    </div>
  );
}
