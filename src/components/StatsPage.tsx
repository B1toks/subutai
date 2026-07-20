import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Icon } from './Icon';
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { ensureSignedIn } from '../firebase/auth';

interface Stats {
  totalGames: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  avgMoveCount: number;
  avgFinalEval: number;
  scoredMoves: number;
  totalMovesInSample: number;
  /** Average wall-clock seconds across sample games that have durationMs.
   *  Older games written before Stage P addendum 7 are excluded so we don't
   *  drag the average toward zero. null when nothing in the sample qualifies. */
  avgDurationSec: number | null;
  oldestGame: Date | null;
  newestGame: Date | null;
  loading: boolean;
  error: string | null;
}

const SAMPLE_SIZE = 500;
const REFRESH_MS = 30_000;

/** R15 step 2 — public player-facing stats over /games (human vs AI runs).
 *  The collection is world-readable and small (hundreds of docs); we read it
 *  whole and aggregate client-side. Buckets use points.moveCount = full moves. */
interface HumanStats {
  total: number;
  players: number;
  wins: number;
  survive50: number;
  longestMoves: number;
  fastestWinMoves: number | null;
  /** funnel buckets 1-10 / 11-20 / ... / 50+ -> [wins, losses+resigns] */
  funnel: Array<{ label: string; win: number; loss: number }>;
}

interface GameDocLike {
  outcome?: string;
  moveCount?: number;
  playerId?: string;
  /** false on PvP records (each peer saves one) — excluded from the
   *  vs-bot marketing numbers so they don't double-count matches. */
  vsAI?: boolean;
}

const FUNNEL_LABELS = ['1-10', '11-20', '21-30', '31-40', '41-50', '50+'];

/** R15 T3: share of human wins that passed through <= -2.5 pawns at some
 *  point. Firestore stores no move evals (stripped on save), so this can't
 *  be computed client-side — the number comes from the offline labelling run
 *  over solo games (docs/R15-DATA-FINDINGS.md §4, 24 of 34 wins after the
 *  2026-07-20 PvP decontamination). Refresh it whenever the offline
 *  pipeline is rerun (scripts/report-r15.mjs). */
const COMEBACK_WIN_PCT = 71;
const COMEBACK_MEASURED_AT = 'Jul 2026';

async function loadHumanStats(): Promise<HumanStats> {
  const snap = await getDocs(collection(db, 'games'));
  const players = new Set<string>();
  let wins = 0;
  let survive50 = 0;
  let longestMoves = 0;
  let fastestWinMoves: number | null = null;
  const funnel = FUNNEL_LABELS.map((label) => ({ label, win: 0, loss: 0 }));

  let total = 0;
  snap.forEach((doc) => {
    const d = doc.data() as GameDocLike;
    if (d.vsAI === false) return; // PvP records tell a different story
    total++;
    const moves = d.moveCount ?? 0;
    const isWin = d.outcome === 'human-win';
    if (d.playerId) players.add(d.playerId);
    if (isWin) {
      wins++;
      // ignore degenerate 0/1-move logs — they read as nonsense on a public page
      if (moves >= 2 && (fastestWinMoves === null || moves < fastestWinMoves)) {
        fastestWinMoves = moves;
      }
    }
    if (moves >= 50) survive50++;
    if (moves > longestMoves) longestMoves = moves;
    const bucket = funnel[Math.min(5, Math.floor(Math.max(moves - 1, 0) / 10))];
    if (isWin) bucket.win++;
    else bucket.loss++;
  });

  return {
    total,
    players: players.size,
    wins,
    survive50,
    longestMoves,
    fastestWinMoves,
    funnel,
  };
}

const EMPTY: Stats = {
  totalGames: 0,
  whiteWins: 0,
  blackWins: 0,
  draws: 0,
  avgMoveCount: 0,
  avgFinalEval: 0,
  scoredMoves: 0,
  totalMovesInSample: 0,
  avgDurationSec: null,
  oldestGame: null,
  newestGame: null,
  loading: true,
  error: null,
};

function formatDurationSec(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min === 0 ? `${rem}s` : `${min}m ${rem}s`;
}

interface StoredMoveLike {
  searchScore?: number;
}

