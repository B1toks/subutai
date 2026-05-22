/**
 * Sprint 4.3 — Showcase mode (`?showcase=1`).
 *
 * A self-contained kiosk view: continuous AI vs AI play, with a 10-second
 * leaderboard interrupt every time a new user is created in Firestore.
 * Use cases: stream-TV display, public kiosk, marketing demo.
 *
 * Intentionally separate from the existing `?auto=1` data-collection mode
 * — that one is headless and burns positions to /training_games; showcase
 * is a read-only consumer of public data with a visible 1.5s ply cadence
 * so audience members can follow the game.
 */
import '../App.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { fetchLeaderboardPage, type LeaderboardEntry } from '../firebase/leaderboard';
import { createStartingPosition } from '../engine';
import type { BoardState, Color, PieceType, SquareId } from '../engine/types';
import {
  applyMove,
  checkDrawConditions,
  generateLegalMoves,
  isInCheck,
} from '../engine/moves';
import { SubutaiAgent } from '../ai/agents';
import { evaluate } from '../ai/evaluate';

type ShowcaseScreen = 'autoplay' | 'leaderboard';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const MOVE_INTERVAL_MS = 1500;
const POST_GAME_DELAY_MS = 3000;
const LEADERBOARD_HOLD_MS = 10_000;

const GLYPH: Record<PieceType, string> = {
  pawn: '♟︎',
  knight: '♞',
  bishop: '♝',
  rook: '♜',
  queen: '♛',
  king: '♚',
};

export function ShowcaseView() {
  const [currentScreen, setCurrentScreen] = useState<ShowcaseScreen>('autoplay');
  const [highlightedUser, setHighlightedUser] = useState<string | null>(null);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let initialSnapshotProcessed = false;
    const usersRef = collection(db, 'users');
    const recentQuery = query(usersRef, orderBy('createdAt', 'desc'), limit(5));

    const unsub = onSnapshot(
      recentQuery,
      (snapshot) => {
        if (!initialSnapshotProcessed) {
          initialSnapshotProcessed = true;
          return;
        }
        for (const change of snapshot.docChanges()) {
          if (change.type !== 'added') continue;
          const data = change.doc.data() as { displayName?: string };
          const name = (data.displayName ?? '').trim() || 'New player';
          setHighlightedUser(name);
          setCurrentScreen('leaderboard');
          if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
          returnTimerRef.current = setTimeout(() => {
            setCurrentScreen('autoplay');
            setHighlightedUser(null);
          }, LEADERBOARD_HOLD_MS);
          break;
        }
      },
      (err) => {
        // Fallback per spec: if Firestore isn't reachable, the showcase
        // just runs continuous autoplay and never interrupts. Log once
        // for ops visibility but don't crash the kiosk.
        console.warn('[showcase] new-user listener failed', err);
      },
    );

    return () => {
      unsub();
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    };
  }, []);

  return (
    <div className="showcase-view" data-theme="wood">
      {currentScreen === 'autoplay' ? (
        <ShowcaseAutoPlay />
      ) : (
        <ShowcaseLeaderboard highlightedUser={highlightedUser} />
      )}
    </div>
  );
}

interface AutoplayState {
  state: BoardState;
  moveCount: number;
  evalCp: number;
  lastMove: { from?: SquareId; to?: SquareId } | null;
  banner: string | null;
}

function freshAutoplayState(): AutoplayState {
  const seed = Math.floor(Math.random() * 0xfffff);
  const state = createStartingPosition(seed);
  return {
    state,
    moveCount: 0,
    evalCp: 0,
    lastMove: null,
    banner: null,
  };
}