interface TrainingDocLike {
  outcome?: string;
  moveCount?: number;
  finalEvalFromWhite?: number;
  createdAt?: Timestamp;
  durationMs?: number;
  log?: { moves?: StoredMoveLike[] };
}

async function loadStats(): Promise<Stats> {
  await ensureSignedIn();
  const trainingRef = collection(db, 'training_games');

  const totalSnap = await getCountFromServer(query(trainingRef));
  const total = totalSnap.data().count;

  const recentSnap = await getDocs(
    query(trainingRef, orderBy('createdAt', 'desc'), limit(SAMPLE_SIZE)),
  );

  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let sumMoves = 0;
  let sumEval = 0;
  let count = 0;
  let scoredMoves = 0;
  let totalMovesInSample = 0;
  let sumDurationMs = 0;
  let durationCount = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;

  recentSnap.forEach((doc) => {
    const d = doc.data() as TrainingDocLike;
    if (d.outcome === 'human-win') whiteWins++;
    else if (d.outcome === 'ai-win') blackWins++;
    else if (d.outcome === 'draw') draws++;
    sumMoves += d.moveCount ?? 0;
    sumEval += d.finalEvalFromWhite ?? 0;
    count++;
    if (typeof d.durationMs === 'number') {
      sumDurationMs += d.durationMs;
      durationCount++;
    }
    const moves = d.log?.moves;
    if (moves) {
      totalMovesInSample += moves.length;
      for (const m of moves) if (typeof m.searchScore === 'number') scoredMoves++;
    }
    const created = d.createdAt?.toDate?.();
    if (created) {
      if (!newest || created > newest) newest = created;
      if (!oldest || created < oldest) oldest = created;
    }
  });

  return {
    totalGames: total,
    whiteWins,
    blackWins,
    draws,
    avgMoveCount: count ? Math.round(sumMoves / count) : 0,
    avgFinalEval: count ? Math.round(sumEval / count) : 0,
    scoredMoves,
    totalMovesInSample,
    avgDurationSec:
      durationCount > 0 ? sumDurationMs / durationCount / 1000 : null,
    oldestGame: oldest,
    newestGame: newest,
    loading: false,
    error: null,
  };
}

export function StatsPage() {
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [human, setHuman] = useState<HumanStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      loadHumanStats()
        .then((next) => {
          if (!cancelled) setHuman(next);
        })
        .catch((err: unknown) => {
          console.error('[stats] human stats load failed', err);
        });
      loadStats()
        .then((next) => {
          if (!cancelled) setStats(next);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error('[stats] load failed', err);
          setStats((s) => ({
            ...s,
            loading: false,
            error:
              err instanceof Error ? err.message : 'Could not load stats.',
          }));
        });
    }
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (stats.loading) {
    return (
      <div className="stats-page">
        <div className="stats-loading">Loading…</div>
      </div>
    );
  }

  if (stats.error) {
    return (
      <div className="stats-page">
        <h1>
          <Icon icon={BarChart3} size="lg" aria-hidden /> Training Data Stats
        </h1>
        <div className="stats-error">{stats.error}</div>
      </div>
    );
  }

  const sample = stats.whiteWins + stats.blackWins + stats.draws;
  const pct = (n: number) => (sample > 0 ? Math.round((100 * n) / sample) : 0);
  const labelPct =
    stats.totalMovesInSample > 0
      ? Math.round((100 * stats.scoredMoves) / stats.totalMovesInSample)
      : 0;
  const fmtDate = (d: Date | null) => (d ? d.toLocaleString() : '—');

  const funnelMax = human
    ? Math.max(1, ...human.funnel.map((b) => b.win + b.loss))
    : 1;

  return (
    <div className="stats-page">
      <h1>
        <Icon icon={BarChart3} size="lg" aria-hidden /> Subutai Chess Stats
      </h1>

      {human && (
        <>
          <section className="stats-hero">
            <div className="stat-big">{human.total.toLocaleString()}</div>
            <div className="stat-label">
              battles fought by {human.players.toLocaleString()} players
            </div>
          </section>

          <section className="stats-section">
            <h2>Hall of numbers</h2>
            <div className="stat-row">
              <span className="stat-row-label">Players who beat the bot</span>
              <strong className="stat-row-value">{human.wins}</strong>
              <span className="stat-pct">
                ({human.total > 0 ? Math.round((100 * human.wins) / human.total) : 0}%)
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-row-label">Games reaching move 50</span>
              <strong className="stat-row-value">{human.survive50}</strong>
              <span className="stat-pct">
                ({human.total > 0 ? Math.round((100 * human.survive50) / human.total) : 0}%)
              </span>
            </div>
            <div className="stat-row">
              <span className="stat-row-label">Wins that came back from a lost position</span>
              <strong className="stat-row-value">{COMEBACK_WIN_PCT}%</strong>
              <span className="stat-pct">*</span>
            </div>
            <div className="stat-row">
              <span className="stat-row-label">Longest game</span>
              <strong className="stat-row-value">{human.longestMoves} moves</strong>
            </div>
            <div className="stat-row">
              <span className="stat-row-label">Fastest win</span>
              <strong className="stat-row-value">
                {human.fastestWinMoves !== null ? `${human.fastestWinMoves} moves` : '—'}
              </strong>
            </div>
          </section>

          <section className="stats-section">
            <h2>
              Survival funnel{' '}
              <span className="stats-section-meta">(game length, wins vs losses)</span>
            </h2>
            {human.funnel.map((b) => (
              <div className="funnel-row" key={b.label}>
                <span className="funnel-label">{b.label}</span>
                <span className="funnel-track">
                  <span
                    className="funnel-bar funnel-bar-win"
                    style={{ width: `${(100 * b.win) / funnelMax}%` }}
                  />
                  <span
                    className="funnel-bar funnel-bar-loss"
                    style={{ width: `${(100 * b.loss) / funnelMax}%` }}
                  />
                </span>
                <span className="funnel-count">{b.win + b.loss}</span>
              </div>
            ))}
          </section>
        </>
      )}

      <section className="stats-hero">
        <div className="stat-big">{stats.totalGames.toLocaleString()}</div>
        <div className="stat-label">bot training games collected</div>
      </section>

      <section className="stats-section">
        <h2>
          Outcomes <span className="stats-section-meta">(last {sample})</span>
        </h2>
        <div className="stat-row">
          <span className="stat-row-label">White wins</span>
          <strong className="stat-row-value">{stats.whiteWins}</strong>
          <span className="stat-pct">({pct(stats.whiteWins)}%)</span>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Black wins</span>
          <strong className="stat-row-value">{stats.blackWins}</strong>
          <span className="stat-pct">({pct(stats.blackWins)}%)</span>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Draws</span>
          <strong className="stat-row-value">{stats.draws}</strong>
          <span className="stat-pct">({pct(stats.draws)}%)</span>
        </div>
      </section>

      <section className="stats-section">
        <h2>Game metrics</h2>
        <div className="stat-row">
          <span className="stat-row-label">Avg game length</span>
          <strong className="stat-row-value">
            {stats.avgMoveCount} moves
          </strong>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Avg game duration</span>
          <strong className="stat-row-value">
            {stats.avgDurationSec !== null
              ? formatDurationSec(stats.avgDurationSec)
              : '—'}
          </strong>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Avg final eval</span>
          <strong className="stat-row-value">
            {stats.avgFinalEval > 0 ? '+' : ''}
            {stats.avgFinalEval} cp
          </strong>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Moves with searchScore</span>
          <strong className="stat-row-value">
            {stats.scoredMoves.toLocaleString()} / {stats.totalMovesInSample.toLocaleString()}
          </strong>
          <span className="stat-pct">({labelPct}%)</span>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Oldest game in sample</span>
          <strong className="stat-row-value">{fmtDate(stats.oldestGame)}</strong>
        </div>
        <div className="stat-row">
          <span className="stat-row-label">Newest game in sample</span>
          <strong className="stat-row-value">{fmtDate(stats.newestGame)}</strong>
        </div>
      </section>

      <p className="stats-footnote">
        * behind by 2.5+ pawns (engine eval) at some point during the game;
        measured offline across all games, {COMEBACK_MEASURED_AT}
      </p>
      <p className="stats-footnote">
        Auto-refresh every 30s &middot; Outcome/metric breakdown from {SAMPLE_SIZE} most-recent games
      </p>
    </div>
  );
}