function ShowcaseAutoPlay() {
  const [snapshot, setSnapshot] = useState<AutoplayState>(freshAutoplayState);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(fn: () => void, delay: number) {
      timer = setTimeout(fn, delay);
    }

    async function step() {
      if (cancelled) return;
      const current = snapshotRef.current;
      const s = current.state;
      const legalMoves = generateLegalMoves(s);

      if (legalMoves.length === 0) {
        // No legal moves — checkmate or stalemate. Banner reflects which
        // (in-check at zero legal moves ⇒ mate; otherwise stalemate).
        const banner = isInCheck(s)
          ? `Checkmate · ${s.sideToMove === 'white' ? 'Black' : 'White'} wins`
          : 'Stalemate · new game';
        setSnapshot({ ...current, banner });
        schedule(() => {
          if (cancelled) return;
          setSnapshot(freshAutoplayState());
          schedule(step, MOVE_INTERVAL_MS);
        }, POST_GAME_DELAY_MS);
        return;
      }

      const drawReason = checkDrawConditions(s, s.lastMoveWasRotation);
      if (drawReason) {
        setSnapshot({ ...current, banner: `Draw · ${drawReason.replace(/_/g, ' ')}` });
        schedule(() => {
          if (cancelled) return;
          setSnapshot(freshAutoplayState());
          schedule(step, MOVE_INTERVAL_MS);
        }, POST_GAME_DELAY_MS);
        return;
      }

      try {
        const move = await SubutaiAgent.chooseMove(s, legalMoves, {
          lastMoveWasRotation: s.lastMoveWasRotation,
        });
        if (cancelled || !move) {
          // Engine gave up — bounce to a fresh game.
          schedule(() => {
            if (cancelled) return;
            setSnapshot(freshAutoplayState());
            schedule(step, MOVE_INTERVAL_MS);
          }, POST_GAME_DELAY_MS);
          return;
        }
        const next = applyMove(s, move);
        const cp = evaluate(next);
        setSnapshot({
          state: next,
          moveCount: current.moveCount + 1,
          evalCp: cp,
          lastMove: { from: move.from, to: move.to },
          banner: null,
        });
        // The 1.5s pause is what makes the showcase legible — search
        // budget above already returns in <500ms so the gap is mostly
        // dwell time on the rendered move.
        schedule(step, MOVE_INTERVAL_MS);
      } catch (err) {
        console.warn('[showcase] move loop error', err);
        schedule(step, MOVE_INTERVAL_MS);
      }
    }

    // Kick off after a short delay so the initial board has a beat
    // before the first ply slides in.
    schedule(step, 800);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Empty dep — the loop is self-driving via stateRef. Re-running the
    // effect on every snapshot change would create duplicate timers.
  }, []);

  const { state, moveCount, evalCp, lastMove, banner } = snapshot;
  const evalDisplay = formatEval(evalCp, state.sideToMove);
  const moveLabel = Math.floor(moveCount / 2) + (moveCount % 2 === 1 ? '½' : '');

  return (
    <div className="showcase-autoplay">
      <div className="showcase-header">
        <h1 className="showcase-title">subutai</h1>
        <span className="showcase-tagline">AI vs AI · Live</span>
      </div>

      <div className="showcase-board-wrap">
        <ShowcaseBoard state={state} lastMove={lastMove} />
        {banner && <div className="showcase-banner">{banner}</div>}
      </div>

      <div className="showcase-stats">
        <div className="showcase-stat">
          <span className="showcase-stat-label">Move</span>
          <span className="showcase-stat-value">{moveLabel || '0'}</span>
        </div>
        <div className="showcase-stat">
          <span className="showcase-stat-label">Eval</span>
          <span className="showcase-stat-value">{evalDisplay}</span>
        </div>
        <div className="showcase-stat">
          <span className="showcase-stat-label">Topology</span>
          <span className="showcase-stat-value">{state.topologyState}</span>
        </div>
        <div className="showcase-stat">
          <span className="showcase-stat-label">Turn</span>
          <span className="showcase-stat-value">
            {state.sideToMove === 'white' ? 'White' : 'Black'}
          </span>
        </div>
      </div>
    </div>
  );
}

interface BoardProps {
  state: BoardState;
  lastMove: { from?: SquareId; to?: SquareId } | null;
}

function ShowcaseBoard({ state, lastMove }: BoardProps) {
  return (
    <div className="showcase-board">
      {RANKS.map((rank) => (
        <div key={rank} className="showcase-board-row">
          {FILES.map((file) => {
            const sq = `${file}${rank}` as SquareId;
            const piece = state.pieces[sq];
            const fileIdx = file.charCodeAt(0) - 'a'.charCodeAt(0);
            const isDark = (fileIdx + rank) % 2 === 0;
            const isLastFrom = lastMove?.from === sq;
            const isLastTo = lastMove?.to === sq;
            return (
              <div
                key={sq}
                className={[
                  'showcase-tile',
                  isDark ? 'dark' : 'light',
                  isLastFrom ? 'last-from' : '',
                  isLastTo ? 'last-to' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {piece && (
                  <span className={`showcase-piece showcase-piece-${piece.color}`}>
                    {GLYPH[piece.type]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface LeaderboardProps {
  highlightedUser: string | null;
}

function ShowcaseLeaderboard({ highlightedUser }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboardPage()
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries.slice(0, 10));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[showcase] leaderboard fetch failed', err);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The highlighted player may not be in the top 10 — surface them at the
  // bottom of the list with a "joined" badge so the audience always sees
  // why the screen flipped, even for a brand-new (0-points) account.
  const displayedEntries = useMemo(() => {
    if (!entries) return null;
    if (!highlightedUser) return entries;
    const alreadyListed = entries.some((e) => e.displayName === highlightedUser);
    if (alreadyListed) return entries;
    const ghost: LeaderboardEntry = {
      uid: `__ghost-${highlightedUser}`,
      displayName: highlightedUser,
      bestGamePoints: 0,
      gamesPlayed: 0,
      longestSurvivalMoves: 0,
    };
    return [...entries, ghost];
  }, [entries, highlightedUser]);

  return (
    <div className="showcase-leaderboard">
      <div className="showcase-leaderboard-header">
        <h1 className="showcase-leaderboard-title">
          {highlightedUser ? (
            <>
              <span className="highlight-badge" aria-hidden>★</span>
              <span className="highlight-name">{highlightedUser}</span>
              <span className="highlight-suffix"> joined!</span>
            </>
          ) : (
            <>Top Players</>
          )}
        </h1>
      </div>

      <div className="showcase-leaderboard-list">
        {displayedEntries === null ? (
          <div className="showcase-leaderboard-loading">Loading leaderboard…</div>
        ) : displayedEntries.length === 0 ? (
          <div className="showcase-leaderboard-loading">No entries yet.</div>
        ) : (
          displayedEntries.map((entry, idx) => {
            const isNew = entry.displayName === highlightedUser;
            const isGhost = entry.uid.startsWith('__ghost-');
            return (
              <div
                key={entry.uid}
                className={[
                  'leaderboard-row-large',
                  isNew ? 'is-new-user' : '',
                  isGhost ? 'is-ghost' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="rank">{isGhost ? '—' : `#${idx + 1}`}</span>
                <span className="name">{entry.displayName}</span>
                <span className="score">
                  {isGhost ? 'just joined' : entry.bestGamePoints}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="showcase-countdown">Returning to live game…</div>
    </div>
  );
}

function formatEval(cp: number, sideToMove: Color): string {
  // `evaluate` returns centipawns from the SIDE-TO-MOVE perspective. Flip
  // when it's black so the displayed sign is always white-positive
  // (audience convention).
  const fromWhite = sideToMove === 'white' ? cp : -cp;
  const sign = fromWhite > 0 ? '+' : fromWhite < 0 ? '−' : '';
  const abs = Math.abs(fromWhite) / 100;
  if (abs >= 99) return fromWhite > 0 ? '+M' : '−M';
  return `${sign}${abs.toFixed(1)}`;
}
