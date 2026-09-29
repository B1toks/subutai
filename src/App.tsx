import './App.css';
import type { BoardState, Color, Move, PieceType, SquareId, TopologyState } from './engine';
import { createStartingPosition, createPositionFromBackRankKey, isValidChess960Key } from './engine';
import { allSquares } from './engine/board';
import {
  applyMove,
  generateLegalMoves,
  isCheckmate,
  checkDrawConditions,
  isInCheck,
  isSquareAttacked,
  countAttackers,
  getAttackerSquares,
  findKing,
  findCheckingPieces,
} from './engine/moves';
import { applyRotationMove, applyPassMove, toggleTopology, computeBoardLayout, tilePixelCenter, promoteStrandedPawns, toTileFrame } from './engine/auxetic';
import {
  SubutaiAgent,
  BOT_STRENGTHS,
  BOT_STRENGTH_LABEL,
  isBotStrength,
  type BotStrength,
} from './ai/agents';
import { evaluate, PIECE_VALUE } from './ai/evaluate';
import { searchPosition, ttClear } from './ai/search';
import { type MoveClass, type MoveAnalysis } from './analysis/classify';
import { classifyAsync } from './analysis/classifyClient';
import { NamePicker } from './components/NamePicker';
import { useToast } from './components/Toast';
import type { EndgameKind, KingOrigin, VictoryTheme } from './components/EndgameScene';
import { GameSummary } from './components/GameSummary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneModal } from './components/MilestoneModal';
import { AutoPlayView } from './components/AutoPlayView';
import { ThemeToggle } from './components/ThemeToggle';
import { NeonLogo } from './components/NeonLogo';
import { UserMenu } from './components/UserMenu';
import { Effects3DToggle } from './components/Effects3DToggle';
import { AudioToggle } from './components/AudioToggle';
import { MusicToggle } from './components/MusicToggle';
import { audio } from './audio/AudioController';
import { Icon } from './components/Icon';
import { Tooltip } from './components/Tooltip';
import { TutorialOverlay, TUTORIAL_DONE_KEY } from './components/TutorialOverlay';
import { WelcomeScreen, WELCOME_SEEN_KEY } from './components/WelcomeScreen';
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Crosshair,
  Dices,
  Disc3,
  Eye,
  Flag,
  GraduationCap,
  HelpCircle,
  Lightbulb,
  Lock,
  MessageSquare,
  Pencil,
  Menu,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Cast,
  Upload,
  Users,
  UsersRound,
} from 'lucide-react';
import type { GameReviewMeta } from './components/GameReview';
import { useMultiplayerSync } from './components/MultiplayerGameView';
import { mpResignCause } from './firebase/matchEnd';
import { rejoinMatch, type MatchDoc, type MatchOutcome } from './firebase/matches';
import {
  saveMultiplayerGameToGames,
  translateOutcomeForPlayer,
} from './firebase/multiplayerGames';
import { saveTrainingGame } from './firebase/trainingGames';
import { useAuth } from './firebase/useAuth';
import {
  saveCompletedGame,
  getPersonalBest,
  fetchSavedGame,
  deserializeGameLog,
} from './firebase/games';
import { logGameStart } from './firebase/gameStarts';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './firebase/presence';
import { computeGamePoints, type GameOutcome, type GamePoints } from './analysis/points';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog } from './recording/log';
import {
  appendMove,
  attachSearchScoreToLastMove,
  computeSAN,
  createGameLog,
  updateMoveAnalysisAt,
} from './recording/log';
import { buildSavedGameFromLog, buildSavedGameSnapshot } from './memory/build';
import { LIVE_SESSION_KEY, localStorageAdapter } from './memory/storage';
import { MemoryPanel } from './memory/MemoryPanel';
import type { SavedGame } from './memory/types';
import { NotationParseError } from './memory/notation';
// rotateIsLegal (R10) decides whether chat rounds accept "rotate"; it lives
// with the replay importer, which checks rotations the same way (QA-02).
import { replayFromNotation, rotateIsLegal } from './memory/replayImport';
import { moveVoting, type VoteMode, type VoteRound, type GuessWinner } from './twitch/moveVoting';
import { dockLayout, type DockState } from './ui/dockLayout';
import { themeStore } from './ui/themeStore';
import { busy } from './ui/busy';
import { micEq } from './audio/micEqualizer';
import { PerimeterEqualizer } from './components/PerimeterEqualizer';
import { BackgroundWaveGrid } from './components/BackgroundWaveGrid';
import { vizMode } from './music/vizMode';
import { beatBridge } from './music/beatBridge';
import { beatEngine } from './music/beatEngine';
import { beatMode } from './music/beatMode';
import { liveBpm } from './music/liveBpm';
import { BeatCombo } from './components/BeatCombo';
import { MusicScorePanel } from './components/MusicScorePanel';
import { scaleBudgetMs } from './utils/deviceTier';

// Sprint 4.4 — heavy sub-views are code-split. Each renders as a
// full-screen takeover, so a Suspense spinner fallback is natural.
// NOTE: this block must sit BELOW the react import — Vite's dev-mode
// CJS interop turns `import { lazy }` into a const at the import line,
// so calling lazy() above it is a TDZ ReferenceError.
const GameReview = lazy(() =>
  import('./components/GameReview').then((m) => ({ default: m.GameReview })),
);
const Leaderboard = lazy(() =>
  import('./components/Leaderboard').then((m) => ({ default: m.Leaderboard })),
);
const FriendLobby = lazy(() =>
  import('./components/FriendLobby').then((m) => ({ default: m.FriendLobby })),
);
const StatsPage = lazy(() =>
  import('./components/StatsPage').then((m) => ({ default: m.StatsPage })),
);
// T3 — Twitch overlay is code-split: only streamers pay for it.
const TwitchPanel = lazy(() =>
  import('./components/TwitchPanel').then((m) => ({ default: m.TwitchPanel })),
);
// SP — Spotify dock, same deal.
const MusicDock = lazy(() =>
  import('./components/MusicDock').then((m) => ({ default: m.MusicDock })),
);
// R6 — pixel victory cinematic; loaded only when a tense win triggers it.
/**
 * The endgame cinematic is code-split, but it is handed the screen by the
 * checkmate iris on a hard cut: if the chunk is still in flight when the
 * iris ends, the board flashes back into view for a few hundred ms before
 * going black again. So the import is also callable on its own, and the
 * iris kicks it off the moment it starts closing — by the time it hands
 * over, the module is in cache and React's lazy resolves in a microtask.
 */
const importEndgameScene = () => import('./components/EndgameScene');
const EndgameScene = lazy(() =>
  importEndgameScene().then((m) => ({ default: m.EndgameScene })),
);

type GameStatus =
  | 'active'
  | 'checkmate'
  | 'draw_stalemate'
  | 'draw_material'
  | 'draw_repetition'
  | 'draw_50move'
  | 'king_captured_white_wins'
  | 'king_captured_black_wins'
  // V1 — solo time control: the side that runs out of time loses.
  | 'timeout_white'
  | 'timeout_black'
  // QA-11 — the named side resigned. Its own status, so the banner, the
  // winner and the endgame cut no longer read a resignation as a mate.
  | 'resigned_white'
  | 'resigned_black';

type GameMode = 'classic' | 'roulette';

const BOT_LEVEL_KEY = 'subutai_bot_level';

/** V1 — seed of the very first game of a page load (see the `seed` state). */
const FIRST_SEED = Date.now();

/** V1 — survival milestones below the 50-move modal. Percentages come from
 *  the R15 solo funnel (docs/R15-DATA-FINDINGS.md §1). */
const MOVE_MILESTONES: readonly { moves: number; text: string }[] = [
  { moves: 10, text: '10 moves. You are past the point where 40% of games end.' },
  { moves: 20, text: '20 moves. Longer than 72% of games. Keep it up.' },
  { moves: 30, text: '30 moves. Only 1 game in 10 gets this far.' },
];

function readInitialBotLevel(): BotStrength {
  try {
    const raw = localStorage.getItem(BOT_LEVEL_KEY);
    if (isBotStrength(raw)) return raw;
  } catch {
    /* private mode */
  }
  return 'strong';
}

/** V1 — what actually changes between levels, in the player's terms.
 *  The numbers are the real search profile in src/ai/agents.ts, so the
 *  panel never promises a difference the engine does not make. */
const BOT_STRENGTH_HINT: Record<BotStrength, string> = {
  casual:
    'Looks 2 moves ahead and throws away about 1 move in 3 on purpose. It hangs pieces and misses simple tactics. Practice only, not ranked.',
  normal:
    'Looks 4 moves ahead and slips about 1 move in 10. It punishes anything you leave hanging but will hand you chances back. Practice only, not ranked.',
  strong:
    'Looks 6 moves ahead and never slips on purpose. Measured at about a quarter of the error the lower levels make. The leaderboard is this bot.',
};

/** One-line summary under the pills: the single fact that matters most. */
const BOT_STRENGTH_SUMMARY: Record<BotStrength, string> = {
  casual: 'Casual: 2 moves ahead, gives away 1 move in 3. Not ranked.',
  normal: 'Normal: 4 moves ahead, slips 1 move in 10. Not ranked.',
  strong: 'Strong: 6 moves ahead, no slips. Wins and survival count for the leaderboard.',
};

const ROULETTE_SLOT_COUNT = 4;
const ROULETTE_MAX_ACTIONS = 2;
const AI_ROULETTE_REVEAL_MS = 1200;
const AI_ROULETTE_BETWEEN_ACTIONS_MS = 900;

/**
 * Q.D.5: SINGLE source of truth for "may this piece move under roulette
 * constraints?". Every selection / move / highlight gate goes through this
 * helper so the in-check override is guaranteed to apply uniformly.
 *
 *   - Classic mode → always true (no roulette restriction).
 *   - Pre-spin (allowed === null) → false (board is locked).
 *   - In check → true (player MUST be able to escape, slot restriction is lifted).
 *   - Otherwise → piece type must match an unused slot in the bag.
 *
 * Callers are responsible for the side check (`piece.color === state.sideToMove`).
 */
function isPieceMovableInRoulette(
  pieceType: PieceType,
  _state: BoardState,
  gameMode: GameMode,
  allowed: PieceType[] | null,
  used: number[],
): boolean {
  if (gameMode !== 'roulette') return true;
  if (allowed === null) return false;
  // Q.D.8: no in-check override — roulette is capture-the-king, so being
  // in check is just "the king is attacked"; player still plays under
  // the normal slot restriction. If they ignore the threat, opponent
  // can capture the king on the next move and win.
  return allowed.some((t, i) => t === pieceType && !used.includes(i));
}

/** Only piece types currently alive for `color` — no "dead" slots. */
function getActivePieceTypes(state: BoardState, color: Color): PieceType[] {
  const types = new Set<PieceType>();
  for (const piece of Object.values(state.pieces)) {
    if (piece && piece.color === color) types.add(piece.type);
  }
  return Array.from(types);
}

function spinRoulette(
  activeTypes: PieceType[],
  pawnBoost: boolean = false,
): PieceType[] {
  if (activeTypes.length === 0) return [];
  // Pawn-bias for the first 3 spins of a game (Stage O): we add 'pawn' to the
  // pool one extra time, lifting its per-slot probability from 1/n to 2/(n+1)
  // — roughly a +50-65% boost depending on how many piece types remain.
  const pool: PieceType[] =
    pawnBoost && activeTypes.includes('pawn')
      ? [...activeTypes, 'pawn']
      : activeTypes;
  const out: PieceType[] = [];
  for (let i = 0; i < ROULETTE_SLOT_COUNT; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

function backRankString(boardState: BoardState): string {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const abbrev: Record<string, string> = {
    rook: 'R', knight: 'N', bishop: 'B', queen: 'Q', king: 'K',
  };
  return files
    .map((f) => {
      const piece = boardState.pieces[`${f}1` as SquareId];
      return piece ? abbrev[piece.type] ?? '?' : '?';
    })
    .join('');
}

/** Same piece of the same colour on every occupied square. */
function samePieces(a: BoardState['pieces'], b: BoardState['pieces']): boolean {
  const occupied = (p: BoardState['pieces']) =>
    Object.keys(p).filter((sq) => p[sq as SquareId]);
  const squares = occupied(a);
  if (squares.length !== occupied(b).length) return false;
  return squares.every((sq) => {
    const x = a[sq as SquareId];
    const y = b[sq as SquareId];
    return !!x && !!y && x.type === y.type && x.color === y.color;
  });
}

// B3 — eval-bar stability. Dropping the search eval to null between
// moves made the bar flicker: search → static fallback → worker. Now
// the previous search eval is *bumped* by the move's material delta
// (the dominant term) so the bar shifts once toward the truth and the
// worker only fine-tunes it ~1s later.
function bumpEvalForMove(
  prevEval: number | null,
  stateBefore: BoardState,
  move: Move,
): number | null {
  if (prevEval === null) return null;
  if (move.kind === 'topologyToggle' || !move.to) return prevEval;
  let delta = 0;
  const victim = stateBefore.pieces[move.to];
  if (victim) {
    delta += PIECE_VALUE[victim.type] * (victim.color === 'black' ? 1 : -1);
  } else if (move.kind === 'enPassant') {
    const mover = move.from ? stateBefore.pieces[move.from] : undefined;
    delta += PIECE_VALUE.pawn * (mover?.color === 'white' ? 1 : -1);
  }
  if (move.kind === 'promotion' && move.promotion && move.from) {
    const mover = stateBefore.pieces[move.from];
    const gain = PIECE_VALUE[move.promotion] - PIECE_VALUE.pawn;
    delta += gain * (mover?.color === 'white' ? 1 : -1);
  }
  return prevEval + delta;
}

// M.14 — beat-mode glide length. MUST match the .piece-slide-in CSS
// animation duration so the slide lands exactly on the beat.
const BEAT_SLIDE_MS = 260;

// S2.5 — mm:ss elapsed-time display for the per-side clocks.
/**
 * V1 — the hot-seat turn indicator, as part of a player's own row.
 *
 * Each player gets one, in the row of buttons in front of them (black's
 * row is drawn upside down, so black reads theirs upright). It lights and
 * says "Your move" for the side that is to play; the other one dims and
 * names whose turn it is instead.
 */
function LocalTurnSlot({ side, toMove }: { side: 'white' | 'black'; toMove: 'white' | 'black' }) {
  const mine = side === toMove;
  return (
    <span
      className={`local-turn-slot is-${side}${mine ? ' is-to-move' : ''}`}
      role="status"
      aria-live={mine ? 'polite' : undefined}
    >
      <span className="local-turn-lamp" aria-hidden />
      {mine ? 'Your move' : `${toMove === 'white' ? 'White' : 'Black'} to move`}
    </span>
  );
}

/** V1 — pointer to the solo game in progress, for a new tab to resume.
 *  The key lives next to Memory's, whose entry it points at. */
interface LiveSession {
  gameId: string;
  opponentMode: 'ai' | 'local';
  gameMode: string;
  timed: boolean;
  savedAt: number;
  /** The level the game was started against. The level pills are locked
   *  mid-game; without this a resume would silently take whatever level
   *  another tab has written since. Absent in pre-fix pointers. */
  botLevel?: BotStrength;
}
function writeLiveSession(s: LiveSession): void {
  try {
    localStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private mode — the tab just starts fresh */
  }
}
function readLiveSession(): LiveSession | null {
  try {
    const raw = localStorage.getItem(LIVE_SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LiveSession>;
    if (typeof v.gameId !== 'string' || typeof v.savedAt !== 'number') return null;
    return {
      gameId: v.gameId,
      opponentMode: v.opponentMode === 'local' ? 'local' : 'ai',
      gameMode: typeof v.gameMode === 'string' ? v.gameMode : 'classic',
      timed: v.timed === true,
      savedAt: v.savedAt,
      botLevel: isBotStrength(v.botLevel) ? v.botLevel : undefined,
    };
  } catch {
    return null;
  }
}
function clearLiveSession(): void {
  try {
    localStorage.removeItem(LIVE_SESSION_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * How big the board should be right now.
 *
 * Module level because BOTH the initial state and the resize handler have
 * to use it. They used to disagree: the first render hardcoded
 * `min(innerWidth - 32, 520)` while the effect computed the real value a
 * frame later, so every page load painted a 520px board inside a layout
 * sized for a much bigger one and then snapped — which is the stretch you
 * see on a reload. One formula, used twice, and the first paint is right.
 */
function computeBoardSize(uiScale: number, dockLeft: number, dockRight: number): number {
  // Layout runs in zoom space: divide the device viewport by the scale.
  const vw = window.innerWidth / uiScale;
  const vh = window.innerHeight / uiScale;
  // Side docks reserve space only on desktop; below the breakpoint the
  // panels become full-width bottom bars and reserve nothing.
  const reserved = window.innerWidth > 720 ? dockLeft + dockRight : 0;
  // Above the grid collapse (880px, device px — CSS media queries ignore
  // zoom) the right sidebar + gaps/padding stay clear; below it the board
  // takes the full width minus shell padding. The sidebar is not a flat
  // 320: it steps up on big monitors (SIDEBAR_STEPS in App.css), so the
  // reserved chrome and the board cap follow the same steps. They must
  // stay in sync or the board overflows its column.
  const w = window.innerWidth;
  const sidebar = w >= 2100 ? 460 : w >= 1700 ? 400 : 320;
  // QA-15 — below the grid collapse the board still shares the row with
  // things that are not the sidebar: from 721px the fixed icon rail pads
  // .app-root by 84px on the left (the board used to run 13px off the
  // right edge at 768px), and until the eval bar hides at 640px it sits
  // 20px left of the board and needs that much room.
  const chrome = w > 880 ? sidebar + 72 : w > 720 ? 140 : w > 640 ? 48 : 32;
  const capPx = w >= 2100 ? 1000 : w >= 1700 ? 900 : 820;
  const cap = Math.min(capPx, Math.round(vh * 0.7));
  // R9 — floored at 240px: a hidden/headless tab can report innerWidth 0
  // during init, and without the floor boardSize goes NEGATIVE (tile math,
  // dash arrays and overlays all silently break until the next resize).
  return Math.max(240, Math.min(vw - chrome - reserved, cap));
}

/**
 * V1 — fixed-width MM:SS for the tournament clock face.
 *
 * This used to be a "m:ss" formatter, which is fine in a sentence but
 * wrong on a clock: the digits shift sideways the moment the tens column
 * drops, and the unlit "88:88" ghost behind them stops lining up. Pads to
 * two, and grows past 99 minutes rather than truncating.
 */
function formatClockFace(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** How long two heavy board effects count as "back to back". */
const FX_WINDOW_MS = 2600;

const MOVE_CLASS_MARKER: Record<MoveClass, string> = {
  best: ' ⭐',
  good: '',
  mistake: '?',
  blunder: '??',
  brilliant: '!!',
  checkmate: '#',
};

// White-perspective static eval. evaluate() returns the score for sideToMove,
// so we negate when it's Black's turn — this way + always means White is ahead.
function evaluateFromWhite(state: BoardState): number {
  const raw = evaluate(state);
  return state.sideToMove === 'white' ? raw : -raw;
}

// Map a White-perspective centipawn score to a pair of HSL colors that drive
// the linear-gradient. tanh squashes extreme positions into [-1, 1] so the
// gradient eases off rather than running away on crushing material wins.
//
// "Rotation changes the room" (docs/IDEAS.md): topology A gets the original
// warm gold/crimson ramp; topology B gets a cool cyan/violet ramp of the
// same shape. This is a TINT, not a theme swap — it lives entirely inside
// the ambient background gradient, which was already identical across every
// [data-theme], so it never touches piece colors, accents, or panel chrome
// (ThemeToggle keeps full control of those). The existing @property-
// registered --eval-c1/--eval-c2 transition (0.6s ease, App.css) does the
// cross-fade for free — this only changes which hue pair feeds it.
function evalToColors(evalCp: number, topology: TopologyState): { c1: string; c2: string } {
  const t = Math.tanh(evalCp / 400);
  // M.23 — the room's background is the ONE thing in this app that's
  // deliberately theme-INDEPENDENT: it's a soft, always-on hint of "how
  // is this going" (warm/gold = winning, cool/red = losing), not a mood
  // board. Every dark theme shares one dark-tuned ramp below since they
  // already read fine together; wood-light needed its OWN ramp (same
  // shape, high-lightness cream tones) instead of just being defeated
  // outright — see the removed [data-theme="wood-light"] .app-shell
  // override that used to flatten this to a static color.
  if (document.documentElement.getAttribute('data-theme') === 'wood-light') {
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(42, ${25 + 30 * i}%, ${92 - 6 * i}%)`,
        c2: `hsl(36, ${20 + 25 * i}%, ${88 - 6 * i}%)`,
      };
    }
    if (t < -0.1) {
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(355, ${25 + 30 * i}%, ${92 - 8 * i}%)`,
        c2: `hsl(348, ${20 + 25 * i}%, ${87 - 8 * i}%)`,
      };
    }
    return { c1: '#f6f1e8', c2: '#ede5d5' };
  }
  // Neon: the room lives in the indigo family. Topology A leans cyan when
  // winning / magenta when losing; topology B swaps to teal / violet so
  // the "rotation tints the room" beat survives on this theme too.
  if (document.documentElement.getAttribute('data-theme') === 'neon') {
    const win = topology === 'B' ? 170 : 195;
    const lose = topology === 'B' ? 275 : 320;
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(${win}, ${40 + 30 * i}%, ${13 + 5 * i}%)`,
        c2: `hsl(${win + 40}, ${30 + 20 * i}%, ${9 + 3 * i}%)`,
      };
    }
    if (t < -0.1) {
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(${lose}, ${35 + 35 * i}%, ${12 + 4 * i}%)`,
        c2: `hsl(${lose - 35}, ${28 + 22 * i}%, ${8 + 3 * i}%)`,
      };
    }
    return topology === 'B'
      ? { c1: '#141a33', c2: '#0f1224' }
      : { c1: '#1a1533', c2: '#12101f' };
  }
  if (topology === 'B') {
    if (t > 0.1) {
      const i = Math.min(t, 1);
      return {
        c1: `hsl(195, ${30 + 30 * i}%, ${15 + 5 * i}%)`,
        c2: `hsl(210, ${20 + 20 * i}%, ${8 + 3 * i}%)`,
      };
    }
    if (t < -0.1) {
      // V1 — this used to go violet (hsl 275). Neon can carry violet;
      // wood and fantasy cannot — a purple room over a bronze board and
      // gothic gold read as a rendering fault, not as "you are losing".
      // The room just goes dark instead, with barely enough red left in
      // it to feel warm rather than switched off. Losing badly is the
      // light going out, which is the right feeling anyway.
      const i = Math.min(-t, 1);
      return {
        c1: `hsl(350, ${8 + 10 * i}%, ${11 - 5 * i}%)`,
        c2: `hsl(345, ${6 + 8 * i}%, ${6 - 3 * i}%)`,
      };
    }
    return { c1: '#1a1c2a', c2: '#12131f' };
  }
  if (t > 0.1) {
    const i = Math.min(t, 1);
    return {
      c1: `hsl(45, ${30 + 30 * i}%, ${15 + 5 * i}%)`,
      c2: `hsl(35, ${20 + 20 * i}%, ${8 + 3 * i}%)`,
    };
  }
  if (t < -0.1) {
    const i = Math.min(-t, 1);
    return {
      c1: `hsl(355, ${25 + 35 * i}%, ${12 + 4 * i}%)`,
      c2: `hsl(345, ${20 + 25 * i}%, ${6 + 3 * i}%)`,
    };
  }
  return { c1: '#2a2520', c2: '#1a1612' };
}

const HUMAN_COLOR: Color = 'white';

/* R5 — encouragement in a losing position. When the human (white) has
 * been meaningfully behind for a couple of moves, drop a supportive nudge
 * instead of letting them spiral into a resign. Rotate-flavoured lines
 * fire only when a board rotate is actually available and also pulse the
 * Rotate button — in this variant a single rotate can swing the eval hard.
 * Gated behind the coaching-tools switch and rate-limited. */
const ENCOURAGE_GENERIC = [
  "Don't resign, keep playing. One slip from the bot and you're right back in it.",
  'Hang in there: a single strong move can turn this whole game around.',
  "You're behind, not beaten. Make the bot earn every square.",
];
const ENCOURAGE_ROTATE = [
  // R15 data: a rotate swings the eval hard but usually AGAINST the rotator
  // (mean -277cp for the rotating side). Sell it as honest chaos, and always
  // pair it with the re-check habit.
  'Tough spot? A rotate shakes up the whole position. Just re-check your pieces right after.',
  'Feeling stuck? Rotate scrambles the game for both sides. Chaos favours the prepared.',
];

/* R15 step 4-lite — two data-driven coaching beats.
 * The labelled human games say: median FIRST blunder lands on move 4 (92 of
 * 98 inside moves 1-10), and 25 of 98 first blunders come immediately after
 * the player's OWN rotation. Two one-shot-per-game nudges target exactly
 * those windows. Both ride the coaching-tools gate like the R5 nudges. */
const EARLY_GAME_TIP =
  'Heads up: most games here are decided in the first 10 moves. Slow down and check captures.';
const ROTATE_AFTERMATH_TIP =
  'You rotated and the whole board changed with you. Re-check your pieces before moving on.';

/** Reshape a live MatchDoc into the GameLog the single-player render code
 *  already knows how to consume. The stored move shape happens to be a
 *  superset of LoggedMove (analysis is absent in MP). */
function deriveMpLog(live: MatchDoc): GameLog {
  return {
    id: `mp-${live.code}`,
    createdAt: new Date().toISOString(),
    randomSeed: live.seed,
    initialTopology: live.log.initialTopology,
    initialState: createPositionFromBackRankKey(live.chess960Id),
    moves: live.log.moves.map((m) => ({
      san: m.san,
      move: m.move,
      topology: m.topology,
      timestamp: m.timestamp,
    })),
  };
}

function deriveMpLastMove(
  live: MatchDoc,
): { from?: SquareId; to?: SquareId } | null {
  const last = live.log.moves[live.log.moves.length - 1]?.move;
  if (!last || last.kind === 'topologyToggle') return null;
  return { from: last.from, to: last.to };
}
const WATCH_AUTOPLAY_MS = 1500;
// Auto-mode tuning. We skip the move classifier (expensive worker round-trip)
// and use a small inter-move delay so a 60-ply game finishes in ~30s.
const AUTO_MOVE_DELAY_MS = 50;
const AUTO_BETWEEN_GAMES_MS = 600;
const AUTO_WATCHDOG_MS = 60_000;
// Shallow search used to label each auto-mode position for training data.
// ~100ms × ~80 plies ≈ +8s per game on top of the move-generation cost.
const AUTO_SEARCH_LABEL_BUDGET_MS = 100;
const AUTO_SEARCH_LABEL_DEPTH = 4;
// Bumped per release so /training_games docs can be filtered by engine
// version when we later use them for training data.
const AI_VERSION = 'stage-j';

interface WatchingGame {
  log: GameLog;
  playerName: string;
  gameId: string;
  currentMoveIdx: number;
  autoplay: boolean;
}

interface GameBackup {
  seed: number;
  state: BoardState;
  initialState: BoardState;
  legalMoves: Move[];
  log: GameLog;
  gameStatus: GameStatus;
  lastMove: { from?: SquareId; to?: SquareId } | null;
  liveSavedGameId: string;
  savedForLogId: string | null;
  completedLogId: string | null;
  searchEvalFromWhite: number | null;
  searchMateInPlies: number | null;
  formationLocked: boolean;
  lockedFormationKey: string | null;
}

// Sprint 3.6 — right-click annotation primitives. Module-level so they
// can be referenced from helper signatures inside App() without TS
// scope juggling.
type AnnotationColor = 'green' | 'red' | 'yellow' | 'blue';
interface ArrowAnnotation {
  from: SquareId;
  to: SquareId;
  color: AnnotationColor;
}

function App() {
  // Self-play / training data collection mode: ?auto=1 in the URL puts both
  // sides under AI control, hides the regular UI, and writes finished games
  // to /training_games. URL-derived so it survives reloads but can be exited
  // by clicking Stop (which navigates back to the no-param URL).
  const isAutoMode = useMemo(
    () => new URLSearchParams(window.location.search).get('auto') === '1',
    [],
  );
  const maxGames = useMemo(() => {
    const m = new URLSearchParams(window.location.search).get('max');
    if (!m) return 0;
    const n = parseInt(m, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, []);
  // Internal monitoring page for the /training_games collection. URL-only so
  // it never shows up in the regular navigation UI.
  const isStatsMode = useMemo(
    () => new URLSearchParams(window.location.search).get('stats') === '1',
    [],
  );
  // T2: ?game=<id> loads a saved /games doc into the Review screen on
  // mount, so a copied share-link opens directly into playback.
  const sharedGameId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('game');
    // Firestore auto-ids are 20 url-safe chars; anything else is junk that
    // would only produce a confusing "could not load" banner (or a thrown
    // invalid-path error for slashes). Ignore it up front.
    return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
  }, []);

  const [autoGamesCompleted, setAutoGamesCompleted] = useState(0);
  const [autoLastOutcome, setAutoLastOutcome] = useState<GameOutcome | null>(null);
  // Rolling history of full-move counts so the panel can show an average.
  const [autoMoveHistory, setAutoMoveHistory] = useState<number[]>([]);
  const [autoStopped, setAutoStopped] = useState(false);
  const [autoStoppedReason, setAutoStoppedReason] = useState<string | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoNextGameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLastMoveAtRef = useRef<number>(Date.now());
  // Each completed game-id is processed exactly once by the auto-save effect.
  const autoSavedLogIdRef = useRef<string | null>(null);

  const { user, displayName, loading: authLoading, setDisplayName } = useAuth();
  const [showNameModal, setShowNameModal] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastGamePoints, setLastGamePoints] = useState<GamePoints | null>(null);
  // Stage P addendum 7: captured at finishGame so the GameSummary modal
  // keeps the previous game's duration even after Play Again resets the
  // running start-time ref.
  const [lastGameDurationMs, setLastGameDurationMs] = useState<number | null>(
    null,
  );
  const [gameOutcome, setGameOutcome] = useState<GameOutcome | null>(null);
  // QA-11 — WHO is resigning while the confirmation is up. In hot-seat
  // either seat has a Resign button, so it is not always the side to move.
  const [confirmingResign, setConfirmingResign] = useState<Color | null>(null);
  // Sprint 4.3.1 — pending opponent switch during an active local game.
  // When non-null the ConfirmDialog mounts; on confirm we discard the
  // local game state and start fresh in the requested mode.
  const [pendingOpponentChange, setPendingOpponentChange] = useState<
    'ai' | 'friend' | 'local' | null
  >(null);
  const [savingGame, setSavingGame] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [lastGameId, setLastGameId] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [milestoneShown, setMilestoneShown] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  // Sprint 2.5 — local AFK detector. Independent of the MP afk-watchdog
  // (mpSync.selfAfkWarning) which forfeits the match after 30s; this one
  // is a UX nag that surfaces a pulsing banner when the player's been
  // idle on their own turn for 20s. Resets on any pointer / key activity.
  const [showAfkAlert, setShowAfkAlert] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const completedLogIdRef = useRef<string | null>(null);
  // QA-02 — the log id of a game that came from Load replay (or a Memory
  // entry marked imported). Such a game is never ranked.
  const importedLogIdRef = useRef<string | null>(null);
  // Whether the game the summary is about was imported (for its wording).
  const [lastGameImported, setLastGameImported] = useState(false);
  const [view, setView] = useState<
    'game' | 'review' | 'leaderboard' | 'friend-lobby'
  >('game');
  // Stage Q.A: opponent selector in the header. 'ai' keeps the existing
  // solo flow; 'friend' opens the PvP lobby. Once a match starts it just
  // overlays the existing 'game' view — the board/log/header reuse the
  // single-player UI, only the data source flips.
  const [opponentMode, setOpponentMode] = useState<'ai' | 'friend' | 'local'>('ai');
  // Q.B.2: active PvP match handshake. When non-null, the rest of App
  // sources its board / log / turn state from useMultiplayerSync below
  // instead of the local engine.
  const [activeMatch, setActiveMatch] = useState<MatchDoc | null>(null);
  // Match-completion modal state (separate from the AI GameSummary which
  // is points-driven and doesn't fit the PvP shape).
  const [mpEndOutcome, setMpEndOutcome] = useState<MatchOutcome | null>(null);
  // R13b — reconnect after a refresh. The active match code is read ONCE
  // at mount (the persistence effect below clears the key whenever
  // activeMatch is null, so reading it lazily later would lose the race).
  const mpResumeCodeRef = useRef<string | null>(
    (() => {
      try {
        return localStorage.getItem('subutai_mp_active');
      } catch {
        return null;
      }
    })(),
  );
  const mpSavedGameIdRef = useRef<string | null>(null);
  const mpWroteOutcomeRef = useRef<string | null>(null);
  // QA-04 — the match code this player resigned themselves (the Resign
  // button, not a flag fall), so their own end text can say so.
  const mpSelfResignedRef = useRef<string | null>(null);
  // T2: review can be entered for the LIVE game (default — reads the `log`
  // alias) OR with a snapshot loaded via the MP completion modal or the
  // ?game=<id> URL. activeReviewLog overrides when set; meta gives the
  // review header context ("Alex vs AI", "won/lost/drew").
  const [activeReviewLog, setActiveReviewLog] = useState<GameLog | null>(null);
  const [activeReviewMeta, setActiveReviewMeta] =
    useState<GameReviewMeta | null>(null);
  const [sharedGameError, setSharedGameError] = useState<string | null>(null);
  // Q.B.2: PvP sync. Hook is always called (with null match before any
  // game starts) so React's hook-order rules are respected. Returns null
  // when no match — every consumer guards on isMultiplayer below.
  const mpSync = useMultiplayerSync(
    activeMatch,
    user?.uid ?? null,
    () => {
      // Doc was deleted out from under us — drop back to lobby.
      setActiveMatch(null);
      setMpEndOutcome(null);
      mpSavedGameIdRef.current = null;
      mpWroteOutcomeRef.current = null;
      setView('friend-lobby');
    },
  );
  const isMultiplayer = mpSync !== null;
  // R15-bug — mirror for async continuations (AI think can outlive the
  // solo game it started in when a PvP match begins mid-search).
  const isMultiplayerRef = useRef(isMultiplayer);
  useEffect(() => {
    isMultiplayerRef.current = isMultiplayer;
  }, [isMultiplayer]);

  // R13b — persist the live match code so a refresh can resume it. The
  // key exists only while a match is genuinely live: it clears when the
  // match ends (outcome modal) or when there's no active match at all.
  useEffect(() => {
    try {
      if (activeMatch && !mpEndOutcome) {
        localStorage.setItem('subutai_mp_active', activeMatch.code);
      } else {
        localStorage.removeItem('subutai_mp_active');
      }
    } catch {
      /* private mode */
    }
  }, [activeMatch, mpEndOutcome]);

  // R13b — one-shot resume: once auth lands, try to re-seat into the
  // match recorded before the refresh. rejoinMatch verifies the seat and
  // liveness; on any failure the key is just dropped (the AFK watchdog
  // may have forfeited us long ago — nothing to resume into).
  useEffect(() => {
    const code = mpResumeCodeRef.current;
    if (!code || !user || activeMatch) return;
    mpResumeCodeRef.current = null;
    void rejoinMatch(code, user.uid)
      .then((match) => {
        startNewGame(); // R15-bug — same solo-world reset as onMatchReady
        setActiveMatch(match);
        setOpponentMode('friend');
        setMpEndOutcome(null);
        mpSavedGameIdRef.current = null;
        mpWroteOutcomeRef.current = null;
        setView('game');
      })
      .catch(() => {
        try {
          localStorage.removeItem('subutai_mp_active');
        } catch {
          /* private mode */
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [watchingGame, setWatchingGame] = useState<WatchingGame | null>(null);
  const watchAutoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameBackupRef = useRef<GameBackup | null>(null);
  // V1 — every visit starts from a fresh chess960 position. The old fixed
  // seed 1 meant everyone's first game was the same RQKRNBBN board until
  // they pressed New game.
  const [seed, setSeed] = useState<number>(() => FIRST_SEED);
  // Local single-player engine state. In multiplayer (Q.B.2) the rest of
  // App reads through the `state` / `legalMoves` / `log` / `lastMove`
  // const aliases below, which swap to mpSync-derived values; the local
  // setters keep firing for safety but their writes are visually inert
  // because the aliases ignore them.
  const [stateLocal, setState] = useState<BoardState>(() => createStartingPosition(FIRST_SEED));
  const [initialState, setInitialState] = useState<BoardState>(() => createStartingPosition(FIRST_SEED));
  const [selected, setSelected] = useState<string | null>(null);
  const [legalMovesLocal, setLegalMoves] = useState<Move[]>(() =>
    generateLegalMoves(createStartingPosition(FIRST_SEED)),
  );
  const [logLocal, setLog] = useState<GameLog>(() =>
    createGameLog(`game-${FIRST_SEED}`, createStartingPosition(FIRST_SEED), FIRST_SEED),
  );
  const [gameStatus, setGameStatus] = useState<GameStatus>('active');
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const [lastMoveLocal, setLastMove] = useState<{ from?: SquareId; to?: SquareId } | null>(null);
  /**
   * V1 — mobile panels.
   *
   * On a phone the icon rail was folded into the header as a second row
   * of small targets and GAME SETUP was pushed below the board, where
   * nobody scrolled to find it. Both become off-canvas drawers instead:
   * the rail slides in from the left, the setup panel from the right, one
   * at a time, behind a scrim. Buttons rather than swipes — this is a web
   * page, a horizontal swipe belongs to the browser's back gesture, and a
   * control the user cannot see is a control they do not have.
   */
  const [mobilePanel, setMobilePanel] = useState<'none' | 'menu' | 'setup'>('none');
  const closeMobilePanel = useCallback(() => setMobilePanel('none'), []);
  useEffect(() => {
    if (mobilePanel === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobilePanel('none');
    };
    // A drawer is a narrow-screen idea. Growing past the breakpoint with
    // one open would leave the page scrimmed over a panel that is back in
    // the normal layout anyway.
    const onResize = () => {
      if (window.innerWidth > 720) setMobilePanel('none');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [mobilePanel]);

  const [showHelp, setShowHelp] = useState(false);
  // S2.2 — first-launch tour. Defaults to open until the user finishes
  // or skips it once; replayable from the Help dialog.
  /* V1 — the tour no longer ambushes a first-time visitor. The welcome
   * screen below runs first and the tour starts only if they ask for it
   * (or from Rules & info). Returning players who never finished it are
   * left alone. */
  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      // Anyone who already finished the old tour is not a first-timer.
      if (localStorage.getItem(TUTORIAL_DONE_KEY) === '1') return false;
      return localStorage.getItem(WELCOME_SEEN_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dismissWelcome = useCallback((startTour: boolean) => {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch { /* private mode — it will greet them again next visit */ }
    setShowWelcome(false);
    if (startTour) setShowTutorial(true);
  }, []);
  const closeTutorial = useCallback(() => {
    try {
      localStorage.setItem(TUTORIAL_DONE_KEY, '1');
    } catch { /* private mode — show it again next visit */ }
    setShowTutorial(false);
  }, []);
  /* V1 — busy overlay. Some transitions (leaving a replay, loading a saved
   * game) do their work inside one React commit, so the tab simply stops
   * repainting for a moment and reads as a hang. beginBusy paints a labelled
   * spinner first and clears it after the browser has had two frames plus a
   * short beat, which is long enough for the commit to land and short enough
   * that a fast machine sees a deliberate blink, not a stutter. */
  // V1 — the overlay itself lives in src/ui/busy.ts and is mounted next to
  // <App/>, so it exists on every screen, not only the board.
  const beginBusy = useCallback((label: string) => busy.begin(label), []);

  const [showMaterialPopup, setShowMaterialPopup] = useState(false);
  const [copied, setCopied] = useState(false);
  // Sprint 3.7 (rev 2) — Threat / Support toggles restored after the
  // 3.6 hover-insight experiment didn't stick. Manual toggles read
  // more like deliberate training aids than a hover gimmick.
  const [showThreats, setShowThreats] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // S2.4 — master switch for the coaching tools (support / threat / hint).
  // Players who want "pure" chess can collapse the whole group; persisted
  // so the choice survives reloads.
  const [helpToolsEnabled, setHelpToolsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('subutai_help_tools') !== '0';
    } catch {
      return true;
    }
  });
  // S2.4 — engine hint: best move for the current position, shown as a
  // pulsing from→to pair on the board. Cleared whenever the position
  // changes. `rotate: true` means the engine recommends Rotate itself.
  const [hintMove, setHintMove] = useState<
    { from: SquareId; to: SquareId } | { rotate: true } | null
  >(null);
  // T3 — Twitch overlay visibility (session-only; channel persists in
  // the panel itself).
  const [showTwitch, setShowTwitch] = useState(false);
  // T6 — mirrored vote mode so the chat-vs-bot scheduler effect below can
  // react when the streamer flips the mode pill in the Twitch panel.
  const [twitchVoteMode, setTwitchVoteMode] = useState<VoteMode>(() => moveVoting.getMode());
  useEffect(() => moveVoting.onMode(setTwitchVoteMode), []);
  // R1 — live vote round mirrored for the on-board variant arrows: each
  // candidate is drawn as a dashed arrow in its own color (matching the
  // !1..!4 slots), growing thicker as its votes come in.
  const [voteRound, setVoteRound] = useState<VoteRound | null>(() => moveVoting.getRound());
  useEffect(() => moveVoting.onRound(setVoteRound), []);
  // R2/R9 — chatters who called the streamer's move burst over the board
  // as a chaotic word-cloud of nicks (no plate): each nick gets a random
  // spot, size, tilt and stagger, floats up and fades. Randomisation is
  // rolled ONCE per reveal here, so re-renders don't reshuffle the cloud.
  const [guessCloud, setGuessCloud] = useState<
    {
      key: string;
      name: string;
      color: string;
      x: number; // % across the board
      y: number;
      size: number; // rem
      rot: number; // deg
      delay: number; // ms
    }[]
  >([]);
  const guessWinnersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceGuessWinners = useCallback((winners: GuessWinner[]) => {
    if (winners.length === 0) return;
    const shown = winners.slice(0, 24); // a storm of 24 nicks is plenty
    // Fewer winners read bigger; a packed cloud shrinks so nicks coexist.
    const base = shown.length <= 3 ? 1.7 : shown.length <= 8 ? 1.3 : 1.0;
    setGuessCloud(
      shown.map((w, i) => ({
        key: `${w.nick}-${i}`,
        name: w.displayName,
        color: w.color,
        x: 12 + Math.random() * 76,
        y: 14 + Math.random() * 62,
        size: base * (0.8 + Math.random() * 0.7),
        rot: -14 + Math.random() * 28,
        delay: Math.random() * 450,
      })),
    );
    if (guessWinnersTimer.current) clearTimeout(guessWinnersTimer.current);
    guessWinnersTimer.current = setTimeout(() => setGuessCloud([]), 5_200);
  }, []);
  // SP — Spotify dock visibility + whether the mic equalizer runs
  // (the perimeter ring mounts only while it does).
  const [showMusicDock, setShowMusicDock] = useState(false);
  const [vizOn, setVizOn] = useState(false);
  useEffect(() => micEq.onState(setVizOn), []);
  // M.15 — optional full-screen sound-grid background (toggled in the dock).
  const [bgGridOn, setBgGridOn] = useState(() => vizMode.isBgGrid());
  useEffect(() => vizMode.onChange(setBgGridOn), []);
  // M.10 — on-beat board pulse lives at App level (not in the dock) so
  // the board keeps reacting even when the music dock is closed or
  // minimised, as long as the beat grid is running.
  useEffect(() => {
    const pulseBoard = () => {
      const board = document.querySelector('.board-with-coords');
      if (!board) return;
      board.classList.remove('beat-tick');
      void (board as HTMLElement).offsetWidth; // restart the animation
      board.classList.add('beat-tick');
    };
    const offBeat = beatEngine.onBeat(() => {
      // M.21 — 'onmove' pulse mode: the ambient heartbeat rests; the
      // board reacts only when the PLAYER hits the beat (below).
      if (vizMode.getPulseMode() === 'onmove') return;
      // M.18 — live capture hearing silence ⇒ pause the visual heartbeat.
      // The grid keeps counting (a track pause/drop doesn't lose the lock);
      // only the pulse waits for the music to come back. File/Spotify
      // playback doesn't run the live detector, so it's unaffected.
      if (liveBpm.isRunning() && liveBpm.isSilent()) return;
      pulseBoard();
    });
    // M.21 — in tap mode an on-beat hit IS the pulse: the board answers
    // the player, not the metronome.
    const offMove = beatBridge.onMove((e) => {
      if (vizMode.getPulseMode() !== 'onmove') return;
      if (e.score === 'off') return;
      pulseBoard();
    });
    // M.21.1 — tap mode: ANY tap on the board is a rhythm hit. Scored in
    // beatBridge (points + streak); the onMove subscription above turns a
    // successful hit into the pulse. pointerdown (not click) so the hit
    // registers at touch time — rhythm can't wait for pointerup.
    const onPointerDown = (ev: PointerEvent) => {
      if (vizMode.getPulseMode() !== 'onmove') return;
      const target = ev.target as Element | null;
      if (!target?.closest('.board-with-coords')) return;
      beatBridge.reportTap();
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => {
      offBeat();
      offMove();
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);
  // S2.5 — per-side elapsed clocks. Pure UX (no flag-fall): the active
  // side's clock accumulates wall time while the game is live. Reset on
  // every new game log.
  const [clockMs, setClockMs] = useState<{ white: number; black: number }>({
    white: 0,
    black: 0,
  });
  // Design experiment (neon-stitch): optional solo time control in seconds.
  // null = free play (chips keep showing elapsed). With a value the chips
  // show remaining = tc - elapsed, floored at 0. Display-only in solo.
  const [soloTcSec, setSoloTcSec] = useState<number | null>(null);
  // V1 — bot strength. Persisted; mirrored in a ref because the AI
  // scheduler is a memoised callback that must read the live value.
  const [botLevel, setBotLevelState] = useState<BotStrength>(readInitialBotLevel);
  const botLevelRef = useRef<BotStrength>(botLevel);
  useEffect(() => {
    botLevelRef.current = botLevel;
  }, [botLevel]);
  function setBotLevel(next: BotStrength) {
    setBotLevelState(next);
    try {
      localStorage.setItem(BOT_LEVEL_KEY, next);
    } catch {
      /* private mode */
    }
  }
  const [previewLocked, setPreviewLocked] = useState(false);
  const [lockedPreviewTopology, setLockedPreviewTopology] = useState<TopologyState | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [formationLocked, setFormationLocked] = useState(false);
  const [lockedFormationKey, setLockedFormationKey] = useState<string | null>(null);
  const [formationInputMode, setFormationInputMode] = useState(false);
  const [formationInputValue, setFormationInputValue] = useState('');
  const [showReplayDialog, setShowReplayDialog] = useState(false);
  const [replayText, setReplayText] = useState('');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: SquareId;
    to: SquareId;
  } | null>(null);
  const [gameModeLocal, setGameMode] = useState<GameMode>('classic');
  // PvP gameMode flows from the match doc — host picks it at create time.
  // Q.D.2: reuse the SAME solo roulette UI/logic by aliasing gameMode,
  // allowedPieceTypes, rouletteActionsLeft, etc. through to MP-derived
  // values. Single-player still drives those from local state below.
  const gameMode: GameMode = isMultiplayer
    ? mpSync?.isRouletteMode
      ? 'roulette'
      : 'classic'
    : gameModeLocal;
  // Q.D.8: roulette is now a capture-the-king variant — no check enforcement.
  // Every legal-move query routes through this wrapper so the option flips
  // automatically based on mode. Classic mode always returns the strict
  // check-respecting set; roulette returns pseudo-legal verbatim.
  function getLegalMoves(s: BoardState): Move[] {
    return generateLegalMoves(s, { allowSelfCheck: gameMode === 'roulette' });
  }
  const [allowedPieceTypesLocal, setAllowedPieceTypes] = useState<PieceType[] | null>(null);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState<boolean>(false);
  const [rouletteActionsLeftLocal, setRouletteActionsLeft] = useState<number>(0);
  const [usedRouletteSlotsLocal, setUsedRouletteSlots] = useState<number[]>([]);
  // First roulette spin per game requires a manual click on the Spin
  // Roulette button. Subsequent spins auto-fire via a useEffect after a
  // short delay. Tracking just the boolean is enough — no pending-callback
  // state, no banner: the existing button stays the single spin UI.
  const [firstRouletteSpinDoneLocal, setFirstRouletteSpinDone] = useState(false);
  // First 3 spins of a game weight pawn slightly higher so beginners ease in
  // with familiar piece moves instead of front-loaded knight chaos.
  const [rouletteSpinCountLocal, setRouletteSpinCount] = useState(0);
  // Stage T1: square that just had a pawn taken via en passant — paints a
  // brief explosion overlay so the off-target capture is visually obvious.
  // R17a — cinema micro-FX: spark burst on the capture square + a brief
  // board jitter. Driven off the shared log (same pattern as the EP
  // explosion below) so human, AI, chat and PvP captures all fire it.
  const [captureFxSquare, setCaptureFxSquare] = useState<SquareId | null>(null);
  const [captureShake, setCaptureShake] = useState(false);
  // R17c — storyboard "big capture" strobe: two flash frames when a QUEEN
  // or ROOK is taken (plain captures only). Color codes the loss —
  // queen reads red, rook reads electric blue. Kept under 3 flashes/sec
  // for photosensitivity; reduced-motion hides it entirely.
  const [captureStrobe, setCaptureStrobe] = useState<
    'queen' | 'rook' | 'bishop' | 'knight' | null
  >(null);
  // R17c — rotation dust wave: an expanding shockwave ring when a topology
  // rotation commits (human, AI, chat or PvP — all come through the log).
  const [rotationDust, setRotationDust] = useState(false);
  // R17b — red vignette pulse when a REAL check lands (preview-induced
  // "checks" from the rotation eye are ignored).
  const [checkVignette, setCheckVignette] = useState(false);
  /**
   * V1 — the loudness governor.
   *
   * Every heavy move still gets its full vocabulary — the shake, the
   * strobe on a big capture, the red vignette on a check — because that
   * is how the board says "that one hurt". What changes is the volume
   * when they arrive back to back: an exchange, a check, a recapture used
   * to stack three full-strength effects into a board nobody could read.
   *
   * So each effect registers here first and gets a level: the first in a
   * window plays at 100%, the next at 60%, and anything after that at
   * 40%. Quieter, never silent — the player still feels each one. The
   * window resets once the board has been calm for FX_WINDOW_MS.
   */
  const fxRecentRef = useRef<number[]>([]);
  const [fxIntensity, setFxIntensity] = useState(1);
  const registerFx = useCallback((): number => {
    const now = Date.now();
    const recent = fxRecentRef.current.filter((t) => now - t < FX_WINDOW_MS);
    recent.push(now);
    fxRecentRef.current = recent;
    const level = recent.length <= 1 ? 1 : recent.length === 2 ? 0.6 : 0.4;
    setFxIntensity(level);
    return level;
  }, []);
  // R17b — the storyboard's "зрив темпу": a dim freeze-frame beat before
  // the victory cinematic slams in.
  const [victoryFreeze, setVictoryFreeze] = useState(false);
  const victoryFreezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enPassantExplosionSquare, setEnPassantExplosionSquare] =
    useState<SquareId | null>(null);

  // -------- Q.B.2: read-side aliases for multiplayer mode -----------------
  // When isMultiplayer the board / log / legal-moves come from the live
  // Firestore doc via mpSync. Writers (setState/setLog/...) still target
  // local state — they're effectively dead writes in MP because the
  // aliases below ignore them, and every write path is guarded by
  // isMultiplayer anyway.
  // Q.D.3: in MP roulette an action mid-turn flips boardState.sideToMove
  // (the engine doesn't know we're keeping the same player on the clock
  // for a second action). Solo solves this by clamping; here we clamp at
  // alias time so generateLegalMoves below produces MY pieces' moves
  // for action 2 instead of the opponent's.
  const state: BoardState = (() => {
    if (!isMultiplayer) return stateLocal;
    const base = mpSync!.boardState;
    if (
      mpSync!.isRouletteMode &&
      mpSync!.isMyTurn &&
      mpSync!.rouletteActionsLeft > 0 &&
      base.sideToMove !== mpSync!.myColor
    ) {
      return { ...base, sideToMove: mpSync!.myColor };
    }
    return base;
  })();
  const log: GameLog = isMultiplayer
    ? deriveMpLog(mpSync!.matchState)
    : logLocal;
  const legalMoves: Move[] = isMultiplayer
    ? getLegalMoves(state)
    : legalMovesLocal;
  const lastMove: { from?: SquareId; to?: SquareId } | null = isMultiplayer
    ? deriveMpLastMove(mpSync!.matchState)
    : lastMoveLocal;
  // Q.D.3: roulette state aliases for MP. The live match doc carries the
  // full 4-slot bag, action counter, and used-slot indices — so the same
  // solo UI (Spin button, slot chips, "Move a knight" hint) renders
  // verbatim in PvP roulette without any new components.
  const allowedPieceTypes: PieceType[] | null =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.rouletteSlots
      : allowedPieceTypesLocal;
  const rouletteActionsLeft: number =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.rouletteActionsLeft
      : rouletteActionsLeftLocal;
  const usedRouletteSlots: number[] =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.usedRouletteSlots
      : usedRouletteSlotsLocal;
  // Per-player gate: solo uses a local boolean reset in startNewGame; MP
  // reads my spin count off the match doc so both players track
  // independently across reloads.
  const firstRouletteSpinDone: boolean =
    isMultiplayer && mpSync && user
      ? (mpSync.matchState.rouletteSpinsByPlayer?.[user.uid] ?? 0) > 0
      : firstRouletteSpinDoneLocal;
  const rouletteSpinCount: number =
    isMultiplayer && mpSync?.isRouletteMode
      ? mpSync.matchState.rouletteSpinCount ?? 0
      : rouletteSpinCountLocal;
  const formationInputRef = useRef<HTMLInputElement>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // SP-3 — true while a Beat-Mode move is queued to land on the next
  // beat; blocks board input so the snap can't be raced.
  const beatSnapPendingRef = useRef(false);
  // M.12 — the queued snap target (from/to + ms to the beat) so the UI
  // can show a ring filling to the beat for a crisp, on-beat landing.
  const [beatSnap, setBeatSnap] = useState<{ from: SquareId; to: SquareId; ms: number } | null>(null);
  // Stage P addendum 7: wall-clock when the current game began. Used to
  // compute durationMs on save. Set in startNewGame (and on initial mount
  // for the first game).
  const gameStartedAtRef = useRef<number>(Date.now());
  const savedForLogIdRef = useRef<string | null>(null);
  const liveSavedGameIdRef = useRef<string>(
    `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // --- Dynamic evaluation + background --------------------------------------
  // Search-backed eval (White-perspective, centipawns) gets pushed in by the
  // classifier after every move. While null (start-of-game / fresh reset)
  // we fall back to the static evaluator so the bar isn't blank.
  const [searchEvalFromWhite, setSearchEvalFromWhite] = useState<number | null>(null);
  // Set when the search found a forced mate from the post-move position.
  const [searchMateInPlies, setSearchMateInPlies] = useState<number | null>(null);
  // currentEval is the canonical WHITE-perspective centipawn score. The
  // engine, classifier, prev-eval delta tracking and any future
  // server-side persistence all want this monotonic shape.
  const currentEval = useMemo(() => {
    if (isMultiplayer) return evaluateFromWhite(state);
    if (searchEvalFromWhite !== null) return searchEvalFromWhite;
    return evaluateFromWhite(state);
  }, [isMultiplayer, searchEvalFromWhite, state]);

  // T5: viewer-perspective eval — positive = "I'm winning". Drives the
  // background gradient AND the eval-bar fill so the player who's behind
  // sees a cool/crimson room and a near-empty bar, while their opponent
  // simultaneously sees gold + a near-full bar. Single-player path is
  // myColor='white' so this is a no-op there.
  const myColor: 'white' | 'black' =
    isMultiplayer && mpSync ? mpSync.myColor : 'white';
  const myPerspectiveEval = useMemo(
    () => (myColor === 'black' ? -currentEval : currentEval),
    [currentEval, myColor],
  );
  // Previous eval — kept for delta comparisons used by the classifier.
  const prevEvalRef = useRef<number>(currentEval);
  // The element whose CSS variables drive the gradient. Setting via ref
  // (rather than inline style) so React doesn't churn the style object every
  // render and break the @property transition.
  const shellRef = useRef<HTMLDivElement>(null);
  // Worker-backed classify can resolve AFTER subsequent moves have been
  // played — we read this ref in each .then() to decide whether the analysis
  // is still "current" (visuals fire) or stale (log patched, visuals skipped).
  const logLengthRef = useRef<number>(0);

  // R3 — reserved side columns when the Twitch / music panels are docked
  // into the layout (not floating). The board sizes down by them so it
  // never hides behind a panel; the shell pads by them so content slides.
  const [dock, setDock] = useState<DockState>(() => dockLayout.get());
  useEffect(() => dockLayout.on(setDock), []);

  // R14 — manual UI scale (0.8–1.5×), persisted. Applied as CSS zoom on
  // <body>, so every panel (portaled ones included) grows with it; the
  // board-size math below divides the viewport by it since layout then
  // happens in zoomed coordinates.
  const [uiScale, setUiScale] = useState<number>(() => {
    try {
      const v = Number.parseFloat(localStorage.getItem('subutai_ui_scale') ?? '1');
      return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1;
    } catch {
      return 1;
    }
  });
  useEffect(() => {
    (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      uiScale === 1 ? '' : String(uiScale);
    return () => {
      (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = '';
    };
  }, [uiScale]);
  const pickUiScale = useCallback((v: number) => {
    const clamped = Math.max(0.8, Math.min(1.5, v));
    setUiScale(clamped);
    try {
      localStorage.setItem('subutai_ui_scale', String(clamped));
    } catch {
      /* private mode */
    }
  }, []);

  // R14 — the cap is no longer a flat 520: it follows the viewport
  // (70% of height, up to 820) so big monitors actually get a big board.
  // Docks start closed, so reserving nothing for them on the very first
  // paint is correct; the effect below re-runs the moment one opens.
  const [boardSize, setBoardSize] = useState(() => computeBoardSize(uiScale, 0, 0));

  useEffect(() => {
    const recompute = () =>
      setBoardSize(computeBoardSize(uiScale, dock.left, dock.right));
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [dock, uiScale]);

  // R5 — encouragement in a losing position.
  const toast = useToast();

  // R16 — presence heartbeat feeds the quick-match "online now" counter.
  // Signed-in users only (same gate as everything matchmaking touches).
  useEffect(() => {
    if (!user || !displayName) return;
    startPresenceHeartbeat(user.uid);
    return () => stopPresenceHeartbeat();
  }, [user, displayName]);

  // V1 — the solo time-control flag-fall effect lives further down, right
  // after `isLocalMode` is declared (TDZ: hooks here can't read it yet).
  const encourageBadStreakRef = useRef(0);
  const encourageLastMoveRef = useRef(-99);
  const encourageCheckedMoveRef = useRef(-1);
  const [encourageRotate, setEncourageRotate] = useState(false);
  // R15 step 4-lite — one-shot-per-game coaching beats, deduped by log.id
  // (fresh id per game, survives re-renders).
  const earlyTipLogIdRef = useRef<string | null>(null);
  const rotateTipLogIdRef = useRef<string | null>(null);

  // R6 — worst eval the human faced this game (most negative from white's
  // side). A tense, come-from-behind win triggers the victory cinematic.
  const worstHumanEvalRef = useRef(0);
  // V1 — the endgame cut currently on screen (win or loss), or null.
  // `king` is where the losing king stood, in viewport pixels, so the
  // cinematic can start by lifting THAT piece off THAT square; `prelude`
  // is the dark lead-in the scene has to play itself when the checkmate
  // iris did not already black the room out.
  // The launcher lives further down, next to mateKingPos — it needs the
  // king's board position and that is declared around line 4400 (TDZ).
  const [endgameCut, setEndgameCut] = useState<{
    kind: EndgameKind;
    theme: VictoryTheme;
    king: KingOrigin | null;
    prelude: number;
  } | null>(null);
  useEffect(() => {
    if (searchEvalFromWhite !== null && searchEvalFromWhite < worstHumanEvalRef.current) {
      worstHumanEvalRef.current = searchEvalFromWhite;
    }
  }, [searchEvalFromWhite]);
  // Console seams — preview the big moments on demand without having to
  // play them out for real. Attached in production too (harmless hidden
  // globals) so they work on the live site's DevTools:
  //   subutaiEncourage()                          — a losing-position nudge
  //                                                 (+ pulses the Rotate btn)
  //   subutaiFX.check()                           — the red check vignette
  //   subutaiFX.strobe('queen'|'rook'|'bishop'|'knight') — the capture strobe
  //   subutaiFX.dust()                             — the rotation dust wave
  //   subutaiFX.mate()                             — the checkmate iris
  // The FX ones normally fire only off real game events (a landed check,
  // a non-pawn capture, a committed rotation, an actual mate) — there was
  // no way to QA them without playing a whole line out. This exposes the
  // same setters the real triggers use, so a reviewer can fire each one
  // in isolation. (subutaiFX.mate and the endgame cinematics — subutai
  // Victory / subutaiDefeat / subutaiEndgame — are attached by a separate
  // effect further down, once mateKingPos exists; it merges onto this
  // same object.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const encourage = () => {
      const pool = Math.random() < 0.5 ? ENCOURAGE_ROTATE : ENCOURAGE_GENERIC;
      toast.show(pool[Math.floor(Math.random() * pool.length)], 'info', 5200);
      setEncourageRotate(true);
      window.setTimeout(() => setEncourageRotate(false), 5200);
    };
    const fx = {
      check: () => {
        setCheckVignette(true);
        window.setTimeout(() => setCheckVignette(false), 900);
      },
      strobe: (piece: 'queen' | 'rook' | 'bishop' | 'knight' = 'queen') => {
        setCaptureStrobe(piece);
        window.setTimeout(() => setCaptureStrobe(null), 760);
      },
      dust: () => {
        setRotationDust(true);
        window.setTimeout(() => setRotationDust(false), 780);
      },
    };
    const w = window as unknown as {
      subutaiEncourage?: () => void;
      subutaiFX?: typeof fx;
    };
    w.subutaiEncourage = encourage;
    w.subutaiFX = fx;
  }, [toast]);

  useEffect(() => {
    if (formationInputMode) formationInputRef.current?.focus();
  }, [formationInputMode]);

  useEffect(() => {
    if (isMultiplayer) return; // PvP games persist via /games, not local Memory
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (savedForLogIdRef.current === log.id) return;

    const sourceId = liveSavedGameIdRef.current;
    const resigned = gameStatus === 'resigned_white' || gameStatus === 'resigned_black';
    const termination: 'checkmate' | 'stalemate' | 'resignation' = resigned
      ? 'resignation'
      : gameStatus === 'checkmate'
        || gameStatus === 'king_captured_white_wins'
        || gameStatus === 'king_captured_black_wins'
        || gameStatus === 'timeout_white'
        || gameStatus === 'timeout_black'
        ? 'checkmate'
        : 'stalemate';
    const saved = buildSavedGameFromLog(
      log,
      state,
      termination,
      sourceId,
      resigned ? (gameStatus === 'resigned_white' ? 'black' : 'white') : undefined,
      importedLogIdRef.current === log.id,
    );
    if (localStorageAdapter.saveOrUpdateGame) {
      localStorageAdapter.saveOrUpdateGame(saved);
    } else {
      localStorageAdapter.saveGame(saved);
    }

    // Clean up the live snapshot so Memory shows one final entry.
    if (sourceId) {
      localStorageAdapter.deleteGame?.(sourceId);
    }

    savedForLogIdRef.current = log.id;
  }, [gameStatus, log, state]);

  useEffect(() => {
    if (isMultiplayer) return; // no local Memory snapshots during PvP
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    const liveId = liveSavedGameIdRef.current;
    if (!liveId) return;
    const snapshot = buildSavedGameSnapshot(log, liveId, importedLogIdRef.current === log.id);
    if (localStorageAdapter.saveOrUpdateGame) {
      localStorageAdapter.saveOrUpdateGame(snapshot);
    } else {
      localStorageAdapter.saveGame(snapshot);
    }
    // V1 — and a pointer saying "this is the game in progress", with the
    // settings a Memory entry does not carry. Resuming a hot-seat game as
    // a bot game would hand black's moves to the engine.
    writeLiveSession({
      gameId: liveId,
      opponentMode: opponentMode === 'local' ? 'local' : 'ai',
      gameMode,
      timed: soloTcSec !== null,
      savedAt: Date.now(),
      botLevel,
    });
  }, [gameStatus, log, isMultiplayer, opponentMode, gameMode, soloTcSec, botLevel]);

  // The pointer only means anything while that game is still going. It
  // goes when the game ends — and when a FRESH board replaces it (new game,
  // new position, a replay), or a reload would bring back the game that was
  // just abandoned. Not on the first render, though: that is the empty board
  // every page load starts with, and the resume below has not read the
  // pointer yet.
  const mountLogIdRef = useRef(log.id);
  useEffect(() => {
    if (isMultiplayer) return;
    const freshBoardReplacedIt = log.moves.length === 0 && log.id !== mountLogIdRef.current;
    if (gameStatus !== 'active' || freshBoardReplacedIt) clearLiveSession();
  }, [gameStatus, log.id, log.moves.length, isMultiplayer]);

  // Game-completion pipeline: detects terminal gameStatus transitions, computes
  // points, opens the GameSummary modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode + deps that move together).
  // Auto mode handles completion via its own effect — never enters this path.
  useEffect(() => {
    if (isAutoMode) return;
    if (isMultiplayer) return; // MP completion runs through a separate effect
    // R13/BUG-5 — local hot-seat is two humans on one device: its results
    // must never reach finishGame (solo leaderboard, personal best,
    // "human-win" attribution are all meaningless there). The game-over
    // banner is the whole ending.
    if (isLocalMode) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    // One completion per game, keyed by the log id alone. Resign stamps the
    // id itself before flipping the status, so it is skipped here too. This
    // used to also bail on any gameOutcome, which leaked the previous
    // game's ending into the next one (QA-01).
    if (completedLogIdRef.current === log.id) return;
    completedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      // Black wins => human (white) lost.
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
      outcome = 'human-win';
    } else if (gameStatus === 'timeout_white') {
      // V1 — human (white) flagged.
      outcome = 'ai-win';
    } else if (gameStatus === 'timeout_black') {
      outcome = 'human-win';
    } else {
      outcome = 'draw';
    }
    void finishGame(outcome);
    // finishGame closes over current state/log/user/displayName; we want this
    // to fire once per terminal transition, hence the ref-guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus, log.id, log.moves.length, isAutoMode]);

  // ---- Q.B.2 multiplayer: terminal detection + host /games save ----------
  // Runs whenever the live match changes. If the board reached mate/draw,
  // first peer to notice writes the outcome (transaction-guarded). When
  // status flips to completed, the host saves a /games doc once.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'active') return;
    if (match.outcome) return;
    if (mpWroteOutcomeRef.current === match.code) return;
    const board = mpSync.boardState;
    let outcome: MatchOutcome | null = null;
    if (mpSync.isRouletteMode) {
      // Q.D.8: roulette is capture-the-king. Whichever king is missing,
      // the OTHER side wins. No checkmate / stalemate / draw rules apply
      // here — the variant deliberately collapses every termination path
      // to "king on the board → game continues; king gone → game over".
      if (!findKing(board, 'white')) outcome = 'black-win';
      else if (!findKing(board, 'black')) outcome = 'white-win';
    } else {
      if (isCheckmate(board)) {
        outcome = board.sideToMove === 'white' ? 'black-win' : 'white-win';
      } else if (checkDrawConditions(board) !== null) {
        outcome = 'draw';
      }
    }
    if (!outcome) return;
    mpWroteOutcomeRef.current = match.code;
    void mpSync.writeOutcomeIfFirst(outcome);
  }, [isMultiplayer, mpSync]);

  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const match = mpSync.matchState;
    if (match.status !== 'completed' || !match.outcome) return;
    // Show local completion modal exactly once per terminal transition.
    if (mpEndOutcome !== match.outcome) {
      setMpEndOutcome(match.outcome);
    }
    // R13 host-gone fix: each peer saves their OWN /games record (idempotent
    // via deterministic doc id inside the helper), so the record survives
    // the other player vanishing at game end. Ref-guard just stops in-session
    // re-attempts.
    if (user && mpSavedGameIdRef.current !== match.code) {
      mpSavedGameIdRef.current = match.code;
      void saveMultiplayerGameToGames(match, user.uid).catch((err) => {
        console.error('[mp] save to /games failed', err);
        // QA-22 (last point) — a real refusal no longer disappears silently.
        toast.show('This match could not be saved to your games.', 'error', 5000);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiplayer, mpSync?.matchState.status, mpSync?.matchState.outcome]);

  // T2: load a shared game on mount when ?game=<id> is in the URL. Bypasses
  // every game/match flow — drops directly into the Review screen with
  // metadata derived from the doc. Shared games are read-only; the back
  // button strips the param so a refresh returns to the normal app.
  useEffect(() => {
    if (!sharedGameId) return;
    let cancelled = false;
    void fetchSavedGame(sharedGameId)
      .then((saved) => {
        if (cancelled || !saved) {
          if (!cancelled) setSharedGameError('Game not found.');
          return;
        }
        const loadedLog = deserializeGameLog(saved);
        const playerLabel = saved.playerName || 'Player';
        const opponentLabel = saved.vsAI
          ? 'AI'
          : ((saved as unknown as { opponentName?: string }).opponentName ??
            'Opponent');
        setActiveReviewLog(loadedLog);
        setActiveReviewMeta({
          playerName: playerLabel,
          opponentName: opponentLabel,
          outcome: saved.outcome,
        });
        setView('review');
      })
      .catch((err) => {
        console.error('[shared-game] fetch failed', err);
        if (!cancelled) setSharedGameError('Could not load shared game.');
      });
    return () => {
      cancelled = true;
    };
  }, [sharedGameId]);

  async function finishGame(outcome: GameOutcome) {
    const computed = computeGamePoints(log, outcome, HUMAN_COLOR, gameMode);
    // V1 — only full-strength games are ranked. Practice levels still get
    // the full breakdown on screen and are saved (with their level) for the
    // data pipeline, but never touch personal best / leaderboard stats.
    const rankedLevel = botLevel === 'strong';
    // QA-02 — nor is a game loaded from a pasted log, at any level: its
    // moves were never played here. counted: false also keeps strongWins
    // (gated on counted in saveCompletedGame) from growing.
    const imported = importedLogIdRef.current === log.id;
    setLastGameImported(imported);
    const points: GamePoints = rankedLevel && !imported ? computed : { ...computed, counted: false };
    const durationMs = Date.now() - gameStartedAtRef.current;
    setGameOutcome(outcome);
    setLastGamePoints(points);
    setLastGameDurationMs(durationMs);
    setSummaryOpen(true);
    setSaveError(null);
    setIsNewBest(false);
    setCurrentRank(null);

    if (!user || !displayName) {
      // Not signed in / no name yet — show summary locally and skip Firestore.
      return;
    }

    setSavingGame(true);
    try {
      // Snapshot the pre-write best so the modal can show "old" alongside new.
      const oldBest = await getPersonalBest(user.uid, gameMode);
      setPersonalBest(oldBest);

      const { gameId, isNewBest: nb, newRank } = await saveCompletedGame({
        uid: user.uid,
        displayName,
        log,
        outcome,
        points,
        chess960Id: positionLabel,
        seed,
        humanColor: HUMAN_COLOR,
        gameMode,
        durationMs,
        botLevel,
      });
      setLastGameId(gameId);
      setIsNewBest(nb);
      setCurrentRank(newRank);
      if (nb) setPersonalBest(points.total);
    } catch (err) {
      console.error('[finishGame] save failed', err);
      // QA-03 — a refusal by the rules is not a connection problem, and
      // telling the player to check their connection sent them the wrong way.
      const denied = (err as { code?: unknown } | null)?.code === 'permission-denied';
      setSaveError(
        denied
          ? 'This game wasn’t counted: the server refused to save it.'
          : 'Could not save this game. Check your connection.',
      );
    } finally {
      setSavingGame(false);
    }
  }

  // Auto-mode completion: when a self-play game ends, save to
  // /training_games (separate collection from the human leaderboard) and
  // queue the next game. Bypasses the regular finishGame path entirely.
  useEffect(() => {
    if (!isAutoMode) return;
    if (autoStopped) return;
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (autoSavedLogIdRef.current === log.id) return;
    autoSavedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      // The side now to move was just checkmated. White=human alias gives us
      // a "human-win"/"ai-win" mapping consistent with the rest of the codebase.
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
      outcome = 'human-win';
    } else {
      outcome = 'draw';
    }
    const moveCount = Math.floor(log.moves.length / 2);
    const finalEvalFromWhite =
      state.sideToMove === 'white' ? evaluate(state) : -evaluate(state);

    setAutoLastOutcome(outcome);
    setAutoGamesCompleted((n) => n + 1);
    setAutoMoveHistory((prev) => {
      const next = [...prev, moveCount];
      // Keep the rolling average bounded.
      return next.length > 50 ? next.slice(-50) : next;
    });

    void saveTrainingGame({
      log,
      chess960Id: backRankString(initialState),
      seed,
      outcome,
      moveCount,
      finalEvalFromWhite,
      aiVersion: AI_VERSION,
      durationMs: Date.now() - gameStartedAtRef.current,
    }).catch((err) => {
      console.error('[autoplay] saveTrainingGame failed', err);
    });

    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    autoNextGameTimerRef.current = setTimeout(() => {
      startNewGame();
    }, AUTO_BETWEEN_GAMES_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped, gameStatus, log.id, log.moves.length]);

  // Capped-run stop: once the requested number of games is reached, stop
  // queuing new ones. The current game finishes saving but the loop ends.
  useEffect(() => {
    if (!isAutoMode || maxGames <= 0 || autoStopped) return;
    if (autoGamesCompleted >= maxGames) {
      setAutoStopped(true);
      setAutoStoppedReason(`Done. ${autoGamesCompleted} games completed.`);
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    }
  }, [autoGamesCompleted, maxGames, isAutoMode, autoStopped]);

  // Watchdog: if no move has been made in 60s, the AI has hung (rare). Reset.
  useEffect(() => {
    if (!isAutoMode || autoStopped) return;
    const id = setInterval(() => {
      if (Date.now() - autoLastMoveAtRef.current > AUTO_WATCHDOG_MS) {
        console.warn('[autoplay] watchdog: no move in 60s, forcing new game');
        autoLastMoveAtRef.current = Date.now();
        autoSavedLogIdRef.current = null;
        startNewGame();
      }
    }, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoMode, autoStopped]);

  // Clear auto timers on unmount.
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    };
  }, []);

  function stopAuto() {
    setAutoStopped(true);
    setAutoStoppedReason('Stopped by user.');
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (autoNextGameTimerRef.current) clearTimeout(autoNextGameTimerRef.current);
    // Navigate back to the clean URL so a reload exits auto mode entirely.
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('auto');
      url.searchParams.delete('max');
      window.location.href = url.toString();
    }, 400);
  }

  // Replay the first `moveCount` entries of a log on top of its initialState.
  // Returns the resulting BoardState — used by watching-mode to project the
  // current frame without mutating the underlying log.
  function replayBoardAt(replayLog: GameLog, moveCount: number): BoardState {
    let cur: BoardState = replayLog.initialState;
    const cap = Math.min(moveCount, replayLog.moves.length);
    for (let i = 0; i < cap; i++) {
      const mv = replayLog.moves[i].move;
      if (mv.kind === 'topologyToggle') {
        cur = applyRotationMove(cur);
      } else {
        cur = applyMove(cur, mv);
      }
    }
    return cur;
  }

  async function startWatching(gameId: string, playerName: string) {
    // S2.1 — while a multiplayer match is live, the board is driven by
    // mpSync.boardState, so the replay projection below would clobber
    // log/gameStatus while the board keeps showing the match: a
    // split-brain. The Leaderboard disables Watch in that case; this is
    // the backstop.
    if (isMultiplayer) return;
    try {
      const saved = await fetchSavedGame(gameId);
      if (!saved) {
        console.warn('[watch] game not found', gameId);
        return;
      }
      const replayLog = deserializeGameLog(saved);

      // Snapshot current game so Stop can restore it exactly.
      gameBackupRef.current = {
        seed,
        state,
        initialState,
        legalMoves,
        log,
        gameStatus,
        lastMove,
        liveSavedGameId: liveSavedGameIdRef.current,
        savedForLogId: savedForLogIdRef.current,
        completedLogId: completedLogIdRef.current,
        searchEvalFromWhite,
        searchMateInPlies,
        formationLocked,
        lockedFormationKey,
      };

      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      if (watchAutoplayRef.current) clearTimeout(watchAutoplayRef.current);

      // Project frame 0 of the replay.
      const projected = replayBoardAt(replayLog, 0);
      setState(projected);
      setInitialState(replayLog.initialState);
      setSeed(replayLog.randomSeed);
      setLegalMoves(getLegalMoves(projected));
      setLog({ ...replayLog, moves: [] });
      setSelected(null);
      setGameStatus('active');
      setLastMove(null);
      setPreviewTopology(null);
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      // Block the completion-watcher effect from firing on this log id.
      completedLogIdRef.current = replayLog.id;

      setView('game');
      setWatchingGame({
        log: replayLog,
        playerName,
        gameId,
        currentMoveIdx: 0,
        autoplay: false,
      });
    } catch (err) {
      console.error('[watch] startWatching failed', err);
    }
  }

  function seekWatchTo(idx: number) {
    setWatchingGame((cur) => {
      if (!cur) return cur;
      const clamped = Math.max(0, Math.min(idx, cur.log.moves.length));
      const projected = replayBoardAt(cur.log, clamped);
      setState(projected);
      setLog({ ...cur.log, moves: cur.log.moves.slice(0, clamped) });
      setLegalMoves(getLegalMoves(projected));
      setSelected(null);
      const lastEntry = clamped > 0 ? cur.log.moves[clamped - 1] : null;
      if (lastEntry && lastEntry.move.from && lastEntry.move.to) {
        setLastMove({ from: lastEntry.move.from, to: lastEntry.move.to });
      } else {
        setLastMove(null);
      }
      return { ...cur, currentMoveIdx: clamped };
    });
  }

  function toggleWatchAutoplay() {
    setWatchingGame((cur) => (cur ? { ...cur, autoplay: !cur.autoplay } : cur));
  }

  function stopWatching() {
    if (watchAutoplayRef.current) {
      clearTimeout(watchAutoplayRef.current);
      watchAutoplayRef.current = null;
    }
    const backup = gameBackupRef.current;
    // V1 — restoring the paused game re-derives the board, legal moves and
    // eval in one commit, which can visibly stall on a slow machine. Cover
    // it so the app never looks frozen with no explanation.
    beginBusy('Restoring your game');
    setWatchingGame(null);
    if (!backup) return;

    setSeed(backup.seed);
    setState(backup.state);
    setInitialState(backup.initialState);
    setLegalMoves(backup.legalMoves);
    setLog(backup.log);
    setGameStatus(backup.gameStatus);
    setLastMove(backup.lastMove);
    setFormationLocked(backup.formationLocked);
    setLockedFormationKey(backup.lockedFormationKey);
    setSearchEvalFromWhite(backup.searchEvalFromWhite);
    setSearchMateInPlies(backup.searchMateInPlies);
    setSelected(null);
    liveSavedGameIdRef.current = backup.liveSavedGameId;
    savedForLogIdRef.current = backup.savedForLogId;
    completedLogIdRef.current = backup.completedLogId;
    gameBackupRef.current = null;
  }

  /** QA-11 — `side` is the seat whose Resign was pressed (hot-seat has
   *  one per player). Solo it is always the human; online the match knows. */
  function requestResign(side?: Color) {
    if (watchingGame) return;
    if (isMultiplayer) {
      if (!mpSync || mpSync.matchState.status !== 'active') return;
      setConfirmingResign(mpSync.myColor);
      return;
    }
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    // Solo, the bot's move is in flight: resigning now would race it (the
    // move still landed afterwards). The button is disabled meanwhile.
    if (botThinking) return;
    setConfirmingResign(isLocalMode ? side ?? state.sideToMove : HUMAN_COLOR);
  }

  function confirmResign() {
    const side = confirmingResign;
    setConfirmingResign(null);
    // PvP resign: route through the match doc so the opponent sees the
    // status flip; their listener will mirror the outcome. Local engine
    // state stays untouched (gameStatus etc.).
    if (isMultiplayer) {
      if (!mpSync) return;
      mpSelfResignedRef.current = mpSync.matchState.code;
      void mpSync.resign();
      return;
    }
    if (!side || gameStatus !== 'active' || botThinking) return;
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    // Stamped before the status flips, so the completion effect skips it.
    completedLogIdRef.current = log.id;
    setGameStatus(side === 'white' ? 'resigned_white' : 'resigned_black');
    // R13/BUG-5 — hot-seat resign: either seat may press it, so a solo
    // "human-resign" record would blame the wrong player half the time.
    // Just end the game; the banner is the ending, nothing is saved.
    if (isLocalMode) return;
    setGameOutcome('human-resign');
    void finishGame('human-resign');
  }

  // M.23 — evalToColors reads document.documentElement's data-theme
  // attribute imperatively (see the wood-light branch), but ThemeToggle
  // lives in a separate component and writes that attribute directly to
  // the DOM, not through any state this component subscribes to. Without
  // this, switching themes wouldn't repaint the eval-gradient until the
  // NEXT eval/topology change happened to fire the effect below for an
  // unrelated reason — a switch to/from wood-light would visibly lag.
  // themeTick just forces that effect to re-run the instant the attribute
  // actually changes.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Drive the gradient via CSS custom properties. setProperty (rather than
  // inline style) lets the @property-registered transition interpolate
  // colour-to-colour smoothly. prevEvalRef tracks the white-POV value
  // (classifier delta still expects white-POV).
  //
  // T5: paint from the viewer's perspective so each peer in a PvP match
  // sees their OWN winning/losing state — the player who's ahead gets
  // gold/warm, the player who's behind gets crimson/cool, simultaneously.
  //
  // "Rotation changes the room" — keyed off state.topologyState (the
  // COMMITTED board), never previewTopology. A hover-preview of the
  // rotate button is exploratory and reversible; repainting the whole
  // page's mood off a mere hover would feel unstable. The room only
  // shifts once a rotation actually lands, same rule R17c's dust-wave FX
  // already follows.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const { c1, c2 } = evalToColors(myPerspectiveEval, state.topologyState);
    shell.style.setProperty('--eval-c1', c1);
    shell.style.setProperty('--eval-c2', c2);
    prevEvalRef.current = currentEval;
  }, [myPerspectiveEval, currentEval, view, activeMatch, state.topologyState, themeTick]);

  // Keep logLengthRef in sync with committed log state — used by classify
  // .then handlers to decide if their analysis is still the latest.
  useEffect(() => {
    logLengthRef.current = log.moves.length;
  }, [log.moves.length]);

  // Watching-mode autoplay: when enabled, advances one move every
  // WATCH_AUTOPLAY_MS until we hit the end of the replay.
  useEffect(() => {
    if (!watchingGame || !watchingGame.autoplay) return;
    if (watchingGame.currentMoveIdx >= watchingGame.log.moves.length) {
      // Hit the end — flip autoplay off so the play button resets to ▶.
      setWatchingGame((cur) => (cur ? { ...cur, autoplay: false } : cur));
      return;
    }
    watchAutoplayRef.current = setTimeout(() => {
      seekWatchTo(watchingGame.currentMoveIdx + 1);
    }, WATCH_AUTOPLAY_MS);
    return () => {
      if (watchAutoplayRef.current) {
        clearTimeout(watchAutoplayRef.current);
        watchAutoplayRef.current = null;
      }
    };
    // seekWatchTo is stable-ish (defined in the component body but captures
    // setState which is stable); we intentionally drive this effect off the
    // watchingGame snapshot only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchingGame?.autoplay, watchingGame?.currentMoveIdx]);

  // V1 — Adaptive theme: the room follows the COMMITTED topology (never the
  // rotate button's hover preview, same rule the dust-wave FX follows), so
  // topology A is the neon night room and B is daylight. No-op for anyone
  // who pinned a specific theme. See src/ui/themeStore.ts.
  //
  // Deliberately DELAYED past the board's rotation animation (560-650ms).
  // Swapping `data-theme` restyles every element in the document; doing
  // that in the same frame as a transform animation on the board and all
  // 64 tiles turned the rotation into a visible stutter. Letting the board
  // finish turning before the light changes costs nothing and reads better
  // anyway — the board turns, then the room follows it.
  //
  // The store cross-fades the swap itself (a short dip, see themeStore),
  // so this only has to clear the rotation, not hide the change: 560ms
  // here plus the veil's own 170ms lead-in lands the swap right as the
  // board settles.
  useEffect(() => {
    const t = setTimeout(() => themeStore.setTopology(state.topologyState), 560);
    return () => clearTimeout(t);
  }, [state.topologyState]);

  // Brief glowing outline on the board container whenever topology flips,
  // so rotations don't feel invisible. Fires for both manual rotates and
  // Roulette-driven auto-rotations.
  const [recentRotation, setRecentRotation] = useState(false);
  const prevTopologyRef = useRef(state.topologyState);
  useEffect(() => {
    if (prevTopologyRef.current === state.topologyState) return;
    prevTopologyRef.current = state.topologyState;
    setRecentRotation(true);
    const t = setTimeout(() => setRecentRotation(false), 2500);
    return () => clearTimeout(t);
  }, [state.topologyState]);

  // 50-move milestone celebration. Fires exactly once per game the first
  // time the human has played 50 full chess moves. Skipped during replay
  // and after the game ends.
  useEffect(() => {
    if (watchingGame) return;
    if (gameStatus !== 'active') return;
    if (milestoneShown) return;
    const fullMoves = Math.floor(log.moves.length / 2);
    if (fullMoves >= 50) {
      setMilestoneShown(true);
      setShowMilestoneModal(true);
    }
  }, [log.moves.length, gameStatus, milestoneShown, watchingGame]);

  // V1 — nearer milestones (data plan §4.2). R15 funnel: 40% of solo games
  // are over by move 10, 72% by move 20, 90% by move 30; 50 is reached by
  // 2%. The modal above stays the epic one; these are quiet toasts that
  // tell the player where they stand, once per tier per game. Solo vs the
  // bot only: hot-seat and PvP have no "survival" framing.
  const milestoneTiersRef = useRef<{ logId: string | null; fired: number[] }>({
    logId: null,
    fired: [],
  });
  useEffect(() => {
    // opponentMode (not isLocalMode): the latter is declared further down
    // the component and would be a TDZ read from this effect.
    if (watchingGame || isMultiplayer || opponentMode === 'local' || isAutoMode) return;
    if (gameStatus !== 'active') return;
    const tracker = milestoneTiersRef.current;
    if (tracker.logId !== log.id) {
      tracker.logId = log.id;
      tracker.fired = [];
    }
    const fullMoves = Math.floor(log.moves.length / 2);
    for (const tier of MOVE_MILESTONES) {
      if (fullMoves < tier.moves || tracker.fired.includes(tier.moves)) continue;
      tracker.fired.push(tier.moves);
      toast.show(tier.text, 'success', 3800);
    }
  }, [log.moves.length, log.id, gameStatus, watchingGame, isMultiplayer, opponentMode, isAutoMode, toast]);

  // Square to pulse-highlight after a blunder/brilliant. Cleared after the
  // animation duration (4 cycles × 600ms = 2.4s, rounded to 2500).
  const [classifiedSquare, setClassifiedSquare] = useState<{
    square: SquareId;
    classification: 'blunder' | 'brilliant';
  } | null>(null);
  const classifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sprint 2.7 — separate "sacrifice" highlight, fires in parallel with
  // the brilliant flag when analysis flags the move as a true sacrifice
  // (piece walked onto attacked square + position still holds). Distinct
  // visual (violet burst + sparkles) so a sacrifice reads differently
  // from an ordinary tactical brilliancy.
  const [sacrificeSquare, setSacrificeSquare] = useState<SquareId | null>(null);
  const sacrificeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── M.5: adaptive music ──────────────────────────────────────────
  // The ambient drone "нагнітає" with the position: a 0..1 tension scale
  // derived from the engine eval, forced-mate detection and check state
  // morphs a dissonant layer + heartbeat tremolo inside AmbientPlayer.
  // All calls are no-ops while music is off.
  const kingInDanger = useMemo(() => {
    if (gameStatus !== 'active') return false;
    const king = findKing(state, state.sideToMove);
    if (!king) return false;
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    return isSquareAttacked(state, king, opp, state.topologyState);
  }, [state, gameStatus]);

  useEffect(() => {
    if (gameStatus !== 'active' || watchingGame) {
      audio.setMusicSituation(0, 0);
      return;
    }
    // |eval| 0 → calm, 700cp → 0.55; check stacks +0.3; forced mate pins
    // the needle. tanh-free linear is fine — AmbientPlayer squares it.
    let t = Math.min(1, Math.abs(currentEval) / 700) * 0.55;
    if (kingInDanger) t += 0.3;
    if (searchMateInPlies !== null) t = 1;
    // M.5.3 — the my-perspective advantage lets the adaptive style pick
    // warm (neutral) / dark (losing) / victory (winning).
    audio.setMusicSituation(Math.min(1, t), myPerspectiveEval);
  }, [currentEval, myPerspectiveEval, searchMateInPlies, kingInDanger, gameStatus, watchingGame]);

  // Danger stinger on the not-in-check → in-check edge only.
  const prevKingDangerRef = useRef(false);
  useEffect(() => {
    if (kingInDanger && !prevKingDangerRef.current && gameStatus === 'active' && !watchingGame) {
      audio.playMusicStinger('danger');
    }
    prevKingDangerRef.current = kingInDanger;
  }, [kingInDanger, gameStatus, watchingGame]);

  // Sacrifice stinger piggybacks on the classifier's sacrifice highlight.
  useEffect(() => {
    if (sacrificeSquare && gameStatus === 'active' && !watchingGame) {
      audio.playMusicStinger('sacrifice');
    }
  }, [sacrificeSquare, gameStatus, watchingGame]);
  // Sprint 4.1 — auto-scroll the sidebar move log so the latest ply
  // is always visible without manual scrolling. Anchored to the
  // <pre className="move-log-text"> element which already has the
  // max-height + overflow-y: auto from the sidebar-moves CSS.
  const moveLogScrollRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const el = moveLogScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log.moves.length]);

  // Sprint 4.2 — rotate hint now fires immediately on game start (was
  // move 5 in 4.1; new players need to discover rotate from move 1).
  // Hint auto-dismisses after 10s of inactivity so it doesn't linger
  // forever; localStorage still gates so it never reappears after the
  // first dismissal or first rotation.
  const [rotateHintShown, setRotateHintShown] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('subutai_rotate_hint_seen') === '1';
  });
  const showRotateHint = !rotateHintShown && gameStatus === 'active';
  function dismissRotateHint() {
    setRotateHintShown(true);
    try {
      window.localStorage.setItem('subutai_rotate_hint_seen', '1');
    } catch {
      /* private mode / quota — no-op */
    }
  }
  // Sprint 4.2 — auto-dismiss the rotate hint after 10s if the user
  // hasn't interacted with it. Prevents the pulse + tooltip from
  // becoming permanent visual noise.
  useEffect(() => {
    if (!showRotateHint) return;
    const id = setTimeout(() => dismissRotateHint(), 10_000);
    return () => clearTimeout(id);
  }, [showRotateHint]);

  // Sprint 3.4.1 — captures no longer trigger their own visual burst.
  // The per-take flash from Sprint 3.2 fired too often and read as
  // noise; only the classifier reactions (?? shake / !! sparkles) and
  // the en-passant explosion remain. The captureSquare state and the
  // log-length useEffect that drove it have been removed.

  // Sprint 3.6 — right-click annotations (chess.com / lichess style).
  // Right-click a square to highlight it (cycles colour by modifier:
  // none=green, shift=red, alt=yellow, ctrl/meta=blue). Right-drag
  // from one square to another draws an arrow in the same colour
  // scheme. Repeat the same gesture with the same colour to clear.
  // All annotations clear automatically when a move is played — they
  // are a per-position scratch pad, not a persistent layer.
  const [squareAnnotations, setSquareAnnotations] = useState<Map<SquareId, AnnotationColor>>(
    () => new Map(),
  );
  const [arrowAnnotations, setArrowAnnotations] = useState<ArrowAnnotation[]>([]);
  const annotationStartRef = useRef<SquareId | null>(null);
  // Sprint 3.2.1 — distinctive screen-wide effect on blunder / brilliant
  // classifications. The existing generic flash overlay (--flash-opacity
  // on .app-shell::after) is kept; this adds shake + vignette for ??
  // and a gold pulse + floating sparkles for !!.
  const [flashEffect, setFlashEffect] = useState<'blunder' | 'brilliant' | null>(null);
  const flashEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the search-backed eval from an analysis into the bar/gradient state.
  // Used by every classify callsite (live moves, AI, imported-log completion).
  const pushSearchEval = useCallback((analysis: MoveAnalysis) => {
    setSearchEvalFromWhite(analysis.searchScoreFromWhite);
    setSearchMateInPlies(analysis.isMate ? analysis.mateInPlies ?? 0 : null);
  }, []);

  const flagClassifiedSquare = useCallback(
    (square: SquareId, classification: 'blunder' | 'brilliant') => {
      if (classifyTimerRef.current) clearTimeout(classifyTimerRef.current);
      setClassifiedSquare({ square, classification });
      classifyTimerRef.current = setTimeout(() => {
        setClassifiedSquare(null);
        classifyTimerRef.current = null;
      }, 2500);
    },
    [],
  );

  // Triggers a screen flash for a classified move. Sets the colour/peak
  // opacity/transition duration as CSS variables; on the next frame, snaps
  // opacity back to 0 so the registered --flash-opacity transition fades it.
  const triggerFlash = useCallback((cls: MoveClass) => {
    const shell = shellRef.current;
    if (!shell) return;
    let color: string;
    let peak: string;
    let durationMs: number;
    if (cls === 'blunder') {
      color = 'rgb(220, 40, 40)';
      peak = '0.35';
      durationMs = 400;
    } else if (cls === 'brilliant') {
      color = 'rgb(255, 200, 80)';
      peak = '0.45';
      durationMs = 600;
    } else if (cls === 'checkmate') {
      color = 'rgb(255, 255, 255)';
      peak = '0.6';
      durationMs = 800;
    } else {
      return;
    }
    shell.style.setProperty('--flash-color', color);
    shell.style.setProperty('--flash-duration', `${durationMs}ms`);
    shell.style.setProperty('--flash-opacity', peak);
    setTimeout(() => {
      shell.style.setProperty('--flash-opacity', '0');
    }, 50);

    // Sprint 3.2.1 — additional distinctive overlay/effect for ?? / !!.
    // Checkmate flash is handled separately by the gameStatus useEffect
    // (body.checkmate-flash radial whiteout).
    let effectKind: 'blunder' | 'brilliant' | null = null;
    let effectDuration = 0;
    if (cls === 'blunder') {
      effectKind = 'blunder';
      effectDuration = 800;
    } else if (cls === 'brilliant') {
      effectKind = 'brilliant';
      effectDuration = 1500;
    }
    if (effectKind) {
      if (flashEffectTimerRef.current) clearTimeout(flashEffectTimerRef.current);
      setFlashEffect(effectKind);
      flashEffectTimerRef.current = setTimeout(() => {
        setFlashEffect(null);
        flashEffectTimerRef.current = null;
      }, effectDuration);
    }
    // Sprint 3.7 — classifier SFX. Runs *after* the move/capture SFX
    // from the log-watching effect above (analysis lands async on the
    // classifier worker, so a short delay puts the brilliant /
    // blunder voice on top of the move thump rather than racing it).
    if (cls === 'brilliant') audio.play('brilliant');
    else if (cls === 'blunder') audio.play('blunder');
  }, []);

  // Sprint 3.2.1 — sparkle positions for the brilliant overlay.
  // Regenerated whenever flashEffect transitions to 'brilliant' so each
  // !! gets fresh randomised positions. Empty list otherwise.
  const sparklePositions = useMemo(() => {
    if (flashEffect !== 'brilliant') return [] as Array<{ x: number; y: number; delay: number; rot: number }>;
    return Array.from({ length: 6 }, () => ({
      x: 15 + Math.random() * 70,
      y: 15 + Math.random() * 70,
      delay: Math.floor(Math.random() * 200),
      rot: Math.floor(Math.random() * 360),
    }));
  }, [flashEffect]);

  // Apply per-move visual side-effects, but only if no newer move has been
  // played since the analysis was queued. With the Worker-backed classifier
  // a response can land seconds after a subsequent move; we don't want a
  // stale flash for an old move firing while the bar should reflect a newer one.
  const applyClassifyVisuals = useCallback(
    (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => {
      if (logLengthRef.current !== moveIdx + 1) return;
      pushSearchEval(analysis);
      triggerFlash(analysis.classification);
      if (
        moveTo &&
        (analysis.classification === 'blunder' || analysis.classification === 'brilliant')
      ) {
        flagClassifiedSquare(moveTo, analysis.classification);
      }
      // Sprint 2.7 — additive sacrifice highlight; runs alongside the
      // brilliant pulse on the same tile when the analysis flagged the
      // move as a real sacrifice. 2.5s matches the brilliant pulse.
      if (
        moveTo &&
        analysis.classification === 'brilliant' &&
        analysis.isSacrifice
      ) {
        if (sacrificeTimerRef.current) clearTimeout(sacrificeTimerRef.current);
        setSacrificeSquare(moveTo);
        sacrificeTimerRef.current = setTimeout(() => {
          setSacrificeSquare(null);
          sacrificeTimerRef.current = null;
        }, 2500);
      }
    },
    [pushSearchEval, triggerFlash, flagClassifiedSquare],
  );

  /** V1 (DEF-6) — record a finished classification and play its visuals.
   *  A superseded result (its batch was cancelled when a Game Review
   *  started) carries placeholder numbers: writing them would snap the
   *  eval bar to 0.00 and log the move as plain "good", so it is dropped. */
  const commitAnalysis = useCallback(
    (moveIdx: number, analysis: MoveAnalysis, moveTo: SquareId | undefined) => {
      if (analysis.superseded) return;
      setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, analysis));
      applyClassifyVisuals(moveIdx, analysis, moveTo);
    },
    [applyClassifyVisuals],
  );

  /**
   * Walks an imported log forward, classifying each move asynchronously.
   * Each step is its own setTimeout(0) so the UI stays responsive between
   * ~300 ms classifies. The captured log id ensures we don't patch a
   * different game if the user starts a new one mid-classify.
   */
  const classifyImportedLog = useCallback(
    (loadedLog: GameLog) => {
      const capturedId = loadedLog.id;
      // Pre-compute all positions synchronously — cheap (no search) — so the
      // classifier can grab `stateBefore` for each move by index later.
      const states: BoardState[] = [loadedLog.initialState];
      for (const entry of loadedLog.moves) {
        const prev = states[states.length - 1];
        let next: BoardState;
        if (entry.move.kind === 'topologyToggle') {
          next = applyRotationMove(prev);
        } else if (entry.move.from && entry.move.to) {
          next = applyMove(prev, entry.move);
        } else {
          next = prev;
        }
        states.push(next);
      }
      // Only the last move's analysis feeds the bar — otherwise it would
      // pinball through 30 mid-game scores while the loading completes.
      let lastAnalysis: MoveAnalysis | null = null;
      (async () => {
        for (let i = 0; i < loadedLog.moves.length; i++) {
          const entry = loadedLog.moves[i];
          if (entry.move.kind === 'topologyToggle' || !entry.move.from || !entry.move.to) {
            continue;
          }
          const a = await classifyAsync(states[i], entry.move, states[i + 1], {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: loadedLog.gameMode === 'roulette',
          });
          if (a.superseded) continue; // DEF-6: dropped by a newer batch
          setLog((prev) =>
            prev.id === capturedId ? updateMoveAnalysisAt(prev, i, a) : prev,
          );
          lastAnalysis = a;
        }
        if (lastAnalysis) pushSearchEval(lastAnalysis);
      })();
    },
    [pushSearchEval],
  );

  function applyFormationCode() {
    const raw = formationInputValue.trim().toUpperCase();
    if (!raw) {
      setFormationInputMode(false);
      setFormationInputValue('');
      return;
    }
    if (!isValidChess960Key(raw)) {
      setFormationInputValue(raw);
      return;
    }
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const initial = createPositionFromBackRankKey(raw);
    setState(initial);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(getLegalMoves(initial));
    setLog(createGameLog(`game-${Date.now()}`, initial, Date.now()));
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setFormationLocked(true);
    setLockedFormationKey(raw);
    setFormationInputMode(false);
    setFormationInputValue('');
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cancelFormationInput() {
    setFormationInputMode(false);
    setFormationInputValue('');
  }

  /**
   * V1 — blur means "I'm done", so it must always leave the editor.
   *
   * `applyFormationCode` returns early on an invalid code without
   * clearing the mode, which used to keep the field open forever. That
   * was survivable while a separate "Set position" button existed; now
   * that the code chip IS the control and the only place the starting
   * rank is shown, a stuck editor hides the position behind a half-typed
   * string. Clicking away on garbage just gives up, like Escape.
   */
  function commitFormationOnBlur() {
    const raw = formationInputValue.trim().toUpperCase();
    if (raw && !isValidChess960Key(raw)) {
      cancelFormationInput();
      return;
    }
    applyFormationCode();
  }

  const tileBase = boardSize / 8;

  /** V1 — the rook's half of the last castle, so it glides like the king
   *  does instead of jumping. Null unless the latest move was a castle
   *  whose rook actually changed square (in Chess960 it may not). */
  const castleRookSlide = useMemo(() => {
    const last = log.moves[log.moves.length - 1]?.move;
    if (!last || last.kind !== 'castle' || !last.castleRookFrom || !last.castleRookTo) {
      return null;
    }
    if (last.castleRookFrom === last.castleRookTo) return null;
    if (!lastMove || lastMove.to !== last.to) return null; // stale log vs board
    return { from: last.castleRookFrom, to: last.castleRookTo };
  }, [log.moves, lastMove]);

  /** An ending found on the board never overwrites one already set: a
   *  bot move can still be settling (its classification is awaited) when
   *  the player resigns (QA-11). */
  function endGameWith(status: Exclude<GameStatus, 'active'>) {
    setGameStatus((prev) => (prev === 'active' ? status : prev));
  }

  // Moves playable given a spin + already-used slots. Q.D.5: delegates to
  // isPieceMovableInRoulette so the in-check override is automatic.
  function playableRouletteMoves(
    boardState: BoardState,
    allowed: PieceType[],
    used: number[],
  ): Move[] {
    return getLegalMoves(boardState).filter((m) => {
      if (!m.from) return false;
      const p = boardState.pieces[m.from];
      if (!p) return false;
      return isPieceMovableInRoulette(p.type, boardState, 'roulette', allowed, used);
    });
  }

  // Pick the index of the slot this mover-type consumes. Prefers the first
  // unused slot of that exact type.
  function consumeSlotIndex(
    allowed: PieceType[],
    used: number[],
    moverType: PieceType,
  ): number {
    return allowed.findIndex(
      (type, idx) => type === moverType && !used.includes(idx),
    );
  }

  function handleSpinRoulette() {
    if (gameMode !== 'roulette') return;
    // Q.D.3: MP roulette routes through the hook so the 4-slot bag,
    // pawn-bias, and action allotment all sync via Firestore. Both peers
    // see the same slots as soon as the doc updates.
    if (isMultiplayer) {
      if (!mpSync || !mpSync.isMyTurn) return;
      if (mpSync.matchState.status !== 'active') return;
      if (mpSync.rouletteSlots !== null) return;
      void mpSync.spinRoulette();
      return;
    }
    if (gameStatus !== 'active') return;
    if (allowedPieceTypes !== null) return;
    // First click of the game flips the gate so the auto-spin effect can
    // take over on subsequent turns.
    if (!firstRouletteSpinDone) setFirstRouletteSpinDone(true);
    doSpinRouletteNow();
  }

  function doSpinRouletteNow() {
    setIsRouletteSpinning(true);
    // Sprint 3.8 — fire the roulette spin SFX at the same moment the
    // visual roll starts; the synth's decelerating clicks + final
    // chime line up with the spin animation.
    // Sprint 4.0 — slowed visual reveal from 400ms to 2500ms so the
    // wheel reads as a real "gambling" deceleration. Audio extended
    // to ~2.5–3s in synths.ts to match.
    // Sprint 4.1 — pulled back to 2300ms (~1.5× faster than 4.0)
    // after the 2.5s felt sluggish in repeated play; still reads as
    // a deliberate deceleration rather than a quick blip.
    audio.play('rouletteSpin');
    setTimeout(() => {
      // Roll only from pieces the current player actually has on the board.
      const activeTypes = getActivePieceTypes(state, state.sideToMove);
      const pawnBoost = rouletteSpinCount < 3;
      const rolled = spinRoulette(activeTypes, pawnBoost);
      setRouletteSpinCount((n) => n + 1);
      // Q.D.5: route through the central gate so in-check override applies.
      // Note: usedRouletteSlots is [] here — we just spun, nothing consumed.
      const playable = playableRouletteMoves(state, rolled, []);

      // Auto-pass only if the player has NO way to act — no piece move AND
      // rotation is blocked (back-to-back guard). If they can rotate they
      // should get a chance to spend their action on the rotation.
      const canRotate = !state.lastMoveWasRotation;
      if (playable.length === 0 && !canRotate) {
        const next = applyPassMove(state);
        setState(next);
        setAllowedPieceTypes(null);
        setSelected(null);
        setIsRouletteSpinning(false);
        setLastMove(null);
        setLegalMoves(getLegalMoves(next));
        setRouletteActionsLeft(0);
        setUsedRouletteSlots([]);
      } else {
        setAllowedPieceTypes(rolled);
        setIsRouletteSpinning(false);
        setRouletteActionsLeft(ROULETTE_MAX_ACTIONS);
        setUsedRouletteSlots([]);
        // Board highlights expect `legalMoves`; swap in the roulette-filtered
        // set so target squares (teal) show up for the allowed pieces.
        setLegalMoves(playable);
      }
    }, 2300);
  }

  /** The ending this board is in under the current mode's rules, if any. */
  function boardEnding(
    nextState: BoardState,
    lastMoveWasRotation: boolean = false,
  ): Exclude<GameStatus, 'active'> | null {
    // Q.D.8: roulette is capture-the-king — the ONLY terminal is a missing
    // king. No checkmate, no stalemate, no draws (the variant deliberately
    // skips them so play continues until a king is actually taken).
    if (gameMode === 'roulette') {
      if (!findKing(nextState, 'white')) return 'king_captured_black_wins';
      if (!findKing(nextState, 'black')) return 'king_captured_white_wins';
      return null;
    }
    // Classic mode: standard chess termination — checkmate, stalemate,
    // draw by repetition / 50-move / insufficient material.
    if (isCheckmate(nextState, lastMoveWasRotation)) return 'checkmate';
    const draw = checkDrawConditions(nextState, lastMoveWasRotation);
    if (draw === 'stalemate') return 'draw_stalemate';
    if (draw === 'insufficient_material') return 'draw_material';
    if (draw === 'threefold_repetition') return 'draw_repetition';
    if (draw === 'fifty_move_rule') return 'draw_50move';
    return null;
  }

  function checkGameOver(nextState: BoardState, lastMoveWasRotation: boolean = false) {
    const ending = boardEnding(nextState, lastMoveWasRotation);
    if (ending) endGameWith(ending);
  }

  function startNewGame() {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    // Reset the transposition table so positions from the previous game can't
    // bias the new search. (TT is reused across moves WITHIN one game.)
    ttClear();
    const newSeed = Date.now();
    const initial =
      formationLocked && lockedFormationKey
        ? createPositionFromBackRankKey(lockedFormationKey)
        : createStartingPosition(newSeed);
    setSeed(newSeed);
    setState(initial);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(getLegalMoves(initial));
    setLog(createGameLog(`game-${newSeed}`, initial, newSeed));
    savedForLogIdRef.current = null;
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setAllowedPieceTypes(null);
    setIsRouletteSpinning(false);
    setRouletteActionsLeft(0);
    setUsedRouletteSlots([]);
    setFirstRouletteSpinDone(false);
    setRouletteSpinCount(0);
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();
    autoSavedLogIdRef.current = null;
    autoLastMoveAtRef.current = Date.now();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * QA-01 — everything the previous game's ending left behind.
   *
   * Every way into a new board (New game, a 960 code, Load replay, a Memory
   * resume) calls this. Only New game used to, so after a closed summary a
   * game started any other way inherited the old gameOutcome and finished
   * with no summary and no save.
   */
  function resetGameEndState() {
    worstHumanEvalRef.current = 0; // R6 — reset the tense-win detector
    setEndgameCut(null);
    if (victoryFreezeTimer.current) clearTimeout(victoryFreezeTimer.current);
    setVictoryFreeze(false);
    setSummaryOpen(false);
    setLastGamePoints(null);
    setGameOutcome(null);
    setSavingGame(false);
    setSaveError(null);
    setCurrentRank(null);
    setIsNewBest(false);
    setPersonalBest(null);
    setLastGameId(null);
    setMilestoneShown(false);
    setShowMilestoneModal(false);
    setLastGameImported(false);
    completedLogIdRef.current = null;
    gameStartedAtRef.current = Date.now();
  }

  // S2.4 — any change to the position invalidates a shown hint.
  useEffect(() => {
    setHintMove(null);
  }, [logLocal.moves.length, state.topologyState, gameStatus]);

  // S2.5 — clock ticking. A ref mirrors sideToMove so the interval
  // closure always charges the side actually to move without re-arming
  // the timer on every ply.
  const clockSideRef = useRef<Color>(state.sideToMove);
  useEffect(() => {
    clockSideRef.current = state.sideToMove;
  }, [state.sideToMove]);

  useEffect(() => {
    setClockMs({ white: 0, black: 0 });
  }, [logLocal.id]);

  // V1 — the clocks arm on the FIRST MOVE, always.
  //
  // This used to be `soloTcSec === null || moves.length > 0`, so free play
  // (time control "None") started counting the moment the page loaded or a
  // new game was created. Sitting on a fresh board reading the position is
  // not thinking time you spent, and it made the clock look broken the
  // instant a game began. Picking a control before the first move still
  // zeroes whatever already accumulated, so both sides start whole.
  const clockArmed = logLocal.moves.length > 0;
  useEffect(() => {
    if (logLocal.moves.length === 0) setClockMs({ white: 0, black: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloTcSec]);
  useEffect(() => {
    if (gameStatus !== 'active' || watchingGame || !clockArmed) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      const side = clockSideRef.current;
      setClockMs((c) => ({ ...c, [side]: c[side] + dt }));
    }, 500);
    return () => clearInterval(id);
  }, [gameStatus, watchingGame, logLocal.id, clockArmed]);

  // ── B8: multiplayer time control ──────────────────────────────────
  // Both peers derive identical countdown clocks from the shared move
  // timestamps in the match doc — no extra writes, no sync drift
  // beyond local clock skew. White's first move is free (no reliable
  // "game started" epoch in the doc); every later entry charges the
  // time since the previous entry to its mover. Flag-fall self-forfeits
  // through the existing resign path — same trust model as the AFK
  // watchdog.
  const mpTimeControl =
    isMultiplayer && mpSync && mpSync.matchState.gameMode !== 'roulette'
      ? mpSync.matchState.timeControlSec ?? null
      : null;

  // R13/BUG-2 — MP terminality lives in the MATCH doc, not in the local
  // gameStatus (which stays 'active' for the whole PvP game). Gating the
  // tick and the live-charge on gameStatus kept the loser's clock visibly
  // counting past the end of a finished match.
  const mpMatchLive =
    isMultiplayer && mpSync
      ? mpSync.matchState.status === 'active' && !mpSync.matchState.outcome
      : false;

  const [mpNow, setMpNow] = useState(() => Date.now());
  useEffect(() => {
    // V1 — ticks for ANY live match, not only a timed one. Without a time
    // control the clocks used to sit at 00:00 for the whole game, which
    // makes the one piece of information both players actually want —
    // who is burning the time — unavailable exactly when there is no
    // limit to enforce it.
    if (!mpMatchLive) return;
    const id = setInterval(() => setMpNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [mpMatchLive]);

  const mpClocks = useMemo(() => {
    if (!isMultiplayer || !mpSync) return null;
    const moves = mpSync.matchState.log.moves;
    // R13 — Fischer increment: every completed move credits its mover.
    const incMs = (mpSync.matchState.timeIncrementSec ?? 0) * 1000;
    let usedWhite = 0;
    let usedBlack = 0;
    for (let i = 1; i < moves.length; i++) {
      const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
      // Mover of entry i: entries alternate starting with white (rotations
      // consume the turn too, so parity holds in classic).
      if (i % 2 === 0) usedWhite += dt;
      else usedBlack += dt;
    }
    if (mpMatchLive && moves.length > 0) {
      const live = Math.max(0, mpNow - (moves[moves.length - 1].timestamp ?? mpNow));
      if (moves.length % 2 === 0) usedWhite += live;
      else usedBlack += live;
    }
    // No time control: just show what each side has spent. Same numbers,
    // counted up instead of down, and nothing can flag.
    if (!mpTimeControl) {
      return { white: usedWhite, black: usedBlack, countdown: false };
    }
    // Completed-move counts: entries alternate W,B,W,B… so white made
    // ceil(n/2) of them and black the rest.
    const whiteMoves = Math.ceil(moves.length / 2);
    const blackMoves = Math.floor(moves.length / 2);
    const total = mpTimeControl * 1000;
    return {
      white: Math.max(0, total + whiteMoves * incMs - usedWhite),
      black: Math.max(0, total + blackMoves * incMs - usedBlack),
      countdown: true,
    };
  }, [isMultiplayer, mpTimeControl, mpSync, mpNow, mpMatchLive]);

  const flagFiredRef = useRef(false);
  useEffect(() => {
    flagFiredRef.current = false;
  }, [mpSync?.matchState.code]);
  useEffect(() => {
    if (!mpClocks || !mpSync || flagFiredRef.current) return;
    // Only a COUNTDOWN can run out. Since untimed matches got an elapsed
    // clock (V1), mpClocks exists in every match — and an elapsed clock
    // starts at 0, which the lines below read as "your flag fell". Every
    // untimed match resigned itself the instant it started.
    if (!mpClocks.countdown) return;
    if (mpSync.matchState.status !== 'active') return;
    const mine = mpSync.myColor === 'white' ? mpClocks.white : mpClocks.black;
    if (mine <= 0) {
      flagFiredRef.current = true;
      void mpSync.resign();
      return;
    }
    // R13/BUG-3 — the flagging client may be gone (tab closed): if the
    // OPPONENT's clock hits zero, the waiting peer claims the flag win
    // itself instead of waiting ~90s for the AFK watchdog. Same
    // transaction-guarded write local mate detection uses, so a
    // simultaneous self-forfeit can't double-settle the match.
    const theirs = mpSync.myColor === 'white' ? mpClocks.black : mpClocks.white;
    if (theirs <= 0) {
      flagFiredRef.current = true;
      const opponentIsHost = mpSync.matchState.host.uid !== mpSync.myUid;
      void mpSync.writeOutcomeIfFirst(opponentIsHost ? 'host-resign' : 'guest-resign');
    }
  }, [mpClocks, mpSync]);

  function toggleHelpTools() {
    setHelpToolsEnabled((v) => {
      const next = !v;
      try {
        localStorage.setItem('subutai_help_tools', next ? '1' : '0');
      } catch { /* private mode */ }
      if (!next) {
        setShowSupport(false);
        setShowThreats(false);
        setHintMove(null);
      }
      return next;
    });
  }

  // S2.4 — engine hint. A short synchronous search (~0.5s) is fine for a
  // deliberate button press. Classic mode only: roulette's slot
  // restrictions aren't modeled by the bare search, so its "best move"
  // could be illegal this turn.
  function computeHint() {
    if (currentPlayer !== 'human' || gameStatus !== 'active' || watchingGame) return;
    if (gameMode !== 'classic') return;
    const result = searchPosition(state, {
      budgetMs: 500,
      maxDepth: 5,
      lastMoveWasRotation: state.lastMoveWasRotation,
    });
    const best = result.bestMove;
    if (!best) return;
    if (best.kind === 'topologyToggle') {
      setHintMove({ rotate: true });
      return;
    }
    // B4 — the search explores rotation but its eval rarely ranks it
    // strictly #1, so the hint never showed the signature move. Probe
    // the rotation line explicitly: if it's at least as good as the
    // best piece move (within 30cp), recommend the rotate — it's the
    // mechanic worth teaching.
    if (canRotate && !state.lastMoveWasRotation) {
      const rotated = applyRotationMove(state);
      const reply = searchPosition(rotated, {
        budgetMs: 300,
        maxDepth: 4,
        lastMoveWasRotation: true,
      });
      const rotationScore = -reply.score; // negamax: reply is opponent-side
      if (rotationScore >= result.score - 30) {
        setHintMove({ rotate: true });
        return;
      }
    }
    if (best.from && best.to) {
      setHintMove({ from: best.from, to: best.to });
    }
  }

  function toggleFormationLock() {
    setFormationLocked((v) => {
      if (!v) setLockedFormationKey(backRankString(initialState));
      else setLockedFormationKey(null);
      return !v;
    });
  }

  // Sprint 4.3.1 — opponent switch with a guard for active local games.
  // Sprint 5.0 (S2.1) — generalized to ANY in-progress non-MP game.
  // Previously only local games confirmed; switching ai→local mid-game
  // silently converted a live AI game into hot-seat, and ai→friend
  // suspended it under the lobby. Every mode now has one exit rule:
  // finish, resign, or explicitly abandon via the dialog.
  function requestOpponentChange(next: 'ai' | 'friend' | 'local') {
    if (next === opponentMode) return;
    if (gameInProgress && !isMultiplayer && !watchingGame) {
      setPendingOpponentChange(next);
      return;
    }
    applyOpponentChange(next);
  }

  function applyOpponentChange(next: 'ai' | 'friend' | 'local') {
    if (next === 'friend') {
      busy.navigate('Opening the lobby', () => {
        setOpponentMode(next);
        setView('friend-lobby');
      });
      return;
    }
    setOpponentMode(next);
  }

  function handleRotate() {
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (state.lastMoveWasRotation) return;
    // Sprint 4.1 — first actual rotation dismisses the hint for good.
    if (!rotateHintShown) dismissRotateHint();

    // Multiplayer: send a topologyToggle move through Firestore — the
    // opponent's listener re-derives the board (rebuildBoardFromMatch
    // skips toggle entries today; T1 unblocks them once Q.B.2 picks them
    // up via the same applyRotationMove path). King-safety check first
    // so we don't push an illegal rotation across the wire.
    if (isMultiplayer && mpSync) {
      if (mpSync.matchState.status !== 'active') return;
      if (!mpSync.isMyTurn) return;
      const toggledMp = toggleTopology(state);
      const ourKingMp = findKing(toggledMp, state.sideToMove);
      if (!ourKingMp) return;
      const oppMp = state.sideToMove === 'white' ? 'black' : 'white';
      if (
        isSquareAttacked(
          toggledMp,
          ourKingMp,
          oppMp as 'white' | 'black',
          toggledMp.topologyState,
        )
      ) {
        return;
      }
      // Q.D.3: in MP roulette rotate burns an action without consuming a
      // slot — handled by sendRotate. In classic MP rotate is a whole
      // turn — also routes through sendRotate which delegates to sendMove.
      void mpSync.sendRotate();
      setPreviewTopology(null);
      setSelected(null);
      return;
    }

    if (gameStatus !== 'active') return;

    const toggled = toggleTopology(state);

    // Classic mode: king-safety check; rotation consumes the whole turn.
    if (gameMode !== 'roulette') {
      const ourKing = findKing(toggled, state.sideToMove);
      if (!ourKing) return;
      const opponent = state.sideToMove === 'white' ? 'black' : 'white';
      if (isSquareAttacked(toggled, ourKing, opponent as 'white' | 'black', toggled.topologyState)) return;

      const next = applyRotationMove(state);
      setState(next);
      setLegalMoves(getLegalMoves(next));
      setSelected(null);
      setPreviewTopology(null);

      const toggleMove: Move = { kind: 'topologyToggle' };
      const toggleSan = computeSAN(state, toggleMove);
      setLog((prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState));
      setLastMove(null);
      // R10 — the streamer rotated: settle the chat's guess round.
      announceGuessWinners(moveVoting.resolveGuessRotate());
      checkGameOver(next, true);
      return;
    }

    // Roulette mode: rotation costs exactly 1 Action Point.
    // - Must have spun (allowedPieceTypes !== null) and have at least 1 action.
    // - usedRouletteSlots is NOT modified (rotation doesn't consume a slot).
    if (allowedPieceTypes === null || rouletteActionsLeft < 1) return;

    const rotated = applyRotationMove(state); // sideToMove flipped, lastMoveWasRotation=true
    const toggleMove: Move = { kind: 'topologyToggle' };
    const toggleSan = computeSAN(state, toggleMove);
    setLog((prev) => appendMove(prev, toggleMove, toggleSan, state.topologyState));
    setLastMove(null);
    setSelected(null);
    setPreviewTopology(null);

    const actionsAfter = rouletteActionsLeft - 1;

    if (actionsAfter === 0) {
      // Last action: accept the side flip, end the turn.
      setState(rotated);
      setAllowedPieceTypes(null);
      setIsRouletteSpinning(false);
      setRouletteActionsLeft(0);
      setUsedRouletteSlots([]);
      setLegalMoves(getLegalMoves(rotated));
      checkGameOver(rotated, true);
      return;
    }

    // First action: keep the turn. Clamp sideToMove back to the current player
    // and refresh legalMoves for the new topology (usedRouletteSlots intact).
    const clamped: BoardState = { ...rotated, sideToMove: state.sideToMove };
    const nextPlayable = playableRouletteMoves(
      clamped,
      allowedPieceTypes,
      usedRouletteSlots,
    );
    // We cannot rotate again this turn (lastMoveWasRotation=true). If there's
    // also no piece move available, the remaining action can't be used — end
    // the turn to keep the game flowing.
    if (nextPlayable.length === 0) {
      setState(rotated);
      setAllowedPieceTypes(null);
      setIsRouletteSpinning(false);
      setRouletteActionsLeft(0);
      setUsedRouletteSlots([]);
      setLegalMoves(getLegalMoves(rotated));
      checkGameOver(rotated, true);
      return;
    }

    setState(clamped);
    setRouletteActionsLeft(actionsAfter);
    setLegalMoves(nextPlayable);
    // allowedPieceTypes and usedRouletteSlots unchanged — rotation doesn't
    // consume a specific slot.
    checkGameOver(clamped, true);
  }

  // In MP currentPlayer reflects whose turn it is from MY seat: 'human' when
  // I can act, 'ai' otherwise. Keeping the same vocabulary lets the existing
  // canRotate / scheduler / UI-disable code work unchanged.
  // Sprint 4.1 — `local` opponent mode means both colours are played
  // from this device, so the engine should never schedule an AI turn.
  // Cached here so the AI scheduler, classifier, and downstream UI
  // can short-circuit on a single flag.
  // V1 — a replay is nobody's hot-seat game. Without `!watchingGame`, a
  // replay started while "Local" was selected rendered the mirrored top
  // controls and flipped the board for "black's turn" in someone else's
  // game. The opponent choice is kept, so stopping the replay brings the
  // hot-seat UI straight back.
  const isLocalMode = opponentMode === 'local' && !isMultiplayer && !watchingGame;

  // V1 — solo time control flag-fall. When a side's remaining time hits
  // zero the game ends as a loss on time for that side, exactly like a
  // timed PvP match. Vs the bot the completion effect turns the terminal
  // status into ai-win / human-win and saves as usual; in local hot-seat
  // the banner is the ending (same as resign there). The clock only arms
  // after the first move (see the tick effect), so nobody flags while the
  // board is still untouched.
  const soloFlagLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (soloTcSec === null || isMultiplayer || isAutoMode || watchingGame) return;
    if (gameStatus !== 'active' || log.moves.length === 0) return;
    if (soloFlagLogIdRef.current === log.id) return;
    const flagged = (['white', 'black'] as const).find(
      (side) => soloTcSec * 1000 - clockMs[side] <= 0,
    );
    if (!flagged) return;
    soloFlagLogIdRef.current = log.id;
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setSelected(null);
    setGameStatus(flagged === 'white' ? 'timeout_white' : 'timeout_black');
    if (isLocalMode) completedLogIdRef.current = log.id;
    toast.show(
      `${flagged === 'white' ? 'White' : 'Black'} ran out of time.`,
      'info',
      3200,
    );
  }, [clockMs, soloTcSec, isMultiplayer, isAutoMode, watchingGame, gameStatus, log.id, log.moves.length, isLocalMode, toast]);
  // Local hot-seat's own "game over" modal dismiss flag (see the render
  // site near the MP completion dialog). Reset per game via the effect
  // below, keyed on log.id like the other one-shot-per-game flags in
  // this file (earlyTipLogIdRef etc.).
  const [localGameOverDismissed, setLocalGameOverDismissed] = useState(false);
  useEffect(() => {
    setLocalGameOverDismissed(false);
  }, [log.id]);
  // Sprint 4.3.1 — derived "the user has committed to this game" flag.
  // Used to (a) hide the duplicate bottom action group in local 2P and
  // (b) lock the opponent / mode toggles so a misclick can't reset
  // mid-game state.
  const gameInProgress = log.moves.length > 0 && gameStatus === 'active';

  /**
   * V1 — one guard for everything that can take you out of a game.
   *
   * Each destructive control used to decide for itself whether to ask
   * first: switching opponent asked, "New game" did not, loading a replay
   * or a Chess960 code or a saved game from Memory did not — each of
   * those silently threw the game in progress away. And in an online
   * match nothing asked at all, although walking off to the leaderboard
   * leaves your clock running and the inactivity watchdog armed.
   *
   * `destroys` separates the two cases: actions that REPLACE the board
   * (always worth a question mid-game) from navigation that merely leaves
   * the board view (harmless solo, where the game waits for you, but not
   * online, where it does not).
   */
  const [pendingLeave, setPendingLeave] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  const guardLeave = (what: string, destroys: boolean, run: () => void) => {
    if (watchingGame) {
      run();
      return;
    }
    if (isMultiplayer && mpMatchLive) {
      setPendingLeave({
        title: 'Leave the live match?',
        message:
          'The match keeps running while you are away: your clock keeps ticking, and a long absence is forfeited for inactivity.',
        confirmLabel: what,
        run,
      });
      return;
    }
    if (destroys && gameInProgress) {
      setPendingLeave({
        title: 'End the current game?',
        message: `${what} replaces the game in progress. It will not be saved as finished.`,
        confirmLabel: what,
        run,
      });
      return;
    }
    run();
  };
  const currentPlayer = isMultiplayer
    ? mpSync!.isMyTurn
      ? 'human'
      : 'ai'
    : isLocalMode
      ? 'human'
      : state.sideToMove === 'white'
        ? 'human'
        : 'ai';
  /** QA-11 — solo only: the bot's move is in flight. */
  const botThinking =
    !isMultiplayer && !isLocalMode && gameStatus === 'active' && currentPlayer === 'ai';

  // Sprint 2.5 — local AFK nag. Pointer / keyboard activity refreshes
  // the timestamp and clears any existing alert; if we're idle for 20s
  // on our own turn while the game is still active, surface a pulsing
  // attention banner. Distinct from mpSync.selfAfkWarning which is the
  // server-driven 30s forfeit timer.
  useEffect(() => {
    function bump() {
      lastActivityRef.current = Date.now();
      setShowAfkAlert(false);
    }
    document.addEventListener('pointerdown', bump, { passive: true });
    document.addEventListener('pointermove', bump, { passive: true });
    document.addEventListener('keydown', bump, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', bump);
      document.removeEventListener('pointermove', bump);
      document.removeEventListener('keydown', bump);
    };
  }, []);

  useEffect(() => {
    if (currentPlayer !== 'human' || gameStatus !== 'active') {
      setShowAfkAlert(false);
      return;
    }
    // Reset the timestamp whenever it becomes our turn — we don't want to
    // count idle time from before the opponent moved.
    lastActivityRef.current = Date.now();
    setShowAfkAlert(false);
    const t = setInterval(() => {
      // Sprint 2.7: bumped from 20s → 40s after a round of playtesting —
      // the original threshold tripped during normal thinking pauses.
      if (Date.now() - lastActivityRef.current > 40_000) {
        setShowAfkAlert(true);
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [currentPlayer, gameStatus]);

  // Sprint 3.2 — checkmate flash: brief radial whiteout via a body
  // class. Triggers whenever gameStatus transitions to 'checkmate'.
  // CSS animation handles cleanup; we still strip the class after the
  // animation length so the class doesn't sit on body indefinitely.
  useEffect(() => {
    if (gameStatus !== 'checkmate') return;
    document.body.classList.add('checkmate-flash');
    const t = setTimeout(() => {
      document.body.classList.remove('checkmate-flash');
    }, 1500);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('checkmate-flash');
    };
  }, [gameStatus]);

  // Sprint 3.4.1 — the per-capture burst useEffect that watched
  // log.moves.length has been removed; captures no longer get their
  // own visual flash (see state-declarations block above for the
  // rationale).

  // Sprint 3.6 — clear annotations on every new move so the scratch
  // pad doesn't leak into the next ply. Plus a document-level
  // mouseup so a right-drag that's released off the board still
  // resets annotationStartRef instead of leaving it stuck.
  useEffect(() => {
    setSquareAnnotations((prev) => (prev.size === 0 ? prev : new Map()));
    setArrowAnnotations((prev) => (prev.length === 0 ? prev : []));
  }, [log.moves.length]);

  // Sprint 3.7 — move-driven SFX dispatch. Fires once per new top
  // log entry; priority: checkmate > promotion > capture > move.
  // Brilliant / blunder reactions live in triggerFlash below — they
  // run on classifier callback, not on the synchronous move dispatch.
  const lastSfxLogLengthRef = useRef(0);
  useEffect(() => {
    const len = log.moves.length;
    if (len === 0) {
      lastSfxLogLengthRef.current = 0;
      return;
    }
    if (len <= lastSfxLogLengthRef.current) {
      lastSfxLogLengthRef.current = len;
      return;
    }
    lastSfxLogLengthRef.current = len;
    if (gameStatus === 'checkmate') {
      audio.play('checkmate');
      return;
    }
    const last = log.moves[len - 1];
    if (!last) return;
    if (last.move.kind === 'promotion') {
      audio.play('promotion');
      return;
    }
    if (last.move.kind === 'capture' || last.move.kind === 'enPassant') {
      audio.play('capture');
      return;
    }
    audio.play('move');
  }, [log.moves.length, gameStatus]);

  useEffect(() => {
    function onUp(e: MouseEvent) {
      if (e.button === 2) {
        // Defer the reset by a tick so the synthetic tile-onMouseUp
        // (which reads the ref to finalise the annotation) runs first.
        queueMicrotask(() => {
          annotationStartRef.current = null;
        });
      }
    }
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // Auto-trigger the human's roulette spin after the first manual click of
  // the game. Conditions mirror the Spin Roulette button's enabled-state:
  // roulette mode, not currently spinning, human's turn, no roll active,
  // game still in progress, watcher not engaged. 500ms delay keeps the
  // turn boundary visible.
  useEffect(() => {
    if (isMultiplayer) return; // MP has its own auto-spin effect below
    if (gameMode !== 'roulette') return;
    if (!firstRouletteSpinDone) return;
    if (gameStatus !== 'active') return;
    if (watchingGame) return;
    if (currentPlayer !== 'human') return;
    if (allowedPieceTypes !== null) return;
    if (isRouletteSpinning) return;
    const t = setTimeout(() => {
      doSpinRouletteNow();
    }, 500);
    return () => clearTimeout(t);
    // doSpinRouletteNow re-allocates each render (captures the latest state
    // via closure) — listing it would re-fire the effect every render and
    // restart the 500ms timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameMode,
    firstRouletteSpinDone,
    gameStatus,
    watchingGame,
    currentPlayer,
    allowedPieceTypes,
    isRouletteSpinning,
    isMultiplayer,
  ]);

  // Q.D.3: MP roulette auto-spin. Fires only when I need a fresh bag AND
  // I've already done at least one manual spin in this match. Pre-spin
  // means rouletteSlots===null. mid-turn (action 2) ALSO has slots set
  // — so the trigger condition is rouletteSlots===null while my turn is
  // active.
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    if (!mpSync.isRouletteMode) return;
    if (!mpSync.isMyTurn) return;
    if (mpSync.matchState.status !== 'active') return;
    if (mpSync.rouletteSlots !== null) return;
    if (mpSync.mySpinCount === 0) return; // first spin is manual
    const t = setTimeout(() => {
      void mpSync.spinRoulette();
    }, 500);
    return () => clearTimeout(t);
    // spinRoulette identity changes each render; same pattern as solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMultiplayer,
    mpSync?.isRouletteMode,
    mpSync?.isMyTurn,
    mpSync?.matchState.status,
    mpSync?.rouletteSlots,
    mpSync?.mySpinCount,
  ]);

  // Mode can only be switched before the first move — otherwise rules would
  // change mid-game (e.g. switching out of Roulette skips a spin).
  const modeToggleLocked = log.moves.length > 0 || state.fullmoveNumber > 1;

  // --- Roulette AI helpers (state-driven; each is ONE atomic state transition).

  // Pick the best AI move from a set of allowed moves.
  // Priority: (a) king capture, (b) highest-value capture, (c) random fallback.
  function pickAiRouletteMove(bs: BoardState, playable: Move[]): Move {
    const enemy: Color = bs.sideToMove === 'white' ? 'black' : 'white';
    const enemyKingSq = findKing(bs, enemy);
    if (enemyKingSq) {
      const kingCap = playable.find((m) => m.to === enemyKingSq);
      if (kingCap) return kingCap;
    }
    const scored = playable
      .map((m) => {
        const victim = m.to ? bs.pieces[m.to] : undefined;
        return { m, score: victim ? PIECE_VALUE[victim.type] : 0 };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) return scored[0].m;
    return playable[Math.floor(Math.random() * playable.length)];
  }

  // Apply the AI's spin. Sets allowedPieceTypes, seeds actions / slots, and
  // exits — the main effect picks up Phase 2 on the next render.
  function applyAiSpin(bs: BoardState) {
    const activeTypes = getActivePieceTypes(bs, bs.sideToMove);
    const pawnBoost = rouletteSpinCount < 3;
    const rolled = spinRoulette(activeTypes, pawnBoost);
    setRouletteSpinCount((n) => n + 1);
    setAllowedPieceTypes(rolled);
    setUsedRouletteSlots([]);
    setRouletteActionsLeft(ROULETTE_MAX_ACTIONS);
    setLegalMoves(playableRouletteMoves(bs, rolled, []));
  }

  // Apply an AI rotation as one action. Same semantics as handleRotate's
  // roulette branch, but self-contained for the AI driver.
  function executeAiRouletteRotation(
    bs: BoardState,
    rolled: PieceType[],
    used: number[],
    actionsLeft: number,
  ) {
    const rotated = applyRotationMove(bs);
    const toggleMove: Move = { kind: 'topologyToggle' };
    const san = computeSAN(bs, toggleMove);
    setLog((prev) => appendMove(prev, toggleMove, san, bs.topologyState));
    setLastMove(null);

    const actionsAfter = actionsLeft - 1;

    if (actionsAfter === 0) {
      setState(rotated);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(rotated));
      return;
    }

    // Stay on turn. Clamp side back; no further rotation allowed this turn.
    const clamped: BoardState = { ...rotated, sideToMove: bs.sideToMove };
    const nextPlayable = playableRouletteMoves(clamped, rolled, used);
    if (nextPlayable.length === 0) {
      // Nothing useful left — end the turn.
      setState(rotated);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(rotated));
      return;
    }

    setState(clamped);
    setRouletteActionsLeft(actionsAfter);
    setLegalMoves(nextPlayable);
    // allowedPieceTypes and usedRouletteSlots unchanged.
  }

  // Execute ONE AI sub-move and update React state. Never schedules another
  // timer — the effect re-fires on the resulting state change.
  function executeAiRouletteAction(
    bs: BoardState,
    rolled: PieceType[],
    used: number[],
    actionsLeft: number,
  ) {
    const playable = playableRouletteMoves(bs, rolled, used);

    if (playable.length === 0) {
      // No piece move for the remaining slots. Try rotation as a fallback:
      // only worthwhile if the rotated topology opens up playable moves.
      const canRotate = !bs.lastMoveWasRotation;
      if (canRotate) {
        const rotatedPreview = toggleTopology(bs);
        const postRotPlayable = playableRouletteMoves(rotatedPreview, rolled, used);
        if (postRotPlayable.length > 0) {
          executeAiRouletteRotation(bs, rolled, used, actionsLeft);
          return;
        }
      }
      // Truly stuck — pass the turn.
      const passed = applyPassMove(bs);
      setState(passed);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(passed));
      setLastMove(null);
      return;
    }

    const choice = pickAiRouletteMove(bs, playable);
    const mv: Move =
      choice.kind === 'promotion' && !choice.promotion
        ? { ...choice, promotion: 'queen' }
        : choice;
    const moverType = bs.pieces[mv.from!]!.type;
    const slotIdx = consumeSlotIndex(rolled, used, moverType);
    const newUsed = slotIdx >= 0 ? [...used, slotIdx] : used;
    const newActions = actionsLeft - 1;

    const san = computeSAN(bs, mv);
    const afterMove = applyMove(bs, mv);

    setLog((prev) => appendMove(prev, mv, san, bs.topologyState));
    setLastMove({ from: mv.from, to: mv.to });

    const kingCaptured =
      !findKing(afterMove, 'white') || !findKing(afterMove, 'black');

    if (kingCaptured) {
      setState(afterMove);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      checkGameOver(afterMove);
      return;
    }

    const noMoreActions = newActions <= 0;
    const clampedNext: BoardState = { ...afterMove, sideToMove: bs.sideToMove };
    const nextPlayable = noMoreActions
      ? []
      : playableRouletteMoves(clampedNext, rolled, newUsed);
    // Can the AI still do *something* next action? Either a piece move exists,
    // or rotation is available (and potentially useful — checked by the next
    // executeAiRouletteAction call).
    const canContinue =
      nextPlayable.length > 0 || !clampedNext.lastMoveWasRotation;
    const endTurn = noMoreActions || !canContinue;

    if (endTurn) {
      // Accept the side flip from applyMove — opponent's spin phase next.
      setState(afterMove);
      setAllowedPieceTypes(null);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setLegalMoves(getLegalMoves(afterMove));
      return;
    }

    // Keep AI on the turn — clamp sideToMove back to 'bs.sideToMove'.
    setState(clampedNext);
    setUsedRouletteSlots(newUsed);
    setRouletteActionsLeft(newActions);
    setLegalMoves(nextPlayable);
  }

  const scheduleAiMove = useCallback(
    (
      boardState: BoardState,
      moves: Move[],
      lastMoveWasRotation: boolean,
    ) => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      aiTimerRef.current = setTimeout(async () => {
        const chosen = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation,
          allowSelfCheck: gameMode === 'roulette',
          strength: botLevelRef.current,
        });
        // R15-bug — clearTimeout can't stop a callback that already fired
        // and is parked on the await above. If a PvP match started while
        // the engine was thinking, this continuation must NOT touch the
        // solo world: its checkGameOver would set a terminal gameStatus
        // that the MP UI reads (banner over the board, clock hidden).
        if (isMultiplayerRef.current) return;
        if (!chosen) return;
        if (chosen.kind === 'topologyToggle' && boardState.lastMoveWasRotation) {
          console.warn('[rotation guard] AI returned rotation when not allowed — ignoring');
          return;
        }

        // T4 — Twitch move-vote gate. No-op (returns `chosen` instantly)
        // unless a vote mode is on and chat is connected. In predict
        // mode the gate holds the engine's move through a 15s vote
        // window; in chat mode it substitutes the chat-elected move.
        // Classic only — roulette's slot rules don't fit the candidate
        // model.
        const logLenBeforeGate = logLengthRef.current;
        const move =
          gameMode === 'classic'
            ? await moveVoting.gate(boardState, moves, chosen)
            : chosen;
        // T6 — the 15s vote window can outlive the game it started in
        // (new game / restore). Any log rewrite shifts the length; bail
        // instead of committing a move onto a different position.
        if (logLengthRef.current !== logLenBeforeGate) return;

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        setState(next);
        const nextMoves = getLegalMoves(next);
        setLegalMoves(nextMoves);
        setSelected(null);
        const aiSan = computeSAN(boardState, move);
        setLog((prev) => appendMove(prev, move, aiSan, boardState.topologyState));
        setLastMove(
          move.kind === 'topologyToggle'
            ? null
            : { from: move.from, to: move.to },
        );

        // Worker-backed classify: takes ~1 s of background work for depth 7
        // but doesn't block the main thread. logLengthRef gives us AI's
        // moveIdx (the count BEFORE the append we just did would be the same
        // value the ref still holds, so capture it BEFORE setLog above runs
        // its commit — which it has, but the ref only updates on next effect.
        // In practice the timing works because we read it right after the
        // synchronous setLog call returns).
        if (move.kind !== 'topologyToggle') {
          const moveIdx = logLengthRef.current;
          // B3 — material-delta bump instead of static-fallback flicker.
          setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, boardState, move));
          setSearchMateInPlies(null);
          const aiAnalysis = await classifyAsync(boardState, move, next, {
            budgetMs: scaleBudgetMs(1000),
            maxDepth: 7,
            allowSelfCheck: gameMode === 'roulette',
          });
          commitAnalysis(moveIdx, aiAnalysis, move.to);
        }

        checkGameOver(next, move.kind === 'topologyToggle');
      }, 650);
    },
    [commitAnalysis],
  );

  // Slim AI step for auto mode: no classifier round-trip, tighter delay.
  // The standard scheduleAiMove path is preserved unchanged for human play.
  const scheduleAutoMove = useCallback(
    (boardState: BoardState, moves: Move[], wasRotation: boolean) => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      autoTimerRef.current = setTimeout(async () => {
        const move = await SubutaiAgent.chooseMove(boardState, moves, {
          lastMoveWasRotation: wasRotation,
          allowSelfCheck: gameMode === 'roulette',
        });
        if (!move) return;
        if (move.kind === 'topologyToggle' && boardState.lastMoveWasRotation) return;

        const next =
          move.kind === 'topologyToggle'
            ? applyRotationMove(boardState)
            : applyMove(boardState, move);

        const san = computeSAN(boardState, move);
        setState(next);
        setLegalMoves(getLegalMoves(next));
        setSelected(null);
        setLog((prev) => appendMove(prev, move, san, boardState.topologyState));
        setLastMove(
          move.kind === 'topologyToggle'
            ? null
            : { from: move.from, to: move.to },
        );
        autoLastMoveAtRef.current = Date.now();
        checkGameOver(next, move.kind === 'topologyToggle');

        // Label the resulting position with a shallow search score. Synchronous
        // (worker-free) so we don't add a second round-trip per move. Wrapped
        // in try/catch — a labeller failure must never stall the auto loop.
        try {
          const labelled = searchPosition(next, {
            budgetMs: AUTO_SEARCH_LABEL_BUDGET_MS,
            maxDepth: AUTO_SEARCH_LABEL_DEPTH,
          });
          const scoreFromWhite =
            next.sideToMove === 'white' ? labelled.score : -labelled.score;
          setLog((prev) => attachSearchScoreToLastMove(prev, scoreFromWhite));
        } catch (err) {
          console.warn('[autoplay] label search failed', err);
        }
      }, AUTO_MOVE_DELAY_MS);
    },
    // checkGameOver is captured from the enclosing scope; identical pattern to
    // scheduleAiMove which also does not list it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lastMoveWasRotation =
    log.moves.length > 0 &&
    log.moves[log.moves.length - 1]?.move.kind === 'topologyToggle';

  const materialBreakdown = useMemo(() => {
    const pieceOrder: PieceType[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
    const white: Record<PieceType, number> = {
      queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
    };
    const black: Record<PieceType, number> = {
      queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0, king: 0,
    };
    let whiteTotal = 0;
    let blackTotal = 0;
    for (const piece of Object.values(state.pieces)) {
      if (!piece) continue;
      const v = PIECE_VALUE[piece.type];
      if (piece.color === 'white') {
        white[piece.type]++;
        whiteTotal += v;
      } else {
        black[piece.type]++;
        blackTotal += v;
      }
    }
    const startCount: Record<PieceType, number> = {
      queen: 1, rook: 2, bishop: 2, knight: 2, pawn: 8, king: 1,
    };
    const capturedByWhite: { type: PieceType; count: number; value: number }[] = [];
    const capturedByBlack: { type: PieceType; count: number; value: number }[] = [];
    let capturedByWhiteTotal = 0;
    let capturedByBlackTotal = 0;
    for (const type of pieceOrder) {
      const goneFromBlack = Math.max(0, startCount[type] - black[type]);
      if (goneFromBlack > 0) {
        const value = goneFromBlack * PIECE_VALUE[type];
        capturedByWhite.push({ type, count: goneFromBlack, value });
        capturedByWhiteTotal += value;
      }
      const goneFromWhite = Math.max(0, startCount[type] - white[type]);
      if (goneFromWhite > 0) {
        const value = goneFromWhite * PIECE_VALUE[type];
        capturedByBlack.push({ type, count: goneFromWhite, value });
        capturedByBlackTotal += value;
      }
    }
    return {
      score: whiteTotal - blackTotal,
      capturedByWhite,
      capturedByBlack,
      capturedByWhiteTotal,
      capturedByBlackTotal,
      whiteTotal,
      blackTotal,
    };
  }, [state.pieces]);

  // materialBreakdown.score is white-perspective (whiteTotal - blackTotal).
  // T5.1: flip for the black seat in PvP so the counter follows the same
  // viewer-perspective convention as the eval bar and gradient — green
  // when I'm up material, red when down.
  const materialScore =
    myColor === 'black' ? -materialBreakdown.score : materialBreakdown.score;

  useEffect(() => {
    if (isMultiplayer) return; // PvP: no engine drives the opponent
    if (gameStatus !== 'active') return;
    if (watchingGame) return; // replay mode — never let the AI move.
    if (isAutoMode) {
      if (autoStopped) return;
      scheduleAutoMove(state, legalMoves, lastMoveWasRotation);
      return () => {
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      };
    }
    if (currentPlayer !== 'ai') return;

    // Classic: the old path handles its own setTimeout + minimax.
    if (gameMode !== 'roulette') {
      scheduleAiMove(state, legalMoves, lastMoveWasRotation);
      return () => {
        if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      };
    }

    // --- Roulette (state-driven, one phase per render) -------------------
    //
    // Each branch schedules exactly ONE timer and performs ONE atomic state
    // transition. No chained timers, no closures over stale state: after the
    // timer fires and state updates, React re-runs this effect with fresh
    // state and selects the next phase.
    //
    // Phase 1 — AI spins (no roll yet).
    // Phase 2a — AI has rolled; execute action 1 after REVEAL pause.
    // Phase 2b — AI has acted once; execute action 2 after THINK pause.
    // (2a and 2b are the same branch; the delay is longer on the first one
    //  so the human can see the fresh roll.)

    if (allowedPieceTypes === null) {
      // Phase 1 — AI spin. Always runs after a short pause; the first-spin
      // gate only applies to human turns (auto-spin effect there waits for
      // the player's first manual click).
      const t = setTimeout(() => {
        applyAiSpin(state);
      }, 500);
      aiTimerRef.current = t;
      return () => clearTimeout(t);
    }

    if (rouletteActionsLeft > 0) {
      // Phase 2a/2b — one action, then exit. State change re-triggers effect.
      const delay =
        usedRouletteSlots.length === 0
          ? AI_ROULETTE_REVEAL_MS
          : AI_ROULETTE_BETWEEN_ACTIONS_MS;
      const t = setTimeout(() => {
        executeAiRouletteAction(
          state,
          allowedPieceTypes,
          usedRouletteSlots,
          rouletteActionsLeft,
        );
      }, delay);
      aiTimerRef.current = t;
      return () => clearTimeout(t);
    }
  // The helpers (applyAiSpin, executeAiRouletteAction) are re-created each
  // render and close over the current setState setters (stable refs). We
  // intentionally depend on the roulette fields so each phase transition
  // re-fires the effect with the latest state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPlayer,
    state,
    gameStatus,
    gameMode,
    allowedPieceTypes,
    rouletteActionsLeft,
    usedRouletteSlots,
    legalMoves,
    scheduleAiMove,
    scheduleAutoMove,
    lastMoveWasRotation,
    watchingGame,
    isAutoMode,
    autoStopped,
    isMultiplayer,
  ]);

  // T6 — "chat vs bot": chat plays the human (white) side by majority.
  // Mirrors the AI vote gate but on the HUMAN turn: open a free-form
  // round (chat types SAN / coordinates), then commit the elected move
  // through the same classic-mode path a click would take. The cleanup
  // cancels the round whenever the position changes under it — which is
  // exactly what happens when the streamer overrides by moving manually.
  useEffect(() => {
    if (twitchVoteMode !== 'chatvsbot') return;
    if (isMultiplayer || isLocalMode || isAutoMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;
    let stale = false;
    void moveVoting.gateHumanMove(state, legalMoves, rotateIsLegal(state)).then((move) => {
      if (stale || !move) return;
      // R10 — chat elected to rotate the board as its move. handleRotate
      // re-checks legality itself; the round only offered "rotate" while
      // it was legal, and this effect re-fires on any position change.
      if (move.kind === 'topologyToggle') {
        handleRotate();
        return;
      }
      if (!move.from || !move.to) return;
      const san = computeSAN(state, move);
      const afterMove = applyMove(state, move);
      setLog((prev) => appendMove(prev, move, san, state.topologyState));
      setLastMove({ from: move.from, to: move.to });
      beatBridge.reportMove();
      setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, move));
      setSearchMateInPlies(null);
      const moveIdx = logLengthRef.current;
      void classifyAsync(state, move, afterMove, {
        budgetMs: scaleBudgetMs(1000),
        maxDepth: 7,
        allowSelfCheck: false,
      }).then((analysis) => {
        commitAnalysis(moveIdx, analysis, move.to);
      });
      setState(afterMove);
      setLegalMoves(getLegalMoves(afterMove));
      setSelected(null);
      checkGameOver(afterMove);
    });
    return () => {
      stale = true;
      moveVoting.cancelRound();
    };
  // Commit helpers close over this render's state; the effect re-fires on
  // any position change, so the captures stay fresh (same contract as the
  // AI scheduler above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    twitchVoteMode,
    isMultiplayer,
    isLocalMode,
    isAutoMode,
    watchingGame,
    gameMode,
    gameStatus,
    currentPlayer,
    state,
    legalMoves,
  ]);

  // R2 — "guess the streamer": while it's the human's turn, an open-ended
  // free-form round collects chat's guesses. Nothing awaits it — the
  // resolution happens inside the human commit paths (resolveGuessRound),
  // and the cleanup cancels a still-unrevealed round when the position
  // changes some other way (undo, reset, mode flip). A revealed round is
  // left alone; its banner clears itself.
  useEffect(() => {
    if (twitchVoteMode !== 'guess') return;
    if (isMultiplayer || isLocalMode || isAutoMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;
    moveVoting.openGuessRound(state, legalMoves, rotateIsLegal(state));
    return () => moveVoting.cancelRound();
  }, [
    twitchVoteMode,
    isMultiplayer,
    isLocalMode,
    isAutoMode,
    watchingGame,
    gameMode,
    gameStatus,
    currentPlayer,
    state,
    legalMoves,
  ]);

  // Stage T1: trigger the en-passant explosion overlay whenever a new
  // EP move lands in the log — works for both solo + MP because the log
  // alias covers both. Captured pawn sits at (file of `to`, rank of `from`).
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last) return;
    const mv = last.move;
    if (mv.kind !== 'enPassant' || !mv.from || !mv.to) return;
    const captureSq = (mv.to[0] + mv.from[1]) as SquareId;
    setEnPassantExplosionSquare(captureSq);
    const t = setTimeout(() => setEnPassantExplosionSquare(null), 700);
    return () => clearTimeout(t);
  }, [log.moves.length]);

  // R17c — the board as it stood BEFORE the latest log entry. The snapshot
  // effect below is declared AFTER the capture/rotation effects, so within
  // one commit they read the pre-move board (declaration order = run
  // order) and only then the ref advances. pieces[mv.to] on the snapshot
  // is therefore the piece that just got taken.
  const prevBoardRef = useRef<BoardState | null>(null);

  // R17a — spark burst + micro-shake on every plain capture (EP keeps its
  // dedicated bigger explosion above). Promotion-captures are skipped:
  // the log entry can't tell a quiet promotion from a capturing one.
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last) return;
    const mv = last.move;
    if (mv.kind !== 'capture' || !mv.to) return;
    registerFx();
    setCaptureFxSquare(mv.to as SquareId);
    setCaptureShake(true);
    const t1 = setTimeout(() => setCaptureFxSquare(null), 620);
    const t2 = setTimeout(() => setCaptureShake(false), 300);
    // R17c/M.22 — strobe frames on any non-pawn capture. Pawns keep just
    // the plain capture-burst spark (they're the most common loss, and
    // keeping them "lighter" preserves the hierarchy: losing a piece that
    // isn't a pawn is the moment worth a bigger flourish).
    const victim = prevBoardRef.current?.pieces[mv.to as SquareId];
    let t3: ReturnType<typeof setTimeout> | null = null;
    if (
      victim &&
      (victim.type === 'queen' ||
        victim.type === 'rook' ||
        victim.type === 'bishop' ||
        victim.type === 'knight')
    ) {
      setCaptureStrobe(victim.type);
      t3 = setTimeout(() => setCaptureStrobe(null), 760);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (t3) clearTimeout(t3);
    };
    // registerFx is stable; the effect keys off the move count as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.moves.length]);

  // R17c — dust shockwave when a topology rotation commits.
  useEffect(() => {
    const last = log.moves[log.moves.length - 1];
    if (!last || last.move.kind !== 'topologyToggle') return;
    setRotationDust(true);
    // V1 — a rotation can promote a pawn it swings onto the far row (see
    // promoteStrandedPawns). The piece changes without anyone moving it,
    // so say so — otherwise a queen simply appears where a pawn was.
    // Only when `before` is the board this rotation was made from: loading,
    // resuming or replaying a game whose log ends in a rotation lands here
    // with the PREVIOUS game's snapshot, and its pawns are not this game's.
    const before = prevBoardRef.current;
    if (before && before.topologyState !== state.topologyState) {
      const { pieces: rotated, promoted } = promoteStrandedPawns(before.pieces, state.topologyState);
      if (promoted.length > 0 && samePieces(rotated, state.pieces)) {
        toast.show(
          promoted.length === 1
            ? `The rotation carried the pawn on ${promoted[0]} to the edge — it's a queen now.`
            : `The rotation carried ${promoted.length} pawns to the edge — they're queens now.`,
          'info',
          4200,
        );
      }
    }
    const t = setTimeout(() => setRotationDust(false), 780);
    return () => clearTimeout(t);
    // `state` is read for the topology the rotation just produced; the
    // effect keys off the move count exactly as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.moves.length]);

  // R17c — snapshot advance. MUST stay declared after the two effects
  // above (see prevBoardRef comment). Ref write only — no render churn.
  useEffect(() => {
    prevBoardRef.current = state;
  }, [state]);

  const highlightedTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const targets = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.to) targets.add(move.to);
      // Chess960: clicking the own rook also triggers castling, so the rook
      // square is a valid interaction target for a selected king.
      if (move.kind === 'castle' && move.castleRookFrom) {
        targets.add(move.castleRookFrom);
      }
    }
    return targets;
  }, [legalMoves, selected]);


  // Stage T1: en-passant target squares get a distinct pulse so the player
  // notices the rare opportunity. Disjoint from the regular green dots.
  const enPassantTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const ep = new Set<string>();
    for (const move of legalMoves) {
      if (move.from !== selected) continue;
      if (move.kind === 'enPassant' && move.to) ep.add(move.to);
    }
    return ep;
  }, [legalMoves, selected]);

  const checkSquares = useMemo(() => {
    const empty = { king: null as string | null, checkers: new Set<string>() };
    if (previewTopology && previewTopology !== state.topologyState) {
      const toggled = toggleTopology(state);
      const viewState: BoardState = { ...toggled, sideToMove: state.sideToMove };
      const king = findKing(viewState, state.sideToMove);
      if (!king) return empty;
      const opp = state.sideToMove === 'white' ? 'black' as const : 'white' as const;
      if (!isSquareAttacked(viewState, king, opp, viewState.topologyState)) return empty;
      return { king, checkers: new Set<string>(findCheckingPieces(viewState)) };
    }
    if (!isInCheck(state)) return empty;
    const king = findKing(state, state.sideToMove);
    const checkers = new Set<string>(findCheckingPieces(state));
    return { king, checkers };
  }, [previewTopology, state]);

  // R17b — pulse the red vignette when a REAL check lands: only on the
  // null→checked transition, and never for the rotation-preview's
  // hypothetical checks (checkSquares computes those too).
  const prevCheckKingRef = useRef<string | null>(null);
  useEffect(() => {
    const king = previewTopology ? null : checkSquares.king;
    const was = prevCheckKingRef.current;
    prevCheckKingRef.current = king;
    if (!king || was) return;
    registerFx();
    setCheckVignette(true);
    const t = setTimeout(() => setCheckVignette(false), 900);
    return () => clearTimeout(t);
  }, [checkSquares.king, previewTopology, registerFx]);

  // Motion scaffold — soft tactile sound the instant a piece is picked up.
  // Central effect (not scattered at every setSelected call site) so it
  // fires exactly once per null -> square transition, same shape as the
  // check-vignette effect above. Skipped while replaying/watching a game —
  // the viewer isn't the one touching pieces.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (!selected || was || watchingGame) return;
    audio.play('pieceTouch');
  }, [selected, watchingGame]);

  const displayTopology =
    previewLocked && lockedPreviewTopology
      ? lockedPreviewTopology
      : (previewTopology ?? state.topologyState);

  const threatenedSquares = useMemo(() => {
    if (!showThreats) return new Map<string, number>();
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    const analyzeState: BoardState = { ...state, topologyState: displayTopology };
    const counts = new Map<string, number>();
    for (const sq of allSquares) {
      const c = countAttackers(analyzeState, sq, opp, displayTopology);
      if (c > 0) counts.set(sq, c);
    }
    return counts;
  }, [showThreats, state, displayTopology]);

  const supportPairs = useMemo((): [SquareId, SquareId][] => {
    if (!showSupport) return [];
    const ourColor: Color = 'white';
    const pairs: [SquareId, SquareId][] = [];
    for (const to of allSquares) {
      const piece = state.pieces[to];
      if (!piece || piece.color !== ourColor) continue;
      const attackers = getAttackerSquares(state, to, ourColor, displayTopology);
      for (const from of attackers) {
        if (from !== to) pairs.push([from, to]);
      }
    }
    return pairs;
  }, [showSupport, state, displayTopology]);

  const threateningPieceSquares = useMemo(() => {
    if (!showThreats || !hoveredSquare || !threatenedSquares.has(hoveredSquare)) return new Set<string>();
    const opp: Color = state.sideToMove === 'white' ? 'black' : 'white';
    const attackers = getAttackerSquares(state, hoveredSquare as SquareId, opp, displayTopology);
    return new Set(attackers);
  }, [showThreats, hoveredSquare, threatenedSquares, state, displayTopology]);

  const hoverSupporters = useMemo((): SquareId[] => {
    if (!showSupport || !selected || !hoveredSquare) return [];
    return getAttackerSquares(state, hoveredSquare as SquareId, 'white', displayTopology);
  }, [showSupport, selected, hoveredSquare, state, displayTopology]);

  // Sprint 3.7 (rev 2) — Sprint 3.6's hoverInsights useMemo and the
  // .attacker-of-hovered / .defender-of-hovered tile classes are
  // gone; the restored Threat / Support toggle buttons drive the
  // overlay via the existing supportPairs / threatenedSquares /
  // threateningPieceSquares pipeline instead.

  // Sprint 3.6 — right-click annotation handlers. Bound on every tile
   // alongside onClick. Left-click logic is untouched: button !== 2
   // exits these helpers immediately.
  function colorFromMouseEvent(e: React.MouseEvent): AnnotationColor {
    if (e.shiftKey) return 'red';
    if (e.altKey) return 'yellow';
    if (e.ctrlKey || e.metaKey) return 'blue';
    return 'green';
  }

  function handleTileContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  function handleTileMouseDown(e: React.MouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    e.preventDefault();
    annotationStartRef.current = sq;
  }

  function handleTileMouseUp(e: React.MouseEvent, sq: SquareId) {
    if (e.button !== 2) return;
    const start = annotationStartRef.current;
    annotationStartRef.current = null;
    if (!start) return;
    const color = colorFromMouseEvent(e);
    if (start === sq) {
      setSquareAnnotations((prev) => {
        const next = new Map(prev);
        if (next.get(sq) === color) {
          next.delete(sq);
        } else {
          next.set(sq, color);
        }
        return next;
      });
    } else {
      setArrowAnnotations((prev) => {
        const existing = prev.findIndex(
          (a) => a.from === start && a.to === sq && a.color === color,
        );
        if (existing >= 0) {
          return prev.filter((_, i) => i !== existing);
        }
        return [...prev, { from: start, to: sq, color }];
      });
    }
  }

  function onSquareClick(square: string) {
    if (watchingGame) return; // replay mode is read-only.
    // SP-3 Beat Mode — a move is queued to land on the next beat; ignore
    // further board input until it commits so the snap can't be raced.
    if (beatSnapPendingRef.current) return;

    // Multiplayer: bypass the local engine pipeline entirely. Selection +
    // legalMoves are the same shared values; the only difference is the
    // move dispatch sends through Firestore instead of mutating local state.
    if (isMultiplayer) {
      if (!mpSync || !mpSync.isMyTurn) return;
      if (mpSync.matchState.status !== 'active') return;
      const sq = square as SquareId;
      const piece = state.pieces[sq];
      // Q.D.3: MP roulette — board is dead until the on-clock player
      // spins. After spin only piece types whose slot index is still
      // unused can be selected.
      const isMpRoulette = mpSync.isRouletteMode;
      if (isMpRoulette && mpSync.rouletteSlots === null) return;
      const canSelect = (type: PieceType): boolean =>
        !isMpRoulette ||
        isPieceMovableInRoulette(
          type,
          state,
          'roulette',
          mpSync.rouletteSlots,
          mpSync.usedRouletteSlots,
        );
      if (!selected) {
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelect(piece.type)
        ) {
          setSelected(square);
        }
        return;
      }
      if (selected === square) {
        setSelected(null);
        return;
      }
      const move = legalMoves.find(
        (m) => m.from === selected && m.to === square,
      );
      if (!move) {
        // Click on another own piece → switch; else clear.
        if (
          piece &&
          piece.color === mpSync.myColor &&
          canSelect(piece.type)
        ) {
          setSelected(square);
        } else {
          setSelected(null);
        }
        return;
      }
      // R13b — classic MP gets the same promotion picker as solo (the
      // auto-queen shortcut made underpromotion impossible in PvP).
      // Roulette keeps auto-queen to preserve the multi-action flow.
      if (
        move.kind === 'promotion' &&
        move.from &&
        move.to &&
        mpSync.matchState.gameMode !== 'roulette'
      ) {
        setPendingPromotion({ from: move.from, to: move.to });
        return;
      }
      const resolved: Move =
        move.kind === 'promotion' && !move.promotion
          ? { ...move, promotion: 'queen' }
          : move;
      setSelected(null);
      void mpSync.sendMove(resolved);
      return;
    }

    if (gameStatus !== 'active') return;
    if (currentPlayer !== 'human') return;

    // In roulette mode the board is locked until a roll has happened.
    if (gameMode === 'roulette' && allowedPieceTypes === null) return;

    // In roulette mode, each sub-move needs an action point.
    if (gameMode === 'roulette' && rouletteActionsLeft <= 0) return;

    // Q.D.5: route every piece-type gate through isPieceMovableInRoulette
    // so the in-check override applies uniformly to selection, legal-move
    // computation, and re-selection on miss-click.
    const activeMoves: Move[] =
      gameMode === 'roulette'
        ? getLegalMoves(state).filter((m) => {
            if (!m.from) return false;
            const p = state.pieces[m.from];
            if (!p) return false;
            return isPieceMovableInRoulette(
              p.type,
              state,
              gameMode,
              allowedPieceTypes,
              usedRouletteSlots,
            );
          })
        : legalMoves;
    const canSelectSolo = (type: PieceType): boolean =>
      isPieceMovableInRoulette(
        type,
        state,
        gameMode,
        allowedPieceTypes,
        usedRouletteSlots,
      );

    if (!selected) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!canSelectSolo(p.type)) return;
      }
      setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    let move = activeMoves.find(
      (m) => m.from === selected && m.to === square,
    );
    if (!move) {
      move = activeMoves.find(
        (m) =>
          m.from === selected &&
          m.kind === 'castle' &&
          m.castleRookFrom === square,
      );
    }
    if (!move) {
      if (gameMode === 'roulette') {
        const p = state.pieces[square as SquareId];
        if (!p || p.color !== state.sideToMove) return;
        if (!canSelectSolo(p.type)) return;
      }
      setSelected(square);
      return;
    }
    // Promotion picker (classic only — in roulette we auto-queen to keep the
    // multi-action flow uninterrupted).
    if (move.kind === 'promotion' && move.from && move.to && gameMode !== 'roulette') {
      setPendingPromotion({ from: move.from, to: move.to });
      return;
    }
    const resolvedMove: Move =
      gameMode === 'roulette' && move.kind === 'promotion' && !move.promotion
        ? { ...move, promotion: 'queen' }
        : move;

    // SP-3 / M.14 Beat Mode — in classic solo play the piece GLIDES into
    // place exactly on the beat. The commit closure captures this render's
    // state/log; nothing mutates them during the <1-beat hold (human's
    // turn), so deferring is safe. Roulette/MP excluded.
    //
    // Earlier the move committed ON the beat and the slide started then,
    // so the piece arrived a slide-length late and felt laggy. Now we
    // figure out whether this move will visually slide (both tiles
    // unrotated in the current topology) and, if so, commit a slide-
    // length EARLY so the glide LANDS on the beat. The ring keeps filling
    // until the beat, popping as the piece touches down.
    if (gameMode === 'classic' && !isMultiplayer) {
      const from = resolvedMove.from!;
      const to = resolvedMove.to!;
      const willSlide =
        from !== to &&
        tilePixelCenter(to, displayTopology, layout).angle === 0 &&
        tilePixelCenter(from, displayTopology, layout).angle === 0;
      const slideMs = willSlide ? BEAT_SLIDE_MS : 0;
      const plan = beatMode.snapPlan(slideMs);
      if (plan) {
        beatSnapPendingRef.current = true;
        setBeatSnap({ from, to, ms: plan.landMs });
        // R15-bug — the hold used to be ONE fixed setTimeout computed at
        // click time, but since M.26/27 the grid is alive under it: an
        // essentia re-lock (every ~6s) or a PLL nudge moves the beats,
        // and the pre-computed hold landed where the beat USED to be —
        // "Beat Mode лагає". The hold now TRACKS the live grid, waking
        // shortly before each estimated land and re-reading
        // msToNextBeat(); a hard cap (~1.6 beats from click) commits
        // regardless, so a re-anchoring grid can never chase the move
        // away from the player.
        const commitSnap = () => {
          beatSnapPendingRef.current = false;
          setSelected(null);
          commitMove();
          setBeatSnap(null);
        };
        const deadline =
          performance.now() + Math.min(plan.landMs, beatEngine.getIntervalMs() * 1.6);
        const track = () => {
          if (!beatEngine.isRunning()) {
            commitSnap(); // grid stopped mid-hold — play immediately
            return;
          }
          const msLeft = beatEngine.msToNextBeat();
          if (msLeft <= slideMs + 45 || performance.now() >= deadline) {
            // Beat within glide reach (or cap hit): commit so the piece
            // lands on it.
            window.setTimeout(commitSnap, Math.max(0, msLeft - slideMs));
            return;
          }
          window.setTimeout(track, Math.min(60, msLeft - slideMs - 40));
        };
        track();
        return;
      }
    }
    commitMove();
    return;

    // ── commit closure ──────────────────────────────────────────────
    function commitMove() {
    const san = computeSAN(state, resolvedMove);
    // R2 — settle the chat's "guess the streamer" round on the actual move.
    announceGuessWinners(moveVoting.resolveGuessRound(resolvedMove, san));
    const moverType = state.pieces[resolvedMove.from!]!.type;
    const afterMove = applyMove(state, resolvedMove);
    setLog((prev) => appendMove(prev, resolvedMove, san, state.topologyState));
    setLastMove({ from: resolvedMove.from, to: resolvedMove.to });
    // SP-2 — score the move against the beat grid (no-op when music
    // sync is off). Display-only combo; leaderboard points untouched.
    beatBridge.reportMove();
    // Defer classify so the click feels instant — main thread is still
    // single-threaded but the DOM paints first, then the analysis lands
    // ~300 ms later as if the engine is "thinking".
    // Worker-backed classify: keeps the main thread responsive while the
    // ~1 s depth-7 search runs. moveIdx is captured pre-append so the .then
    // can patch by index even if the user / AI has moved on by the time the
    // analysis lands. Visuals are gated to "still the latest move".
    // B3 — bump the previous search-eval by the material delta instead
    // of dropping to the static fallback (the bar was flickering).
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, resolvedMove));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    // Sprint 4.1 — local hot-seat skips the classifier worker. The
    // analysis pipeline is tied to leaderboard / review of solo games
    // vs the AI; in local 2P play there's no scoring and both sides
    // are human, so the cost / noise isn't worth it.
    if (!isLocalMode) {
      classifyAsync(state, resolvedMove, afterMove, {
        budgetMs: scaleBudgetMs(1000),
        maxDepth: 7,
        allowSelfCheck: gameMode === 'roulette',
      })
        .then((analysis) => {
          commitAnalysis(moveIdx, analysis, resolvedMove.to);
        });
    }

    if (gameMode !== 'roulette') {
      setState(afterMove);
      setLegalMoves(getLegalMoves(afterMove));
      setSelected(null);
      checkGameOver(afterMove);
      return;
    }

    // --- Roulette mode: decide whether the turn continues or ends.
    const slotIdx = consumeSlotIndex(allowedPieceTypes!, usedRouletteSlots, moverType);
    const newUsed = slotIdx >= 0 ? [...usedRouletteSlots, slotIdx] : usedRouletteSlots;
    const actionsAfter = rouletteActionsLeft - 1;

    // If a king was just captured, end the game regardless of remaining actions.
    const kingCaptured =
      !findKing(afterMove, 'white') || !findKing(afterMove, 'black');

    let stayOnTurn = false;
    let nextPlayable: Move[] = [];
    if (!kingCaptured && actionsAfter > 0) {
      // Clamp sideToMove back so the same player continues — we still evaluate
      // remaining-slot playability against that clamped state.
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      nextPlayable = playableRouletteMoves(clamped, allowedPieceTypes!, newUsed);
      // Stay on turn if piece moves exist OR rotation is still available
      // (the human may want to spend the remaining action on rotating).
      stayOnTurn = nextPlayable.length > 0 || !clamped.lastMoveWasRotation;
    }

    if (stayOnTurn) {
      const clamped: BoardState = { ...afterMove, sideToMove: state.sideToMove };
      setState(clamped);
      setUsedRouletteSlots(newUsed);
      setRouletteActionsLeft(actionsAfter);
      setLegalMoves(nextPlayable);
      setSelected(null);
    } else {
      // End of turn: accept the side-flip from applyMove, clear roulette state.
      setState(afterMove);
      setUsedRouletteSlots([]);
      setRouletteActionsLeft(0);
      setAllowedPieceTypes(null);
      setLegalMoves(getLegalMoves(afterMove));
      setSelected(null);
    }
    checkGameOver(afterMove);
    } // end commitMove
  }

  function handlePromotion(pieceType: PieceType) {
    if (!pendingPromotion) return;
    const move = legalMoves.find(
      (m) =>
        m.from === pendingPromotion.from &&
        m.to === pendingPromotion.to &&
        m.kind === 'promotion' &&
        m.promotion === pieceType,
    );
    if (!move) return;
    // R13b — MP: the picked piece rides the match doc; the local commit
    // below is solo-only (the MP board re-derives from the shared log).
    if (isMultiplayer && mpSync) {
      setSelected(null);
      setPendingPromotion(null);
      void mpSync.sendMove(move);
      return;
    }
    const san = computeSAN(state, move);
    // R2 — promotion commits bypass commitMove; settle the guess round here too.
    announceGuessWinners(moveVoting.resolveGuessRound(move, san));
    const next = applyMove(state, move);
    setState(next);
    const nextMoves = getLegalMoves(next);
    setLegalMoves(nextMoves);
    setSelected(null);
    setPendingPromotion(null);
    setLog((prev) => appendMove(prev, move, san, state.topologyState));
    setLastMove({ from: move.from, to: move.to });
    beatBridge.reportMove(); // SP-2 — promotion path counts too
    // B3 — material-delta bump instead of static-fallback flicker.
    setSearchEvalFromWhite((prev) => bumpEvalForMove(prev, state, move));
    setSearchMateInPlies(null);
    const moveIdx = log.moves.length;
    classifyAsync(state, move, next, {
      budgetMs: scaleBudgetMs(1000),
      maxDepth: 7,
      allowSelfCheck: gameMode === 'roulette',
    }).then((analysis) => {
      commitAnalysis(moveIdx, analysis, move.to);
    });
    checkGameOver(next);
  }

  const squares = useMemo(() => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return ranks.flatMap((rank) =>
      files.map((file) => `${file}${rank}`),
    );
  }, []);

  const canRotate = useMemo(() => {
    // V1 — a replay is a recording, not a game: nothing on the board may be
    // acted on while watching (the rotate button used to stay live and the
    // roulette Spin button leaked in from the mode the viewer left).
    if (watchingGame) return false;
    if (currentPlayer !== 'human') return false;
    if (state.lastMoveWasRotation) return false; // back-to-back guard

    if (gameMode === 'roulette') {
      // Rotation costs 1 action point — needs an active spin AND >= 1 action.
      // King-safety check is intentionally bypassed (kill-the-king rules).
      return allowedPieceTypes !== null && rouletteActionsLeft >= 1;
    }

    // Classic: standard king-safety self-check.
    const toggled = toggleTopology(state);
    const king = findKing(toggled, state.sideToMove);
    if (!king) return false;
    const opp = state.sideToMove === 'white' ? 'black' : 'white';
    return !isSquareAttacked(toggled, king, opp as 'white' | 'black', toggled.topologyState);
  }, [currentPlayer, state, gameMode, allowedPieceTypes, rouletteActionsLeft, watchingGame]);

  // R5 — nudge the player when they've been clearly behind for a couple of
  // moves, so a hard position reads as "keep fighting" rather than "resign".
  // Checked once per human turn (eval is from white's = the human's side);
  // rate-limited, gated on the coaching-tools switch, solo classic only.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (currentPlayer !== 'human') return;
    const moveIdx = log.moves.length;
    if (moveIdx === 0) {
      // fresh game — clear the streak/cooldown so nudges don't carry over
      encourageBadStreakRef.current = 0;
      encourageLastMoveRef.current = -99;
      encourageCheckedMoveRef.current = -1;
      return;
    }
    if (moveIdx === encourageCheckedMoveRef.current) return; // one check per turn
    const ev = searchEvalFromWhite;
    if (ev === null) return; // eval still pending — re-runs when it lands
    encourageCheckedMoveRef.current = moveIdx;
    const HARD = -2.5; // pawns: the human is down ~a piece or worse
    if (ev > HARD) {
      encourageBadStreakRef.current = 0;
      return;
    }
    encourageBadStreakRef.current += 1;
    if (encourageBadStreakRef.current < 2) return; // must be sustained
    if (moveIdx - encourageLastMoveRef.current < 6) return; // cooldown
    encourageLastMoveRef.current = moveIdx;
    const useRotate = canRotate && Math.random() < 0.6;
    const pool = useRotate ? ENCOURAGE_ROTATE : ENCOURAGE_GENERIC;
    toast.show(pool[Math.floor(Math.random() * pool.length)], 'info', 5200);
    if (useRotate) {
      setEncourageRotate(true);
      window.setTimeout(() => setEncourageRotate(false), 5200);
    }
  }, [
    searchEvalFromWhite,
    currentPlayer,
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    canRotate,
    log.moves.length,
    toast,
  ]);

  // R15 4-lite (a) — early-danger window. Median first blunder is move 4, so
  // the moment the eval first dips in moves 2-10 gets a single "slow down"
  // beat. Fires BEFORE the -2.5 R5 nudge territory (-1.5..-2.5) so the two
  // never stack on the same turn; once per game.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (currentPlayer !== 'human') return;
    if (earlyTipLogIdRef.current === log.id) return;
    const plies = log.moves.length;
    if (plies < 3 || plies > 20) return; // full moves ~2-10
    const ev = searchEvalFromWhite;
    if (ev === null || ev > -1.5 || ev <= -2.5) return;
    earlyTipLogIdRef.current = log.id;
    toast.show(EARLY_GAME_TIP, 'info', 5200);
  }, [
    searchEvalFromWhite,
    currentPlayer,
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    log,
    toast,
  ]);

  // R15 4-lite (b) — rotation aftermath. 25 of 98 first blunders happen right
  // after the player's OWN rotation ("rotated and didn't re-read the board").
  // Classic only: the parity check (even ply = white = human) doesn't hold
  // under roulette's 2-actions-per-turn economy. Once per game.
  useEffect(() => {
    if (isMultiplayer || isLocalMode || watchingGame) return;
    if (gameMode !== 'classic' || gameStatus !== 'active') return;
    if (!helpToolsEnabled) return;
    if (rotateTipLogIdRef.current === log.id) return;
    const idx = log.moves.length - 1;
    if (idx < 0 || idx > 40) return; // the habit matters in the danger window
    const last = log.moves[idx];
    if (last.move.kind !== 'topologyToggle' || idx % 2 !== 0) return;
    rotateTipLogIdRef.current = log.id;
    toast.show(ROTATE_AFTERMATH_TIP, 'info', 5200);
  }, [
    gameStatus,
    gameMode,
    isMultiplayer,
    isLocalMode,
    watchingGame,
    helpToolsEnabled,
    log,
    toast,
  ]);

  const layout = useMemo(
    () => computeBoardLayout(displayTopology, boardSize),
    [displayTopology, boardSize],
  );

  const scale = layout.tileSize / tileBase;

  // M.21 — checkmate death cinematic. Instead of the instant white flash
  // cutting straight to the summary modal, the screen irises down around
  // the mated king (everything else fades to black, the king is the last
  // thing visible), holds a beat, then the king shatters. Fires on ANY
  // checkmate — human win or loss, any mode — since it's dramatizing the
  // king's fate, not the player's. The existing win-only VictoryScene and
  // every "game over" modal (summary / MP / local) wait for this to
  // finish via mateSeqActive below rather than cutting it off.
  // Position falls back to "the side-to-move's king" (findKing) when
  // nobody's actually in check, purely so the subutaiFX.mate() dev seam
  // (below) always has a real square to point at — the real gameplay
  // trigger effect still requires a genuine gameStatus === 'checkmate'.
  /** A king's centre in BOARD pixels, for the iris and the shatter. */
  const boardKingPos = useCallback(
    (sq: string | null, color: Color) => {
      if (!sq) return null;
      const tile = tilePixelCenter(sq as SquareId, displayTopology, layout);
      const flip = isMultiplayer && mpSync?.myColor === 'black';
      return {
        sq,
        color,
        cx: flip ? boardSize - tile.cx : tile.cx,
        cy: flip ? boardSize - tile.cy : tile.cy,
      };
    },
    [displayTopology, layout, boardSize, isMultiplayer, mpSync],
  );

  const mateKingPos = useMemo(
    () =>
      boardKingPos(
        checkSquares.king ?? findKing(state, state.sideToMove),
        // Whose king this is — the side to move is the side being mated.
        state.sideToMove,
      ),
    [checkSquares.king, state, boardKingPos],
  );

  /**
   * V1 — where a given side's king is on screen, in VIEWPORT pixels.
   *
   * mateKingPos above is board-relative, which is all the DOM iris needs
   * (it is absolutely positioned inside .board). The endgame cinematic
   * renders to a full-screen canvas, so it needs the same point in the
   * viewport's frame — hence the board rect. .board carries no border or
   * padding, so its rect origin and the board's own coordinate origin are
   * the same point.
   */
  /**
   * V1 — who won a decisive game, or null if it is not decided or drawn.
   * On a checkmate the mated side is the one to move, so the winner is
   * the other one.
   */
  const decisiveWinner: Color | null = useMemo(() => {
    if (gameStatus === 'checkmate') return state.sideToMove === 'white' ? 'black' : 'white';
    if (gameStatus === 'king_captured_white_wins') return 'white';
    if (gameStatus === 'king_captured_black_wins') return 'black';
    if (gameStatus === 'timeout_white') return 'black';
    if (gameStatus === 'timeout_black') return 'white';
    if (gameStatus === 'resigned_white') return 'black';
    if (gameStatus === 'resigned_black') return 'white';
    return null;
  }, [gameStatus, state.sideToMove]);

  /**
   * V1 — WHOSE king the endgame cut is about.
   *
   * The cut used to lift the losing king in every case, which meant a win
   * ended with a crown descending onto the bot's king. It belongs to the
   * player it is played for:
   *
   *   solo         your king — you are white, win or lose
   *   multiplayer  your king only, whichever colour you were given
   *   hot-seat     the winning king, because neither side is "you" and
   *                the only thing worth dramatising is who took it
   *   spectating / bot-vs-bot   nobody: no cut, the old iris + shatter
   *
   * Null means "no cinematic in this mode", which is also what keeps
   * multiplayer and hot-seat from playing one on a draw.
   */
  const cutSubjectColor: Color | null = useMemo(() => {
    if (watchingGame || isAutoMode) return null;
    if (isMultiplayer) return mpSync?.myColor ?? null;
    if (isLocalMode) return decisiveWinner;
    return HUMAN_COLOR;
  }, [watchingGame, isAutoMode, isMultiplayer, isLocalMode, mpSync?.myColor, decisiveWinner]);

  const kingOriginFor = useCallback(
    (color: Color): KingOrigin | null => {
      const sq = findKing(state, color);
      if (!sq) return null;
      const rect = document.querySelector('.board')?.getBoundingClientRect();
      if (!rect) return null;
      const tile = tilePixelCenter(sq as SquareId, displayTopology, layout);
      const flip = isMultiplayer && mpSync?.myColor === 'black';
      return {
        x: rect.left + (flip ? boardSize - tile.cx : tile.cx),
        y: rect.top + (flip ? boardSize - tile.cy : tile.cy),
        size: layout.tileSize,
        color,
      };
    },
    [state, displayTopology, layout, boardSize, isMultiplayer, mpSync],
  );

  /**
   * V1 — start an endgame cut.
   *
   * `fromIris` means the checkmate iris has already blacked the room out
   * and handed over, so the scene skips its own lead-in and lifts the king
   * immediately. Everything else (a flag fall, a resignation, a captured
   * king) gets the R17b freeze beat first — a moment of dimmed stillness —
   * and then a short dark prelude inside the scene.
   *
   * Reduced motion opts out entirely: the player goes straight to the
   * summary, the same way the iris and the shatter already hide themselves.
   */
  const launchEndgame = useCallback(
    (
      kind: EndgameKind,
      /** `king` is the SUBJECT of the cut, not the loser: the king the
       *  scene lifts and the one the iris closed on. See cutSubjectColor. */
      opts?: { king?: Color; fromIris?: boolean; theme?: VictoryTheme },
    ) => {
      if (typeof window === 'undefined') return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      void importEndgameScene(); // no-op if the iris already warmed it
      const subject: Color = opts?.king ?? cutSubjectColor ?? HUMAN_COLOR;
      const king = kingOriginFor(subject);
      // The colour roll is the win's only variable; the loss ignores it.
      const theme: VictoryTheme = opts?.theme ?? (Math.random() < 0.5 ? 'red' : 'blue');
      if (victoryFreezeTimer.current) clearTimeout(victoryFreezeTimer.current);
      if (opts?.fromIris) {
        setEndgameCut({ kind, theme, king, prelude: 0 });
        return;
      }
      setVictoryFreeze(true);
      victoryFreezeTimer.current = setTimeout(() => {
        setVictoryFreeze(false);
        setEndgameCut({ kind, theme, king, prelude: 300 });
      }, 650);
    },
    [kingOriginFor, cutSubjectColor],
  );

  /**
   * V1 — the king the iris actually closes on.
   *
   * When a cut follows, it has to be the cut's subject: narrowing the
   * screen down onto one king and then lifting a different one out of the
   * dark reads as two clips spliced together, which is exactly what this
   * whole sequence was built to stop. With no cut (spectating,
   * bot-vs-bot) it stays on the mated king, because then the shatter is
   * the ending and the mated king is what the shatter is about.
   */
  const irisKingPos = useMemo(() => {
    if (!cutSubjectColor || !mateKingPos) return mateKingPos;
    if (cutSubjectColor === mateKingPos.color) return mateKingPos;
    return boardKingPos(findKing(state, cutSubjectColor), cutSubjectColor) ?? mateKingPos;
  }, [cutSubjectColor, mateKingPos, state, boardKingPos]);

  const MATE_IRIS_MS = 900;
  const MATE_HOLD_MS = 320;
  const MATE_SHATTER_MS = 720;
  const [mateSeq, setMateSeq] = useState<'idle' | 'iris' | 'shatter'>('idle');
  const mateSeqStartedRef = useRef<string | null>(null);
  // One endgame cut per game, whichever effect gets there first.
  const endgameFiredForLogRef = useRef<string | null>(null);
  useEffect(() => {
    if (gameStatus !== 'checkmate' || !mateKingPos) {
      setMateSeq('idle');
      mateSeqStartedRef.current = null;
      return;
    }
    // One playthrough per game — a re-render while mid-sequence (eval
    // ticking in, etc.) must not restart it.
    if (mateSeqStartedRef.current === log.id) return;
    mateSeqStartedRef.current = log.id;
    setMateSeq('iris');
    // V1 — the iris no longer ends in a shatter when a cut will follow: it
    // hands its king over to the cinematic, which picks the same piece up
    // as pixels on the same square and carries it to the middle of the
    // screen. The shatter remains the ending wherever there is no cut —
    // spectating and bot-vs-bot, and any draw — so those keep exactly the
    // ending they had.
    if (cutSubjectColor && endgameFiredForLogRef.current !== log.id) {
      endgameFiredForLogRef.current = log.id;
      // Warm the chunk during the 1.2s the iris takes to close, so the
      // hand-off is a cut and not a gap.
      void importEndgameScene();
      const subject = cutSubjectColor;
      const won = decisiveWinner === subject;
      const handOff = setTimeout(() => {
        setMateSeq('idle');
        launchEndgame(won ? 'victory' : 'defeat', { king: subject, fromIris: true });
      }, MATE_IRIS_MS + MATE_HOLD_MS);
      return () => clearTimeout(handOff);
    }
    const t1 = setTimeout(() => setMateSeq('shatter'), MATE_IRIS_MS + MATE_HOLD_MS);
    const t2 = setTimeout(
      () => setMateSeq('idle'),
      MATE_IRIS_MS + MATE_HOLD_MS + MATE_SHATTER_MS,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [
    gameStatus,
    mateKingPos,
    log.id,
    cutSubjectColor,
    decisiveWinner,
    launchEndgame,
  ]);
  const mateSeqActive = mateSeq !== 'idle';
  // V1 — "a full-screen endgame sequence owns the screen right now": the
  // iris, or the cinematic it hands over to. Every game-over modal waits
  // on this, so a summary can never pop up underneath the cut. That
  // includes the freeze beat before a cut with no iris (flag fall,
  // resignation, captured king): without it the summary flashed up for
  // those 650 ms and was then covered by the cut.
  const endgameSceneActive = mateSeqActive || endgameCut !== null || victoryFreeze;

  // Dev seams for the endings. Playing a real line out to a checkmate just
  // to look at 7 seconds of animation is hopeless, so every ending can be
  // fired by hand. These merge onto the window.subutaiFX object the earlier
  // console-seams effect (check/strobe/dust) already created.
  //
  //   subutaiVictory()            the win cut (king lift → crown → VICTORY)
  //   subutaiVictory('blue')      …in the blue palette instead of a coin flip
  //   subutaiDefeat()             the loss cut (king lift → topple → DEFEAT)
  //   subutaiDraw()               the draw cut (two hands meet and shake)
  //   subutaiEndgame('victory' | 'defeat', { full: true, theme: 'blue' })
  //                               same, but `full` plays the checkmate iris
  //                               first and hands over exactly as a real
  //                               game does — this is the whole thing
  //   subutaiFX.mate()            just the iris + shatter, no cinematic
  //
  // The cut points at whichever king mateKingPos resolves to, so it works
  // from any position, including one with no checkmate on the board.
  useEffect(() => {
    if (typeof window === 'undefined' || !mateKingPos) return;
    const w = window as unknown as {
      subutaiFX?: Record<string, unknown>;
      subutaiVictory?: (t?: VictoryTheme) => void;
      __triggerVictory?: (t?: VictoryTheme) => void;
      subutaiDefeat?: () => void;
      subutaiDraw?: () => void;
      subutaiEndgame?: (
        kind?: EndgameKind,
        opts?: { full?: boolean; theme?: VictoryTheme },
      ) => void;
    };
    const run = (kind: EndgameKind, full: boolean, theme?: VictoryTheme) => {
      void importEndgameScene();
      const subject: Color = cutSubjectColor ?? HUMAN_COLOR;
      const go = () => launchEndgame(kind, { king: subject, fromIris: true, theme });
      if (!full) {
        go();
        return;
      }
      setMateSeq('iris');
      setTimeout(() => {
        setMateSeq('idle');
        go();
      }, MATE_IRIS_MS + MATE_HOLD_MS);
    };
    w.subutaiEndgame = (kind = 'victory', opts) =>
      run(kind, opts?.full ?? false, opts?.theme);
    w.subutaiVictory = (t) => run('victory', false, t);
    w.__triggerVictory = w.subutaiVictory; // legacy alias used in dev tooling
    w.subutaiDefeat = () => run('defeat', false);
    w.subutaiDraw = () => run('draw', false);
    if (w.subutaiFX) {
      w.subutaiFX.mate = () => {
        setMateSeq('iris');
        setTimeout(() => setMateSeq('shatter'), MATE_IRIS_MS + MATE_HOLD_MS);
        setTimeout(() => setMateSeq('idle'), MATE_IRIS_MS + MATE_HOLD_MS + MATE_SHATTER_MS);
      };
    }
  }, [mateKingPos, launchEndgame, cutSubjectColor]);

  // V1 — the endgame cut for games that do NOT end in checkmate: a flag
  // fall, a resignation, a captured king. Checkmates are handed over by the
  // iris effect above instead, so they are skipped here.
  //
  // R6 used to gate the cinematic on a come-from-behind win (worst eval
  // ≤ -2 pawns) and play nothing at all on a loss, which meant most games
  // just blinked into a modal. Both results get their own cut now; a draw
  // still gets none, because there is nothing to dramatise.
  useEffect(() => {
    if (watchingGame || isAutoMode) return; // spectating gets no cut
    if (gameStatus === 'active') return;
    if (gameStatus === 'checkmate') return; // the iris hands that one over
    if (mateSeqActive) return;
    if (endgameFiredForLogRef.current === log.id) return;

    // A draw belongs to neither player, so it has no subject king and no
    // winner to ask about — it gets its own storyboard: two hands meeting
    // in the middle. It plays in every mode a human is actually sitting
    // in, including hot-seat, where cutSubjectColor is deliberately null.
    if (gameStatus.startsWith('draw')) {
      endgameFiredForLogRef.current = log.id;
      launchEndgame('draw');
      return;
    }

    if (!cutSubjectColor || !decisiveWinner) return;
    endgameFiredForLogRef.current = log.id;
    launchEndgame(decisiveWinner === cutSubjectColor ? 'victory' : 'defeat', {
      king: cutSubjectColor,
    });
  }, [
    watchingGame,
    isAutoMode,
    cutSubjectColor,
    decisiveWinner,
    gameStatus,
    mateSeqActive,
    log.id,
    launchEndgame,
  ]);

  // Highlight the last N piece-plies on the board. Roulette mode plays two
  // sub-moves per AI turn, so we widen the window to 2; classic stays at 1
  // and renders identically to the old single-lastMove behaviour.
  // Indexed 0 = most recent, 1 = previous (used for an 'older' opacity).
  const recentPlyHighlights = useMemo(() => {
    const wantCount = gameMode === 'roulette' ? 2 : 1;
    const from = new Map<string, number>();
    const to = new Map<string, number>();
    let found = 0;
    for (let i = log.moves.length - 1; i >= 0 && found < wantCount; i--) {
      const m = log.moves[i].move;
      if (!m.from || !m.to || m.kind === 'topologyToggle') continue;
      if (!from.has(m.from)) from.set(m.from, found);
      if (!to.has(m.to)) to.set(m.to, found);
      found++;
    }
    return { from, to };
  }, [log.moves, gameMode]);

  // QA-09 — online, the position and seed are the MATCH's (log is derived
  // from the match doc); initialState / seed still hold the last solo game,
  // which is what the chip and the copied header used to show.
  const positionLabel = backRankString(isMultiplayer ? log.initialState : initialState);
  const notationSeed = isMultiplayer ? log.randomSeed : seed;

  // R15: abandonment ping — one doc per solo run, on the human's first move.
  // finishGame only fires on completed games, so without this "quit vs lost"
  // is unmeasurable. Same user/displayName gate as the save keeps the two
  // series comparable. Ref dedupes per log.id (survives re-renders, resets
  // with each new game's fresh id).
  const startPingedLogIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isAutoMode || isMultiplayer) return;
    if (!user || !displayName) return;
    if (log.moves.length === 0) return; // HUMAN_COLOR is white — first entry is the human's
    if (startPingedLogIdRef.current === log.id) return;
    startPingedLogIdRef.current = log.id;
    logGameStart({
      uid: user.uid,
      chess960Id: positionLabel,
      seed,
      gameMode,
    });
  }, [isAutoMode, isMultiplayer, user, displayName, log, positionLabel, seed, gameMode]);

  // Stable callback for <MemoryPanel onGameActivate>. The wrapped function
  // closes over a ref that always points at the latest `resumeGame`, so the
  // prop reference itself never changes and React.memo on MemoryPanel can
  // skip the 300-card subtree on every App re-render.
  const resumeGameRef = useRef<(game: SavedGame) => void>(() => {});
  const onMemoryGameActivate = useCallback((g: SavedGame) => {
    if (g.status === 'incomplete') resumeGameRef.current(g);
  }, []);

  function resumeGame(game: SavedGame) {
    const initial = createPositionFromBackRankKey(game.config960);
    let current: BoardState = initial;
    let nextLog: GameLog = createGameLog(`resume-${Date.now()}`, initial, Date.now());

    for (const entry of game.moves) {
      const mv = entry.move;
      // V1 — SAN is computed from the position BEFORE the move, exactly as
      // a live move records it. Without it a resumed game's move list lost
      // its piece letters ("Na8→b6" came back as "a8→b6").
      const san = computeSAN(current, mv);
      if (mv.kind === 'topologyToggle') {
        current = applyRotationMove(current);
        nextLog = appendMove(nextLog, mv, san, entry.topology);
        continue;
      }
      if (!mv.from || !mv.to) continue;
      current = applyMove(current, mv);
      nextLog = appendMove(nextLog, mv, san, entry.topology);
    }

    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setState(current);
    setInitialState(initial);
    setSelected(null);
    setLegalMoves(getLegalMoves(current));
    setLog(nextLog);
    setGameStatus('active');
    setPreviewTopology(null);
    setLastMove(null);
    setFormationLocked(true);
    setLockedFormationKey(game.config960);
    savedForLogIdRef.current = null;
    liveSavedGameIdRef.current = game.id;
    setSearchEvalFromWhite(null);
    setSearchMateInPlies(null);
    resetGameEndState();
    importedLogIdRef.current = game.imported ? nextLog.id : null;
    classifyImportedLog(nextLog);
  }
  // Keep the ref pointing at the latest resumeGame closure so the stable
  // onMemoryGameActivate callback always invokes the fresh state-bound copy.
  resumeGameRef.current = resumeGame;

  /**
   * V1 — a new tab opens on the game you are already playing.
   *
   * Online this already worked (R13b re-seats you from subutai_mp_active).
   * Solo, every tab started a fresh board, although the game in progress
   * was sitting in Memory, snapshotted on every move. Now the tab picks it
   * up — only if it was touched in the last day, and only a CLASSIC game
   * WITHOUT a clock:
   *   · roulette carries turn state a move list cannot rebuild (the spun
   *     slots, the actions left), so it waits in Memory instead;
   *   · a timed game would come back with both clocks at zero — in a
   *     ranked game against Strong that is "refresh for more time".
   */
  const liveResumeTriedRef = useRef(false);
  useEffect(() => {
    if (liveResumeTriedRef.current) return;
    liveResumeTriedRef.current = true;
    if (isAutoMode || sharedGameId || mpResumeCodeRef.current) return;
    const session = readLiveSession();
    if (!session) return;
    if (session.gameMode !== 'classic' || session.timed) return;
    if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) {
      clearLiveSession();
      return;
    }
    void localStorageAdapter.loadGames().then((games) => {
      const game = games.find((g) => g.id === session.gameId && g.status === 'incomplete');
      if (!game || game.moves.length === 0) return;
      beginBusy('Picking up your game');
      setOpponentMode(session.opponentMode);
      if (session.botLevel) setBotLevel(session.botLevel);
      resumeGameRef.current(game);
    });
    // Once, on the first render that has everything it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function importReplayFromNotation() {
    try {
      // QA-02 — strict: every entry has to be a move the live game would
      // have allowed at that point, or the whole log is refused with the
      // move it failed on. See replayFromNotation.
      const replay = replayFromNotation(replayText, { roulette: gameMode === 'roulette' });
      const { initial, final: current, log: replayLog } = replay;

      const id = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = buildSavedGameSnapshot(replayLog, id, true);
      if (localStorageAdapter.saveOrUpdateGame) {
        localStorageAdapter.saveOrUpdateGame(snapshot);
      } else {
        localStorageAdapter.saveGame(snapshot);
      }

      // Load into the board as an unfinished game so it can be continued.
      liveSavedGameIdRef.current = id;
      setFormationLocked(true);
      setLockedFormationKey(replay.config960);
      setInitialState(initial);
      setState(current);
      setSelected(null);
      setLegalMoves(getLegalMoves(current));
      setLog(replayLog);
      setGameStatus('active');
      setPreviewTopology(null);
      setLastMove(null);
      savedForLogIdRef.current = null;
      setSearchEvalFromWhite(null);
      setSearchMateInPlies(null);
      resetGameEndState();
      // QA-02 — an imported game is never ranked, whatever the bot level.
      // The mark lives here and in the Memory entry (never in /games), so a
      // resume from Memory keeps it.
      importedLogIdRef.current = replayLog.id;
      // A log that already ends the game loads as over. That ending is not
      // one the player just reached, so it gets no summary and no save.
      if (boardEnding(current, replay.lastWasRotation)) completedLogIdRef.current = replayLog.id;
      checkGameOver(current, replay.lastWasRotation);
      classifyImportedLog(replayLog);

      setReplayError(null);
      setShowReplayDialog(false);
      setReplayText('');
    } catch (e) {
      if (e instanceof NotationParseError) {
        setReplayError(e.message);
      } else {
        setReplayError('Could not parse replay log.');
      }
    }
  }

  /**
   * The move log, in two versions.
   *
   * On screen it carries the coaching marks — ⭐ for the engine's own
   * choice, ? and ?? for mistakes, and the "← Better: … (−123 cp)" tail.
   * That is the whole point of the panel and it stays.
   *
   * What goes on the clipboard is the bare log. A pasted log is an INPUT:
   * it gets fed back through the replay importer, mailed to someone,
   * pasted into a chat. The marks survived none of those trips intact —
   * a star that has been through a chat client comes back as U+2B50
   * U+FE0F — and every one of them is noise to whoever reads it. The
   * parser is now forgiving about them either way, but the honest fix is
   * not to ship them where they were never wanted.
   */
  const buildNotation = useCallback((annotate: boolean) => {
    const lines: string[] = [
      `[Chess960 "${positionLabel}"]`,
      `[Seed "${notationSeed}"]`,
      '',
    ];
    const entries = log.moves;
    for (let i = 0; i < entries.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const white = entries[i];
      const black = entries[i + 1];

      function fmt(entry: typeof white): string {
        let san = entry.san;
        if (!san) {
          if (entry.move.kind === 'topologyToggle') {
            const from = entry.topology ?? 'A';
            return `${from}\u2192${from === 'A' ? 'B' : 'A'}`;
          }
          if (entry.move.kind === 'castle') {
            san = entry.move.to && entry.move.to[0] === 'c' ? 'O-O-O' : 'O-O';
          } else {
            san = `${entry.move.from}\u2192${entry.move.to}`;
            if (entry.move.kind === 'promotion' && entry.move.promotion) {
              const pl: Record<string, string> = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };
              san += `=${pl[entry.move.promotion] ?? ''}`;
            }
          }
        }
        if (entry.move.kind !== 'topologyToggle' && entry.topology === 'B') {
          if (!san.includes('@')) san += '@B';
        }
        const a = annotate ? entry.analysis : undefined;
        if (a) {
          const marker = MOVE_CLASS_MARKER[a.classification];
          if (marker) san += marker;
          if (a.classification === 'blunder') {
            // Stage O: collapse the PV to a single move \u2014 the chain was hard
            // to parse mid-list. Prefer bestMoveSan when present (it's the
            // first PV move with explicit naming).
            const first = a.bestMoveSan ?? a.bestPvSan?.[0];
            if (first) {
              san += ` \u2190 Better: ${first}`;
            }
            // Append the centipawn loss so the player can gauge how marginal
            // the suggestion is. cpl 50-100 = borderline, 300+ = real blunder.
            // Stage L's float-eval makes cpl a non-integer \u2014 round for display.
            if (a.cpl > 0) {
              san += ` (\u2212${Math.round(a.cpl)} cp)`;
            }
          }
        }
        return san;
      }

      let line = `${moveNum}. ${fmt(white)}`;
      if (black) line += `  ${fmt(black)}`;
      lines.push(line);
    }
    return lines.join('\n');
  }, [log.moves, positionLabel, notationSeed]);

  const notationString = useMemo(() => buildNotation(true), [buildNotation]);

  function copyNotation() {
    navigator.clipboard.writeText(buildNotation(false)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // V1 — the live log never carried gameMode (only saved games do), so a
  // roulette game reviewed straight from the board was analysed under
  // classic rules (no self-check) and worded as classic. Stamp it here;
  // memoised so GameReview's [log] effects don't re-run every render.
  const liveReviewLog = useMemo<GameLog>(
    () => (log.gameMode ? log : { ...log, gameMode }),
    [log, gameMode],
  );

  const gameOverMessage = useMemo(() => {
    if (gameStatus === 'checkmate') {
      const winner = state.sideToMove === 'white' ? 'Black' : 'White';
      return `Checkmate! ${winner} wins`;
    }
    if (gameStatus === 'draw_stalemate') {
      return 'Draw: stalemate';
    }
    if (gameStatus === 'draw_material') {
      return 'Draw: insufficient material';
    }
    if (gameStatus === 'draw_repetition') {
      return 'Draw: threefold repetition';
    }
    if (gameStatus === 'draw_50move') {
      return 'Draw: 50-move rule';
    }
    if (gameStatus === 'king_captured_white_wins') {
      return 'King captured! White wins';
    }
    if (gameStatus === 'king_captured_black_wins') {
      return 'King captured! Black wins';
    }
    if (gameStatus === 'timeout_white') {
      return 'White ran out of time. Black wins';
    }
    if (gameStatus === 'timeout_black') {
      return 'Black ran out of time. White wins';
    }
    if (gameStatus === 'resigned_white') {
      return 'White resigned. Black wins';
    }
    if (gameStatus === 'resigned_black') {
      return 'Black resigned. White wins';
    }
    return null;
  }, [gameStatus, state.sideToMove]);

  if (isStatsMode) {
    return (
      <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <StatsPage />
      </Suspense>
    );
  }

  if (isAutoMode) {
    const avgMoves =
      autoMoveHistory.length > 0
        ? Math.round(
            autoMoveHistory.reduce((s, n) => s + n, 0) / autoMoveHistory.length,
          )
        : null;
    const currentFullMoves = Math.floor(log.moves.length / 2);
    const autoBoard = (
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
    return (
      <div className="app-shell auto-shell-root" ref={shellRef}>
        <AutoPlayView
          gamesCompleted={autoGamesCompleted}
          maxGames={maxGames}
          currentGameFullMoves={currentFullMoves}
          lastOutcome={autoLastOutcome}
          avgGameMoves={avgMoves}
          stopped={autoStopped}
          stoppedReason={autoStoppedReason}
          onStop={stopAuto}
          board={autoBoard}
        />
      </div>
    );
  }

  if (view === 'review') {
    return (
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <GameReview
          log={activeReviewLog ?? liveReviewLog}
          meta={activeReviewMeta ?? undefined}
          gameId={sharedGameId ?? lastGameId ?? null}
          onBack={() =>
            // V1 — leaving the review rebuilds the whole board view in one
            // commit: the board, 64 tiles, the panels and whatever
            // analysis was mid-flight. On a long game that is a few
            // hundred milliseconds during which the tab stops repainting,
            // which reads as a hang with no explanation. busy.navigate
            // paints the spinner FIRST and runs the switch after.
            busy.navigate('Back to the board', () => {
              setView('game');
              // Drop the snapshot so the next plain Review opens the live log.
              setActiveReviewLog(null);
              setActiveReviewMeta(null);
              // Strip ?game= so a refresh won't re-open the shared review.
              if (
                typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).get('game')
              ) {
                const url = new URL(window.location.href);
                url.searchParams.delete('game');
                window.history.replaceState(null, '', url.toString());
              }
            })
          }
        />
        </Suspense>
      </div>
    );
  }

  if (view === 'leaderboard') {
    return (
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <Leaderboard
          currentUid={user?.uid ?? null}
          watchDisabled={isMultiplayer}
          onBack={() => busy.navigate('Back to the board', () => setView('game'))}
          onWatchGame={(gameId, playerName) => {
            void startWatching(gameId, playerName);
          }}
        />
        </Suspense>
      </div>
    );
  }

  if (view === 'friend-lobby') {
    return (
      <div className="app-shell" key={view} ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <FriendLobby
          uid={user?.uid ?? null}
          displayName={displayName}
          onBack={() =>
            busy.navigate('Back to the board', () => {
              setView('game');
              setOpponentMode('ai');
            })
          }
          onMatchReady={(match) => {
            // Q.B.2: hand the live match over to the regular game view.
            // The board / log / header all reuse the single-player UI,
            // sourcing their data from useMultiplayerSync.
            //
            // R15-bug — reset the solo world FIRST: a finished solo game
            // leaves a terminal gameStatus behind, and the MP UI reads it
            // (its "Checkmate!" banner covered the fresh match and hid
            // the clock strip, which is gated on gameStatus==='active').
            startNewGame();
            setActiveMatch(match);
            setView('game');
            // Reset any stale completion state from a previous match.
            setMpEndOutcome(null);
            mpSavedGameIdRef.current = null;
            mpWroteOutcomeRef.current = null;
          }}
        />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      className={`app-shell${flashEffect ? ` is-${flashEffect}-flash` : ''}`}
      // Motion scaffold: keyed by the coarse `view` enum (not opponentMode/
      // isMultiplayer) so React remounts the shell — and replays the
      // view-enter crossfade — only on a real screen switch (game <->
      // review/leaderboard/friend-lobby). Switching opponent mode or
      // starting an MP match while still in 'game' must NOT retrigger
      // this, or the board would look like it reset.
      key={view}
      // Sprint 4.3.1 — data-opponent-mode + data-game-active drive CSS
      // selectors that hide duplicate / irrelevant controls in local
      // 2P hot-seat mode (the standard action group, standalone rotate,
      // material-score chip). Gated on game-active so the controls
      // reappear once the local game finishes and the user needs the
      // New Game / Lock buttons again.
      data-opponent-mode={opponentMode}
      data-game-active={gameInProgress ? '1' : '0'}
      // R3 — reserved widths of docked side panels; CSS pads the shell by
      // them (media-gated to desktop) so content slides clear.
      style={
        { '--dock-left': `${dock.left}px`, '--dock-right': `${dock.right}px` } as React.CSSProperties
      }
      ref={shellRef}
    >
    {bgGridOn && <BackgroundWaveGrid />}
    {flashEffect && (
      <div
        className={`screen-flash-effect screen-flash-${flashEffect}`}
        aria-hidden
      />
    )}
    {flashEffect === 'brilliant' && (
      <div className="brilliant-sparkles" aria-hidden>
        {sparklePositions.map((s, i) => (
          <span
            key={i}
            className="brilliant-sparkle"
            style={{
              left: `${s.x}vw`,
              top: `${s.y}vh`,
              animationDelay: `${s.delay}ms`,
              ['--sparkle-rot' as string]: `${s.rot}deg`,
            } as React.CSSProperties}
          >
            <Icon icon={Sparkles} size="md" aria-hidden />
          </span>
        ))}
      </div>
    )}
    <div
      className="app-root"
      data-mobile-panel={mobilePanel}
      style={{ '--board-size': `${boardSize}px` } as React.CSSProperties}
    >
      {/* Closes whichever drawer is open; inert while both are shut. */}
      <div
        className="mobile-scrim"
        onClick={closeMobilePanel}
        role="presentation"
        aria-hidden
      />
      <header className="app-header">
        {/* V1 — the left drawer opens from the LEFT edge of the header, the
            right one from the right: each button sits on the side its
            panel comes in from. */}
        <button
          type="button"
          className="mobile-panel-btn mobile-panel-btn-menu"
          data-tour="mobile-menu"
          onClick={() => setMobilePanel((v) => (v === 'menu' ? 'none' : 'menu'))}
          aria-expanded={mobilePanel === 'menu'}
          aria-label="Tools and settings"
        >
          <Icon icon={Menu} size="md" aria-hidden />
        </button>
        <div className="app-brand">
          <NeonLogo />
          <h1>subutai</h1>
          {/* Design experiment (neon-stitch): the mock's LIVE strip replaces
              the plain tagline. Solo shows a short seed-derived game tag. */}
          <div className="live-strip">
            {/* V1 — the pill reports the real game state: LIVE while a
                game is running, READY before the first move, OVER after
                the result. */}
            {(() => {
              const mpLive = isMultiplayer && mpSync
                ? mpSync.matchState.status === 'active' && !mpSync.matchState.outcome
                : false;
              const phase: 'live' | 'ready' | 'over' = isMultiplayer
                ? (mpLive ? 'live' : 'over')
                : gameStatus !== 'active'
                  ? 'over'
                  : log.moves.length > 0
                    ? 'live'
                    : 'ready';
              return (
                <span className={`live-pill is-${phase}`}>
                  <span className="live-dot" aria-hidden />
                  {phase === 'live' ? 'LIVE' : phase === 'over' ? 'OVER' : 'READY'}
                </span>
              );
            })()}
            {(() => {
              // V1 — this line is the first thing to go when the header
              // runs out of room. It is context, not a control: which
              // opponent and which game id. Below 600px it moves into the
              // LIVE pill's own tooltip, where a hover or a long-press
              // still reaches it, and the header stops being three things
              // fighting over one row.
              const label =
                isMultiplayer && mpSync
                  ? `vs ${mpSync.opponentDisplayName} · ${mpSync.matchState.code}`
                  : `vs AI · #${Math.abs(seed).toString(36).toUpperCase().slice(-5) || '0'}`;
              const hint =
                !isMultiplayer && gameMode === 'classic' && opponentMode === 'ai'
                  ? 'Try to survive 50 moves against the AI'
                  : undefined;
              return (
                <span className="live-title" title={hint ?? label} data-label={label}>
                  {isMultiplayer && mpSync ? (
                    <>
                      vs <strong>{mpSync.opponentDisplayName}</strong> · {mpSync.matchState.code}
                    </>
                  ) : (
                    label
                  )}
                </span>
              );
            })()}
          </div>
        </div>
        <div className="mobile-panel-buttons">
          <button
            type="button"
            className="mobile-panel-btn"
            data-tour="mobile-setup"
            onClick={() => setMobilePanel((v) => (v === 'setup' ? 'none' : 'setup'))}
            aria-expanded={mobilePanel === 'setup'}
            aria-label="Game setup"
          >
            <Icon icon={SlidersHorizontal} size="md" aria-hidden />
          </button>
        </div>
        <div className="header-controls" data-tour="header">
          <Tooltip text={showMusicDock ? 'Hide music dock' : 'Spotify + beat sync (beta)'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showMusicDock ? ' is-active' : ''}`}
              onClick={() => setShowMusicDock((v) => !v)}
              aria-label="Toggle music dock (beta)"
              aria-pressed={showMusicDock}
              data-tour="music"
            >
              <Icon icon={Disc3} size="md" aria-hidden />
              <span className="beta-corner" aria-hidden>β</span>
            </button>
          </Tooltip>
          <Tooltip text={showTwitch ? 'Hide Twitch chat' : 'Twitch chat + predictions (beta)'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showTwitch ? ' is-active' : ''}`}
              onClick={() => setShowTwitch((v) => !v)}
              aria-label="Toggle Twitch chat (beta)"
              aria-pressed={showTwitch}
              data-tour="twitch"
            >
              <Icon icon={Cast} size="md" aria-hidden />
              <span className="beta-corner" aria-hidden>β</span>
            </button>
          </Tooltip>
          <span className="rail-sep" aria-hidden />
          <Tooltip
            text={user && displayName ? 'Send feedback' : 'Sign in to send feedback'}
            side="bottom"
            disabled={!user || !displayName}
          >
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setShowFeedbackModal(true)}
              disabled={!user || !displayName}
              aria-label="Send feedback"
            >
              <Icon icon={MessageSquare} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Rules & info" side="bottom">
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setShowHelp(true)}
              aria-label="Rules & info"
            >
              <Icon icon={HelpCircle} size="md" aria-hidden />
            </button>
          </Tooltip>
          <span className="rail-sep rail-sep-tray" aria-hidden />
          <MusicToggle />
          <AudioToggle />
          <Effects3DToggle />
          <ThemeToggle />
        </div>
        {/* V1 — the two things a player reaches for most often stay in the
            top bar on every viewport: the leaderboard and their own name.
            Everything else lives in the left rail (desktop) / header row
            (mobile). */}
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-btn"
            onClick={() =>
              guardLeave('Open leaderboard', false, () =>
                busy.navigate('Opening leaderboard', () => setView('leaderboard')),
              )
            }
            aria-label="Leaderboard"
            title="Leaderboard"
          >
            <Icon icon={Trophy} size="md" aria-hidden />
            <span className="topbar-btn-label">Leaderboard</span>
          </button>
          {displayName && (
            <UserMenu
              displayName={displayName}
              onChangeName={() => setShowNameModal(true)}
            />
          )}
        </div>
      </header>

      {watchingGame && (
        <div className="watch-banner">
          <span className="watch-banner-label">
            <Icon icon={Eye} size="sm" aria-hidden /> Watching <strong>{watchingGame.playerName}</strong>’s game ·
            move {Math.floor((watchingGame.currentMoveIdx + 1) / 2)}/
            {Math.floor(watchingGame.log.moves.length / 2)}
          </span>
          <div className="watch-banner-controls">
            <button
              type="button"
              className="watch-btn"
              onClick={() => seekWatchTo(watchingGame.currentMoveIdx - 1)}
              disabled={watchingGame.currentMoveIdx === 0}
              title="Previous move"
            >
              ← Prev
            </button>
            <button
              type="button"
              className="watch-btn"
              onClick={() => seekWatchTo(watchingGame.currentMoveIdx + 1)}
              disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
              title="Next move"
            >
              Next →
            </button>
            <button
              type="button"
              className={`watch-btn${watchingGame.autoplay ? ' watch-btn-active' : ''}`}
              onClick={toggleWatchAutoplay}
              disabled={watchingGame.currentMoveIdx >= watchingGame.log.moves.length}
              title="Auto play"
            >
              {watchingGame.autoplay ? '⏸ Pause' : '▶ Auto'}
            </button>
            <button
              type="button"
              className="watch-btn watch-btn-stop"
              onClick={stopWatching}
              title="Stop and return to your game"
            >
              ✕ Stop
            </button>
          </div>
        </div>
      )}

      {sharedGameError && (
        <div className="mp-banner mp-banner-error" role="status">
          {sharedGameError}{' '}
          <button
            type="button"
            className="mp-back-btn"
            style={{ marginLeft: 8 }}
            onClick={() => setSharedGameError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sprint 4.0 — persistent "Your turn / Waiting" MP banner removed
          again (re-grew during the post-3.0 rewrites). Whose turn it is
          reads from the board + opponent panel; the local AFK alert
          covers the attention case. The waiting-for-opponent spinner
          is kept as a slim, non-text indicator so users still know the
          other side is acting — without the heavy banner. */}
      {isMultiplayer
        && mpSync
        && mpSync.matchState.status === 'active'
        && !mpSync.isMyTurn && (
        <div className="mp-banner mp-banner-wait">
          <span className="mp-spinner" aria-hidden />
          {mpSync.isRouletteMode && mpSync.rouletteSlots
            ? `${mpSync.opponentDisplayName} is acting…`
            : `Waiting for ${mpSync.opponentDisplayName}…`}
        </div>
      )}

      {isMultiplayer &&
        mpSync &&
        mpSync.selfAfkWarning &&
        mpSync.matchState.status === 'active' && (
          <div className="mp-banner mp-banner-warn">
            <Icon icon={AlarmClock} size="sm" aria-hidden /> Make a move soon — auto-forfeit in ~30s.
          </div>
        )}

      {isMultiplayer && mpSync && mpSync.error && (
        <div className="mp-banner mp-banner-error">{mpSync.error}</div>
      )}

      {/* Sprint 4.1 / V1 — the hot-seat turn banner that used to float
          above the board now lives INSIDE each player's own button row
          (see LocalTurnSlot), so "whose move" reads as part of the
          controls in front of you rather than a notice pinned over both
          of them. */}
      <div className="app-body">
      <div className="board-area">
      {/* S2.5 — per-side clocks. Elapsed time normally; in a timed MP
          match (B8) they switch to countdown, glowing red under 30s.
          V1 — shaped like the clock that actually sits on a tournament
          table: one housing, two faces split by a dashed seam, the
          running side lit. The readout itself stays digital (an unlit
          88:88 ghost with the live digits burning through it), which is
          how a DGT reads in the hall — the housing is the analogue part,
          not the numbers. */}
      {gameStatus === 'active' && !watchingGame && (
        <div className="tournament-clock" aria-label="Game clocks">
          {(['white', 'black'] as const).map((side) => {
            const soloCountdown = mpClocks === null && soloTcSec !== null;
            const ms = mpClocks
              ? mpClocks[side]
              : soloCountdown
                ? Math.max(0, soloTcSec * 1000 - clockMs[side])
                : clockMs[side];
            // Only a real countdown can be "low". An elapsed clock reads
            // low for its first 30 seconds, which would paint every game
            // red at the start.
            const low = (mpClocks?.countdown || soloCountdown) && ms < 30_000;
            const face = formatClockFace(ms);
            const running = state.sideToMove === side;
            // V1 — the running half is lit in the theme accent when it is
            // YOUR clock and in the opponent accent when it is not, so the
            // two are never confusable at a glance. Online it follows the
            // colour you were actually dealt; in hot-seat nobody is "you",
            // so the two seats simply get the two colours.
            const mine = side === (isMultiplayer ? mpSync?.myColor ?? 'white' : 'white');
            return (
              <div
                key={side}
                className={`tc-face tc-face-${side}${running ? ' is-running' : ''}${low ? ' is-low' : ''}${mine ? ' is-mine' : ' is-theirs'}`}
              >
                <span className="tc-readout">
                  {/* Every segment of the display, unlit — the live digits
                      sit exactly on top, so the glass reads as a real
                      seven-segment panel instead of floating text. */}
                  <span className="tc-ghost" aria-hidden>
                    {face.replace(/\d/g, '8')}
                  </span>
                  <span className="tc-digits">{face}</span>
                </span>
                <span className="tc-name">
                  <span className="tc-lamp" aria-hidden />
                  {side === 'white' ? 'White' : 'Black'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* Sprint 2.7.1 — the roulette panel now only renders when there
          is actual slot or spinning state to show. Pre-spin attention
          is handled by the compact .spin-roulette-btn-compact in the
          board-actions row, so the wide banner is gone. */}
      {gameMode === 'roulette' &&
        gameStatus === 'active' &&
        !watchingGame &&
        (allowedPieceTypes || isRouletteSpinning) && (
        <div className="roulette-panel">
          <div className="roulette-display">
            {allowedPieceTypes ? (
              allowedPieceTypes.map((t, i) => {
                const isUsed = usedRouletteSlots.includes(i);
                // Sprint 4.0 — render the piece in the *turn-owner's*
                // colour, not in state.sideToMove. During action 2 of
                // an MP roulette turn the local engine flips
                // sideToMove only on the active client (Q.D.3 override
                // in the `state` IIFE above); on the opposite client
                // sideToMove still reads as the just-flipped value,
                // so the bag visualised in the wrong colour. Deriving
                // owner from mpSync.isMyTurn + myColor keeps both
                // clients in sync.
                const rouletteOwner: 'white' | 'black' = isMultiplayer && mpSync
                  ? (mpSync.isMyTurn
                      ? mpSync.myColor
                      : (mpSync.myColor === 'white' ? 'black' : 'white'))
                  : state.sideToMove;
                return (
                  <span
                    key={i}
                    className={`roulette-face roulette-face-${t}${isUsed ? ' slot-used' : ''}`}
                  >
                    <span className={`piece piece-${rouletteOwner}`}>
                      {glyphForPiece(rouletteOwner, t)}
                    </span>
                  </span>
                );
              })
            ) : (
              Array.from({ length: ROULETTE_SLOT_COUNT }, (_, i) => (
                <span key={i} className="roulette-face roulette-face-rolling">?</span>
              ))
            )}
          </div>

          {allowedPieceTypes && (
            <div className="roulette-actions" aria-label="Actions remaining">
              <span className="roulette-actions-label">Actions:</span>
              {Array.from({ length: ROULETTE_MAX_ACTIONS }, (_, i) => (
                <span
                  key={i}
                  className={`roulette-action-dot${i < rouletteActionsLeft ? ' active' : ' spent'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Sprint 4.2 — per-side action rows in local 2P mode. Top row
          mirrors the bottom one but is visually flipped 180° so the
          opposite-sitting player sees it upright. Buttons mirror the
          subset of the main action row that matters during a hot-seat
          game (resign / preview rotation / commit rotation). */}
      {isLocalMode && gameStatus === 'active' && (
        <div className="local-actions local-actions-top" aria-hidden={state.sideToMove !== 'black'}>
          <LocalTurnSlot side="black" toMove={state.sideToMove} />
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={() => requestResign('black')}
            disabled={log.moves.length === 0}
            aria-label="Resign (black)"
            title="Resign"
          >
            <Icon icon={Flag} size="md" aria-hidden />
          </button>
          <button
            type="button"
            className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
            onClick={() => {
              if (previewLocked) {
                setPreviewLocked(false);
                setLockedPreviewTopology(null);
              } else {
                setPreviewLocked(true);
                setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
            title={previewLocked ? 'Unlock preview' : 'Preview rotation'}
          >
            <Icon icon={Eye} size="md" aria-hidden />
          </button>
          <button
            type="button"
            className={`rotate-btn-icon${encourageRotate && canRotate ? ' is-hint-pulsing' : ''}`}
            onClick={handleRotate}
            disabled={!canRotate}
            aria-label={`Rotate ${state.topologyState} to ${state.topologyState === 'A' ? 'B' : 'A'}`}
            title="Rotate board"
          >
            <Icon icon={RotateCw} size="md" aria-hidden />
            <span className="rotate-label-text" aria-hidden>
              {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
            </span>
          </button>
        </div>
      )}
      <div className="board-with-eval">
        <EvalBar
          evalCp={myPerspectiveEval}
          mateInPlies={searchMateInPlies}
          isPending={!isMultiplayer && searchEvalFromWhite === null}
        />
      <div
        className={`board-with-coords${showAfkAlert && currentPlayer === 'human' && gameStatus === 'active' ? ' is-afk-nudge' : ''}${captureShake ? ' is-capture-shake' : ''}`}
        style={{ width: boardSize, '--fx-intensity': fxIntensity } as React.CSSProperties}
        data-tour="board"
      >
      {/* SP — mic-driven spectrum ring; mounts only while the
          equalizer listens. Self-driving (no App re-renders). */}
      {vizOn && <PerimeterEqualizer />}
      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}${recentRotation ? ' is-rotated' : ''}${
          recentRotation && beatMode.isEnabled() && beatEngine.isRunning() ? ' is-rotated-beat' : ''
        }`}
        data-topology={displayTopology}
        style={
          {
            width: boardSize,
            height: boardSize,
            // M.15 — in Beat Mode the rotate "swings" in time: one beat
            // long, springy. --rotate-ms = the live beat period.
            ...(recentRotation && beatMode.isEnabled() && beatEngine.getIntervalMs() > 0
              ? { '--rotate-ms': `${Math.round(beatEngine.getIntervalMs())}ms` }
              : null),
          } as React.CSSProperties
        }
      >
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
          const flip = isMultiplayer && mpSync?.myColor === 'black';
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
                  stroke="var(--support-stroke, #14b8a6)"
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
                  stroke="var(--support-hover-stroke, #ea580c)"
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
              const annFlip = isMultiplayer && mpSync?.myColor === 'black';
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
      </div>
      {/* Sprint 4.2 — coords overlay lives OUTSIDE .board so the labels
          stay still while the board itself can rotate / preview-rotate.
          Earlier attempts kept the labels inside the tiles, which meant
          the .board rotation transform dragged them along. */}
      {(() => {
        const flip = isMultiplayer && mpSync?.myColor === 'black';
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
      })()}
      </div>
      </div>

      {/* V1 — the white seat uses the standard .board-actions row below,
          exactly like every other mode. The mirrored row above the board
          is the only local-mode extra (it serves the player sitting on the
          far side). The old duplicate bottom row is gone: it repeated
          resign / preview / rotate one row above the real one and pushed
          the layout past the board's frame. */}

      {pendingPromotion && (
        <div className="promotion-backdrop" onClick={() => setPendingPromotion(null)}>
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
      )}

      {gameOverMessage && (
        <div className="game-over-banner">{gameOverMessage}</div>
      )}

      <div className="board-actions">
        {isLocalMode && gameStatus === 'active' && (
          <LocalTurnSlot side="white" toMove={state.sideToMove} />
        )}
        {/* Sprint 3.2.1 \u2014 six icon buttons consolidated into one
            cohesive bar with a single divider between the meta-controls
            (Reset / Lock / Resign) and the in-game toggles (Support /
            Threat / Preview). Lock no longer reads as a stray button \u2014
            it's middle-of-the-row inside the same container. */}
        <div className="action-buttons-group">
          <Tooltip text="New game" side="top">
            <button
              type="button"
              className="action-btn"
              onClick={() => guardLeave('Start a new game', true, startNewGame)}
              aria-label="New game"
            >
              <Icon icon={RotateCw} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip
            text={formationLocked ? 'Unlock formation (next game random)' : 'Lock formation (keep this 960)'}
            side="top"
          >
            <button
              type="button"
              className={`action-btn${formationLocked ? ' active' : ''}`}
              onClick={toggleFormationLock}
              aria-label={formationLocked ? 'Unlock formation' : 'Lock formation'}
            >
              <Icon icon={Lock} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Resign \u2014 half points, no bonus" side="top">
            <button
              type="button"
              className="action-btn resign-btn"
              onClick={() => requestResign('white')}
              disabled={!!watchingGame || gameStatus !== 'active' || log.moves.length === 0 || botThinking}
              aria-label="Resign"
            >
              <Icon icon={Flag} size="md" aria-hidden />
            </button>
          </Tooltip>
          {/* Sprint 4.2 — hide threat/support insight tools in local
              2P mode for a cleaner hot-seat UX (one device, two humans
              sharing the screen; coaching arrows are distracting). */}
          {opponentMode !== 'local' && (
            <>
              <span className="action-group-divider" aria-hidden />
              {/* S2.4 — master switch for the coaching group. Off hides
                  (and deactivates) support / threat / hint so the row
                  reads as plain chess. */}
              <Tooltip
                text={helpToolsEnabled ? 'Hide coaching tools' : 'Show coaching tools (support, threats, hint)'}
                side="top"
              >
                <button
                  type="button"
                  className={`action-btn${helpToolsEnabled ? ' active' : ''}`}
                  onClick={toggleHelpTools}
                  data-tour="coach"
                  aria-label="Toggle coaching tools"
                  aria-pressed={helpToolsEnabled}
                >
                  <Icon icon={GraduationCap} size="md" aria-hidden />
                </button>
              </Tooltip>
              {helpToolsEnabled && (
                <>
                  <Tooltip text="Support map (who backs whom)" side="top">
                    <button
                      type="button"
                      className={`action-btn${showSupport ? ' active' : ''}`}
                      onClick={() => setShowSupport((v) => !v)}
                      aria-label="Toggle support map"
                      aria-pressed={showSupport}
                    >
                      <Icon icon={ArrowRight} size="md" aria-hidden />
                    </button>
                  </Tooltip>
                  <Tooltip text="Threat map" side="top">
                    <button
                      type="button"
                      className={`action-btn${showThreats ? ' active' : ''}`}
                      onClick={() => setShowThreats((v) => !v)}
                      aria-label="Toggle threat map"
                      aria-pressed={showThreats}
                    >
                      <Icon icon={AlertTriangle} size="md" aria-hidden />
                    </button>
                  </Tooltip>
                  {/* V1 — no engine hints against another person. The
                      support and threat maps read the position you can
                      already see; the hint runs a search and hands you a
                      move, which in an online game is just an engine at
                      the board. Hot-seat keeps it: both players share the
                      screen and can see it being used. */}
                  {gameMode === 'classic' && !isMultiplayer && (
                    <Tooltip text="Hint: engine suggests a move" side="top">
                      <button
                        type="button"
                        className={`action-btn${hintMove ? ' active' : ''}`}
                        onClick={computeHint}
                        disabled={currentPlayer !== 'human' || gameStatus !== 'active' || !!watchingGame}
                        aria-label="Show a hint"
                      >
                        <Icon icon={Lightbulb} size="md" aria-hidden />
                      </button>
                    </Tooltip>
                  )}
                </>
              )}
            </>
          )}
          <Tooltip
            text={previewLocked ? 'Unlock rotation preview' : 'Preview rotation (click locks it)'}
            side="top"
          >
            <button
              type="button"
              className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
              disabled={currentPlayer !== 'human'}
              data-tour="preview"
              aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
            onClick={() => {
              if (currentPlayer !== 'human') return;
              if (previewLocked) {
                setPreviewLocked(false);
                setLockedPreviewTopology(null);
              } else {
                setPreviewLocked(true);
                setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            onPointerEnter={() => {
              if (currentPlayer === 'human' && !previewLocked) {
                setPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
              }
            }}
            onPointerLeave={() => {
              if (!previewLocked) setPreviewTopology(null);
            }}
          >
            <Icon icon={Eye} size="md" aria-hidden />
          </button>
          </Tooltip>
        </div>

        {/* Sprint 2.7.1 \u2014 compact spin button replaces the old wide
            roulette banner. Lives inline among the board-actions row.
            Sprint 3.2 \u2014 the auto-spin effects (solo + MP) take over
            after the first manual spin, so before that the button is
            briefly visible every turn and immediately unmounted by
            auto-spin ~500ms later, producing a flicker + layout shift.
            Gating on `!firstRouletteSpinDone` means the button is only
            rendered for the literal first turn of the game (where it
            actually needs to be clicked); afterwards auto-spin handles
            every subsequent turn without the button mounting at all. */}
        {gameMode === 'roulette' &&
          gameStatus === 'active' &&
          !watchingGame &&
          allowedPieceTypes === null &&
          !isRouletteSpinning &&
          currentPlayer === 'human' &&
          !firstRouletteSpinDone && (
          <div className="action-group">
            <button
              type="button"
              className="spin-roulette-btn-compact"
              onClick={handleSpinRoulette}
              title="Spin the roulette for this turn"
            >
              <Icon icon={Dices} size="md" aria-hidden /> Spin
            </button>
          </div>
        )}

        <Tooltip
          text={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
          side="top"
          disabled={!canRotate}
        >
          <button
            type="button"
            className={`rotate-btn-icon${(showRotateHint || (hintMove && 'rotate' in hintMove) || encourageRotate) && canRotate ? ' is-hint-pulsing' : ''}`}
            onClick={handleRotate}
            disabled={!canRotate}
            data-tour="rotate"
            aria-label={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
          >
            <Icon icon={RotateCw} size="md" aria-hidden />
            <span className="rotate-label-text" aria-hidden>
              {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
            </span>
            {showRotateHint && canRotate && (
              <span className="rotate-hint-tooltip" role="status">
                <span>Try rotating the board! +15 pts, +25 more if it sets up a capture</span>
                {/* span-as-button: a real <button> here would nest inside
                    the rotate <button>, which is invalid HTML (React 19
                    logs hydration errors for it). */}
                <span
                  role="button"
                  tabIndex={0}
                  className="rotate-hint-dismiss"
                  aria-label="Dismiss hint"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissRotateHint();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      dismissRotateHint();
                    }
                  }}
                >
                  ×
                </span>
              </span>
            )}
          </button>
        </Tooltip>
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
      </div>

      <div className="position-label-wrap">
        {/* S2.1 — Replay import and formation editing clobber local game
            state, which in MP would split-brain against the Firestore
            board, and while watching would corrupt the stop-restore
            backup. Both controls are live-local-game-only. */}
        {!isMultiplayer && !watchingGame && (
        <button
          type="button"
          className="position-replay-btn"
          onClick={() =>
            guardLeave('Load a replay', true, () => {
              setReplayError(null);
              setShowReplayDialog(true);
            })
          }
          title="Paste a move log to replay a game"
        >
          <Icon icon={Upload} size={12} aria-hidden /> Load replay
        </button>
        )}
        {/* V1 rev 3 — the code IS the control.
            It used to be a read-only label with a separate "Set position"
            button next to it, which put two objects on screen for one
            idea. The code now sits quiet and flat until you touch it;
            clicking it grows the chip and turns the code itself into the
            field you type in. Nothing else on the row changes size, so
            the growth is the whole affordance. */}
        {isMultiplayer || watchingGame ? (
          <span className="position-code is-static" title="This game's Chess960 starting rank">
            <span className="position-label-key">960</span>
            <span className="position-code-value">{positionLabel}</span>
          </span>
        ) : formationInputMode ? (
          <span className="position-code is-editing">
            <span className="position-label-key">960</span>
            <input
              ref={formationInputRef}
              type="text"
              className="position-input"
              value={formationInputValue}
              onChange={(e) => setFormationInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFormationCode();
                if (e.key === 'Escape') cancelFormationInput();
              }}
              onBlur={commitFormationOnBlur}
              placeholder="RQKRNBBN"
              maxLength={8}
              aria-label="Chess960 starting rank"
            />
            {formationInputValue && !isValidChess960Key(formationInputValue.trim().toUpperCase()) && (
              <span className="position-input-error">Invalid 960 code</span>
            )}
          </span>
        ) : (
          <button
            type="button"
            className="position-code"
            onClick={() =>
              guardLeave('Set a new position', true, () => {
                setFormationInputValue(positionLabel);
                setFormationInputMode(true);
              })
            }
            title="Click to start from a specific Chess960 position"
          >
            <span className="position-label-key">960</span>
            <span className="position-code-value">{positionLabel}</span>
            <Icon icon={Pencil} size={11} className="position-code-pencil" aria-hidden />
          </button>
        )}
      </div>
      </div>
      <aside className="right-sidebar">
        {/* V1 — while a replay is playing, the whole setup panel is inert.
            Its controls used to stay live, so picking "Local" mid-replay
            mounted the hot-seat UI on top of someone else's game and let
            it rotate. Nothing in here means anything until the replay is
            stopped, so nothing in here can be pressed. */}
        <section
          className={`sidebar-panel sidebar-opponent${watchingGame ? ' is-inert' : ''}`}
          inert={watchingGame ? true : undefined}
        >
          <h2 className="sidebar-panel-title">Game setup</h2>
          {watchingGame && (
            <p className="setup-inert-note">
              Replay in progress. Stop it to change the game setup.
            </p>
          )}
          <h3 className="setup-sub-label">Opponent</h3>
          {/* Sprint 4.3.1 — when a local game is in progress, lock all
              non-local opponent tabs behind a confirm dialog so a stray
              tap can't silently abandon the game. The lock is "soft":
              the button is visually dimmed (.is-locked) but still
              dispatches click → confirm, instead of being natively
              disabled (which would also suppress the click handler). */}
          {(() => {
            const oppLocked = gameInProgress && !isMultiplayer && !watchingGame;
            const lockedTitle = 'Finish or resign the current game first';
            return (
              <div className="opponent-tabs-vertical">
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'ai' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
                  onClick={() => requestOpponentChange('ai')}
                  aria-disabled={oppLocked || undefined}
                  title={oppLocked ? lockedTitle : 'Play vs the engine'}
                >
                  <Icon icon={Bot} size="md" aria-hidden />
                  <span>vs AI</span>
                </button>
                {/* V1 — "vs Friend" undersold this tab: it is the whole
                    online side (quick match against a stranger, or a
                    private 6-letter code). "Online" pairs naturally with
                    "Local" and matches what the lobby actually offers. */}
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'friend' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
                  onClick={() => requestOpponentChange('friend')}
                  aria-disabled={oppLocked || undefined}
                  title={oppLocked ? lockedTitle : 'Play a real opponent: quick match, or a private code'}
                  disabled={!user || !displayName}
                >
                  <Icon icon={Users} size="md" aria-hidden />
                  <span>Online</span>
                </button>
                {/* Sprint 4.1 — Local hot-seat. Both colours play from this
                    device; the AI scheduler short-circuits via the
                    isLocalMode flag in the currentPlayer derivation. */}
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'local' ? ' is-active' : ''}`}
                  onClick={() => requestOpponentChange('local')}
                  title="Hot-seat: both players on this device"
                >
                  <Icon icon={UsersRound} size="md" aria-hidden />
                  <span>Local</span>
                </button>
              </div>
            );
          })()}

          {/* Design experiment (neon-stitch): mode cards moved here from
              above the board — the mock's GAME SETUP panel owns opponent,
              mode and time control together. */}
          <h3 className="setup-sub-label">Mode</h3>
          <div className="game-mode-cards" data-tour="modes">
            <button
              type="button"
              className={`mode-card${gameMode === 'classic' ? ' is-active' : ''}`}
              disabled={modeToggleLocked}
              title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Classic chess rules'}
              onClick={() => {
                if (gameMode === 'classic') return;
                setGameMode('classic');
                setAllowedPieceTypes(null);
                setIsRouletteSpinning(false);
                setRouletteActionsLeft(0);
                setUsedRouletteSlots([]);
              }}
            >
              <span className="mode-card-icon" aria-hidden>
                <Icon icon={Crosshair} size="xl" strokeWidth={1.75} />
              </span>
              <span className="mode-card-content">
                <span className="mode-card-title">Classic</span>
                <span className="mode-card-subtitle">
                  Standard chess960 + topology rotation
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`mode-card${gameMode === 'roulette' ? ' is-active' : ''}`}
              disabled={modeToggleLocked}
              title={modeToggleLocked ? 'Finish or restart the game to change modes' : 'Spin a 4-slot bag · 2 actions/turn (move or rotate)'}
              onClick={() => {
                if (gameMode === 'roulette') return;
                setGameMode('roulette');
                setAllowedPieceTypes(null);
                setIsRouletteSpinning(false);
                setRouletteActionsLeft(0);
                setUsedRouletteSlots([]);
              }}
            >
              <span className="mode-card-icon" aria-hidden>
                <Icon icon={Dices} size="xl" strokeWidth={1.75} />
              </span>
              <span className="mode-card-content">
                <span className="mode-card-title">Roulette</span>
                <span className="mode-card-subtitle">
                  Capture-the-king · spin the wheel
                </span>
              </span>
            </button>
          </div>

          {/* Solo time control: flips the S2.5 elapsed chips into remaining
              countdowns. Display-only — nobody loses on time vs the bot.
              MP time control comes from the lobby, so the pills lock there. */}
          {/* V1 — bot strength. Solo vs AI only; locked once a game is on
              (a mid-game switch would silently change the opponent). */}
          {opponentMode === 'ai' && !isMultiplayer && (
            <>
              <h3 className="setup-sub-label">Bot strength</h3>
              <div className="tc-pills" role="radiogroup" aria-label="Bot strength">
                {BOT_STRENGTHS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={botLevel === level}
                    className={`tc-pill${botLevel === level ? ' is-active' : ''}${level === 'strong' ? ' is-ranked' : ''}`}
                    disabled={modeToggleLocked}
                    title={
                      modeToggleLocked
                        ? 'Finish or restart the game to change the bot'
                        : BOT_STRENGTH_HINT[level]
                    }
                    onClick={() => setBotLevel(level)}
                  >
                    {BOT_STRENGTH_LABEL[level]}
                  </button>
                ))}
              </div>
              <p className="setup-hint">{BOT_STRENGTH_SUMMARY[botLevel]}</p>
            </>
          )}
          <h3 className="setup-sub-label">Time control</h3>
          <div className="tc-pills" role="radiogroup" aria-label="Time control">
            {([
              [null, 'None'],
              [60, '1 min'],
              [180, '3 min'],
              [600, '10 min'],
            ] as const).map(([sec, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={soloTcSec === sec}
                className={`tc-pill${soloTcSec === sec ? ' is-active' : ''}`}
                disabled={isMultiplayer || modeToggleLocked}
                title={
                  isMultiplayer
                    ? 'Time control is set in the match lobby'
                    : modeToggleLocked
                      ? 'Finish or restart the game to change the clock'
                      : sec === null
                        ? 'Free play: clocks just count time spent'
                        : `Each side gets ${label}. Run out and you lose on time`
                }
                onClick={() => setSoloTcSec(sec)}
              >
                {label}
              </button>
            ))}
          </div>
          {soloTcSec !== null && !isMultiplayer && (
            <p className="setup-hint">Clocks start on the first move. Out of time = loss.</p>
          )}
        </section>

        <section className="sidebar-panel sidebar-moves">
          <h2 className="sidebar-panel-title">
            Moves ({Math.ceil(log.moves.length / 2)})
          </h2>
          {log.moves.length === 0 ? (
            <div className="move-log-empty">No moves yet.</div>
          ) : (
            <pre ref={moveLogScrollRef} className="move-log-text">
              {notationString}
            </pre>
          )}
          <button
            type="button"
            className="copy-btn"
            onClick={copyNotation}
            disabled={log.moves.length === 0}
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </section>

        <section className="sidebar-panel sidebar-analysis" data-tour="analysis">
          <h2 className="sidebar-panel-title">Analysis</h2>
          {(() => {
            if (searchMateInPlies != null) {
              const movesToMate = Math.ceil(Math.abs(searchMateInPlies) / 2);
              const fromMy =
                myColor === 'white' ? searchMateInPlies : -searchMateInPlies;
              const cls = fromMy > 0 ? 'positive' : 'negative';
              return (
                <div className={`analysis-eval ${cls}`}>
                  {fromMy > 0 ? '+' : '-'}M{movesToMate}
                </div>
              );
            }
            if (!isMultiplayer && searchEvalFromWhite === null) {
              return <div className="analysis-eval">…</div>;
            }
            const cp = myPerspectiveEval;
            const cls = cp > 30 ? 'positive' : cp < -30 ? 'negative' : '';
            return (
              <div className={`analysis-eval ${cls}`}>
                {cp >= 0 ? '+' : ''}
                {(cp / 100).toFixed(2)}
              </div>
            );
          })()}
          {log.moves.length > 0 && (
            <div className="analysis-last">
              Last move:&nbsp;
              <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                {log.moves[log.moves.length - 1]?.san ??
                  `${log.moves[log.moves.length - 1]?.move.from ?? ''}→${log.moves[log.moves.length - 1]?.move.to ?? ''}`}
              </span>
            </div>
          )}
          {/* Sprint 3.4.1 — Review CTA moved out of the board-actions
              row into the Analysis panel, where it reads as the natural
              next step after viewing the eval. */}
          {/* S2.1 — mid-match the local `log` belongs to the previous
              single-player game, so Review here would open the wrong
              game. Finished matches review via the end-of-match dialog. */}
          <button
            type="button"
            className="panel-action-btn"
            onClick={() => busy.navigate('Opening review', () => setView('review'))}
            disabled={log.moves.length === 0 || isMultiplayer}
            title={isMultiplayer ? 'Review opens from the end-of-match screen' : undefined}
          >
            <Icon icon={BarChart3} size="md" aria-hidden />
            Review {isMultiplayer ? '(after the match)' : log.moves.length > 0 ? 'this game' : '(no moves yet)'}
          </button>
        </section>
      </aside>
      </div>

      {showReplayDialog && (
        <div className="help-backdrop" onClick={() => setShowReplayDialog(false)}>
          <div className="help-dialog replay-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Replay from log</h2>
            <p>Paste a move log in the same format as “Copy to clipboard”.</p>
            <textarea
              className="replay-textarea"
              value={replayText}
              onChange={(e) => setReplayText(e.target.value)}
              placeholder='[Chess960 "RQKRNBBN"]\n[Seed "123"]\n\n1. e2→e4  e7→e5\n2. A→B  g8→f6\n...'
              rows={10}
            />
            {replayError && <div className="replay-error">{replayError}</div>}
            <div className="replay-actions">
              <button type="button" className="help-close-btn" onClick={importReplayFromNotation}>
                Load replay
              </button>
              <button
                type="button"
                className="help-close-btn"
                onClick={() => setShowReplayDialog(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V1 — the status bar used to say "Ready" / "In play" and a raw move,
          which told the player nothing they could act on. It now answers the
          one question a status bar should: whose move is it, and how far
          along are we. */}
      <footer className="app-status-bar">
        {(() => {
          const lastEntry = log.moves[log.moves.length - 1];
          const lastText = lastEntry
            ? lastEntry.san ?? `${lastEntry.move.from ?? ''}→${lastEntry.move.to ?? ''}`
            : null;
          const fullMoves = Math.ceil(log.moves.length / 2);
          let tone: 'over' | 'mine' | 'theirs' | 'idle' = 'idle';
          let text: string;
          if (gameStatus !== 'active') {
            tone = 'over';
            text = gameOverMessage ?? 'Game over';
          } else if (watchingGame) {
            text = `Watching ${watchingGame.playerName}'s game`;
          } else if (isMultiplayer && mpSync) {
            tone = mpSync.isMyTurn ? 'mine' : 'theirs';
            text = mpSync.isMyTurn
              ? 'Your move'
              : `${mpSync.opponentDisplayName} is thinking`;
          } else if (isLocalMode) {
            tone = 'mine';
            text = `${state.sideToMove === 'white' ? 'White' : 'Black'} to move`;
          } else if (currentPlayer === 'human') {
            tone = 'mine';
            text = log.moves.length === 0 ? 'Your move: make the first one' : 'Your move';
          } else {
            tone = 'theirs';
            text = 'Bot is thinking';
          }
          return (
            <>
              <span className={`status-chip status-chip-${tone}`}>
                <span className="status-dot" aria-hidden />
                {text}
              </span>
              <span className="status-meta">
                <span className="status-meta-item">
                  Move <strong>{fullMoves}</strong>
                </span>
                {lastText && (
                  <span className="status-meta-item">
                    Last <strong className="status-mono">{lastText}</strong>
                  </span>
                )}
              </span>
            </>
          );
        })()}
      </footer>

      {!isMultiplayer && (
        <MemoryPanel
          onGameActivate={(g) =>
            guardLeave('Open this saved game', true, () => onMemoryGameActivate(g))
          }
        />
      )}

      {/* The name prompt waits its turn behind BOTH the welcome screen and
          the tour. It used to wait only for the welcome screen, so taking
          the "start the tour" button dropped a modal straight on top of
          the first tour step — the field sat over the tooltip and neither
          could be read. The tour teaches; the name is what you pick once
          you have decided to stay, so it comes after. Skipping the tour
          still brings it up immediately. */}
      {!authLoading && user && !displayName && !showWelcome && !showTutorial && (
        <NamePicker
          mode="initial"
          uid={user.uid}
          onComplete={(name) => {
            setDisplayName(name);
          }}
        />
      )}

      {showNameModal && user && displayName && (
        <NamePicker
          mode="change"
          uid={user.uid}
          currentName={displayName}
          onComplete={(name) => {
            setDisplayName(name);
            setShowNameModal(false);
          }}
          onCancel={() => setShowNameModal(false)}
        />
      )}

      {confirmingResign && (
        <ConfirmDialog
          title="Resign this game?"
          message="Resigning only earns half move points and no capture or outcome bonus. Are you sure?"
          confirmLabel="Resign anyway"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmResign}
          onCancel={() => setConfirmingResign(null)}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          title={pendingLeave.title}
          message={pendingLeave.message}
          confirmLabel={pendingLeave.confirmLabel}
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const go = pendingLeave.run;
            setPendingLeave(null);
            go();
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}

      {pendingOpponentChange && (
        <ConfirmDialog
          title="Abandon current game?"
          message="Switching opponent will end the game in progress and start fresh."
          confirmLabel="Abandon game"
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const next = pendingOpponentChange;
            setPendingOpponentChange(null);
            applyOpponentChange(next);
            startNewGame();
          }}
          onCancel={() => setPendingOpponentChange(null)}
        />
      )}

      {isMultiplayer && mpSync && mpEndOutcome && !endgameSceneActive && (() => {
        const myView = translateOutcomeForPlayer(
          mpEndOutcome,
          {
            uid: mpSync.myUid,
            displayName: '',
            color: mpSync.myColor,
          },
          mpSync.matchState.host.uid,
        );
        const opp = mpSync.opponentDisplayName;
        // QA-04 — a flag fall or an inactivity forfeit is not a resignation.
        const resignCause =
          myView === 'human-resign' && mpSelfResignedRef.current === mpSync.matchState.code
            ? 'resign'
            : mpResignCause({ ...mpSync.matchState, outcome: mpEndOutcome });
        const headline =
          myView === 'human-win'
            ? `You won vs ${opp}!`
            : myView === 'human-resign'
              ? resignCause === 'timeout'
                ? `You ran out of time vs ${opp}.`
                : resignCause === 'resign'
                  ? `You resigned vs ${opp}.`
                  : `You lost vs ${opp}.`
              : myView === 'ai-win'
                ? `You lost vs ${opp}.`
                : `Draw vs ${opp}.`;
        const loserName =
          mpEndOutcome === 'host-resign'
            ? mpSync.matchState.host.displayName
            : mpSync.matchState.guest?.displayName ?? 'Guest';
        const subline =
          mpEndOutcome === 'host-resign' || mpEndOutcome === 'guest-resign'
            ? resignCause === 'timeout'
              ? `${loserName} ran out of time.`
              : resignCause === 'resign'
                ? `${loserName} resigned.`
                : `${loserName} resigned or left the game.`
            : mpEndOutcome === 'draw'
              ? 'Match drawn.'
              : `${mpEndOutcome === 'white-win' ? 'White' : 'Black'} wins by checkmate.`;
        function dismiss() {
          busy.navigate('Back to the board', () => {
            setMpEndOutcome(null);
            setActiveMatch(null);
            setOpponentMode('ai');
            setView('game');
          });
        }
        function backToLobby() {
          busy.navigate('Opening the lobby', () => {
            setMpEndOutcome(null);
            setActiveMatch(null);
            mpSavedGameIdRef.current = null;
            mpWroteOutcomeRef.current = null;
            setView('friend-lobby');
          });
        }
        function reviewMatch() {
          if (!mpSync) return;
          // Snapshot the match log so leaving the live match doesn't pull
          // the data out from under the review screen. classifyAsync will
          // populate per-move analysis on the fly inside GameReview.
          // Snapshot NOW, before the deferred switch: the live match is
          // torn down inside it.
          const snapshot = deriveMpLog(mpSync.matchState);
          const meta = {
            playerName: displayName ?? 'You',
            opponentName: mpSync.opponentDisplayName,
            outcome: myView,
          };
          busy.navigate('Opening review', () => {
            setActiveReviewLog(snapshot);
            setActiveReviewMeta(meta);
            setMpEndOutcome(null);
            setActiveMatch(null);
            setView('review');
          });
        }
        return (
          <div className="mp-completion-backdrop" onClick={dismiss}>
            <div
              className="mp-completion-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mp-completion-title">Match complete</h2>
              <p className="mp-completion-headline">{headline}</p>
              <p className="mp-completion-subline">{subline}</p>
              <div className="mp-completion-actions">
                <button
                  type="button"
                  className="mp-btn mp-btn-primary"
                  onClick={reviewMatch}
                >
                  <Icon icon={BarChart3} size="md" aria-hidden /> Review this game
                </button>
                <button
                  type="button"
                  className="mp-btn mp-btn-secondary"
                  onClick={dismiss}
                >
                  Back to AI
                </button>
                <button
                  type="button"
                  className="mp-btn mp-btn-secondary"
                  onClick={backToLobby}
                >
                  Find opponent
                </button>
              </div>
              <p className="mp-completion-footnote">
                PvP games don&apos;t affect leaderboard points.
              </p>
            </div>
          </div>
        );
      })()}

      {/* R13/BUG-5 kept local hot-seat OUT of finishGame/GameSummary on
          purpose (a 2-humans-one-device game has no "human" to attribute
          a personal-best/leaderboard entry to) - but that meant its ending
          was just a text banner with no modal and no explicit "new game"
          prompt, unlike every other mode. Reuses the MP completion dialog's
          styling (mp-completion-*) - same shape, no scoring, just the
          outcome + a clear way to start again. */}
      {isLocalMode && gameStatus !== 'active' && !localGameOverDismissed && !endgameSceneActive && log.moves.length > 0 && (
        <div
          className="mp-completion-backdrop"
          onClick={() => setLocalGameOverDismissed(true)}
        >
          <div className="mp-completion-dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="mp-completion-title">Game over</h2>
            <p className="mp-completion-headline">{gameOverMessage}</p>
            <div className="mp-completion-actions">
              <button
                type="button"
                className="mp-btn mp-btn-primary"
                onClick={() => {
                  setLocalGameOverDismissed(true);
                  startNewGame();
                }}
              >
                Start new game
              </button>
              <button
                type="button"
                className="mp-btn mp-btn-secondary"
                onClick={() => setLocalGameOverDismissed(true)}
              >
                Keep viewing board
              </button>
            </div>
          </div>
        </div>
      )}

      {summaryOpen && lastGamePoints && gameOutcome && !endgameSceneActive && (
        <GameSummary
          points={lastGamePoints}
          outcome={gameOutcome}
          personalBest={personalBest}
          isNewPersonalBest={isNewBest}
          currentRank={currentRank}
          saving={savingGame}
          saveError={saveError}
          chess960Id={positionLabel}
          gameId={lastGameId}
          playerId={user?.uid ?? null}
          playerName={displayName}
          durationMs={lastGameDurationMs ?? undefined}
          gameMode={gameMode}
          uncountedReason={
            lastGameImported
              ? 'Loaded from a replay log. Imported games are never ranked.'
              : botLevel !== 'strong'
                ? `Played vs the ${BOT_STRENGTH_LABEL[botLevel]} bot. Only Strong-bot games are ranked.`
                : undefined
          }
          uncountedTitle={lastGameImported ? 'Imported game' : undefined}
          onClose={() => setSummaryOpen(false)}
          onPlayAgain={() => {
            setSummaryOpen(false);
            startNewGame();
          }}
        />
      )}

      {showFeedbackModal && user && displayName && (
        <FeedbackModal
          playerId={user.uid}
          playerName={displayName}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}

      {showMilestoneModal && (
        <MilestoneModal
          fullMoves={Math.floor(log.moves.length / 2)}
          currentScoreEstimate={Math.floor(log.moves.length / 2) * 5}
          onKeepPlaying={() => setShowMilestoneModal(false)}
          onResignNow={() => {
            setShowMilestoneModal(false);
            // The modal already explained the consequence — go straight to
            // the resign-confirmation dialog so the player can change their
            // mind without an extra click.
            requestResign();
          }}
        />
      )}

      {showHelp && (
        <div className="help-backdrop" onClick={() => setShowHelp(false)}>
          <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Subutai &mdash; Auxetic Chess960</h2>
            <p>
              Subutai combines <strong>Chess960</strong> (Fischer random chess) with an
              <strong> <a href="https://www.youtube.com/shorts/RLO48ETn6LE" target="_blank"> auxetic board</a></strong> that can rotate between two stable states.
            </p>
            <p><strong>How it works:</strong></p>
            <ul>
              <li>The board is divided into 4&times;4 blocks of 2&times;2 squares.</li>
              <li>Pressing <em>Rotate</em> flips all blocks &plusmn;90&deg;, reshuffling
                which squares are adjacent. This <strong>costs your turn</strong> but
                earns a <strong>+15 point bonus</strong> (up to 4 per game), and
                <strong> +25 more</strong> if you capture within your next two moves.</li>
              <li>Hover the eye button to preview the rotation; <strong>click</strong> the eye to
                temporarily lock the rotated view for inspection (click again to unlock). This is not the move.</li>
              <li><em>Support map</em> (arrow button): shows which of your pieces are backed up by others (arrows from supporter to supported).</li>
              <li><em>Threat map</em> (warning button): tints squares the opponent attacks. Hover a threatened square to highlight the threatening pieces.</li>
              <li>The starting position is a random Chess960 arrangement.</li>
              <li><strong>Classic mode:</strong> standard chess rules — you cannot move into check, checkmate ends the game.</li>
              <li><strong>Roulette mode:</strong> capture-the-king variant. Each turn you spin a 4-slot bag of random
                piece types and get <strong>2 actions</strong>. Each action is either a move (using one of the slot's
                piece types) or a Rotate. There's no check rule — leaving your king attacked is legal, but the
                opponent can capture it on their next move to win.</li>
            </ul>
            <p>
              <a href="https://en.wikipedia.org/wiki/Fischer_random_chess" target="_blank" rel="noopener noreferrer">
                Chess960 on Wikipedia
              </a>
            </p>
            {/* R14 — display scale: CSS zoom on <body>, persisted. The fix
                for "everything is tiny on a big monitor". */}
            <div className="help-scale-row">
              <label htmlFor="ui-scale">
                Display scale
                <span className="help-scale-val">{Math.round(uiScale * 100)}%</span>
              </label>
              <input
                id="ui-scale"
                type="range"
                min={0.8}
                max={1.5}
                step={0.05}
                value={uiScale}
                onChange={(e) => pickUiScale(Number.parseFloat(e.target.value))}
                aria-label="Interface scale"
              />
              {uiScale !== 1 && (
                <button type="button" className="help-scale-reset" onClick={() => pickUiScale(1)}>
                  100%
                </button>
              )}
            </div>
            <div className="help-dialog-actions">
              <button
                type="button"
                className="help-tour-btn"
                onClick={() => {
                  setShowHelp(false);
                  setShowTutorial(true);
                }}
              >
                Replay tutorial
              </button>
              <button type="button" className="help-close-btn" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S2.2 — first-launch tour. Only meaningful over the live game
          screen; suppressed in replays, multiplayer, and sub-views. */}
      {/* V1 — first visit: one screen, two doors, then (optionally) the
          tour. Never for a shared-game link or the kiosk/auto modes. */}
      {showWelcome && view === 'game' && !watchingGame && !sharedGameId && (
        <WelcomeScreen
          onStart={() => dismissWelcome(true)}
          onSkip={() => dismissWelcome(false)}
        />
      )}


      {showTutorial && view === 'game' && !isMultiplayer && !watchingGame && (
        <TutorialOverlay onClose={closeTutorial} />
      )}

      {/* T3 — Twitch chat + predictions overlay. gameKey resets the
          vote round per game; the result is derived once the status
          leaves 'active'. */}
      {/* SP — Spotify dock: embed player + tap-tempo beat sync + mic
          equalizer controls. */}
      {showMusicDock && (
        <Suspense fallback={null}>
          <MusicDock onClose={() => setShowMusicDock(false)} />
        </Suspense>
      )}
      {/* SP-2 — on-beat combo overlay; renders null while idle. */}
      <BeatCombo />
      {/* R12 — session beat-points tally (compact pill, click to expand). */}
      <MusicScorePanel />

      {/* R17b — the held-breath beat: a dim freeze before the cinematic. */}
      {victoryFreeze && <div className="victory-freeze" aria-hidden />}
      {/* V1 — the endgame cut: the losing king lifts off its square as
          pixels and the win or the loss plays out around it. */}
      {endgameCut && (
        <Suspense fallback={null}>
          <EndgameScene
            kind={endgameCut.kind}
            theme={endgameCut.theme}
            king={endgameCut.king}
            prelude={endgameCut.prelude}
            onDone={() => setEndgameCut(null)}
          />
        </Suspense>
      )}

      {showTwitch && (
        <Suspense fallback={null}>
          <TwitchPanel
            gameKey={logLocal.id}
            gameResult={(() => {
              if (gameStatus === 'checkmate') {
                return state.sideToMove === 'white' ? 'black' : 'white';
              }
              if (gameStatus === 'king_captured_white_wins') return 'white';
              if (gameStatus === 'king_captured_black_wins') return 'black';
              if (gameStatus === 'resigned_white') return 'black';
              if (gameStatus === 'resigned_black') return 'white';
              if (gameStatus.startsWith('draw')) return 'draw';
              return null;
            })()}
            onClose={() => {
              // Closing the overlay also stops gating AI moves —
              // otherwise the game would silently pause 15s per move.
              moveVoting.setMode('off');
              setShowTwitch(false);
            }}
          />
        </Suspense>
      )}

    </div>
    </div>
  );
}

function EvalBar({
  evalCp,
  mateInPlies,
  isPending,
}: {
  /** VIEWER-perspective centipawn score. Positive = "I'm winning". App
   *  inverts this for the black seat before passing it in (T5) — keeps
   *  this component dumb: always fill the bottom (my-side) of the bar. */
  evalCp: number;
  mateInPlies: number | null;
  /** True while we're showing the static-eval fallback waiting on the worker. */
  isPending: boolean;
}) {
  const isMate = mateInPlies !== null;
  let mySidePercent: number;
  let display: string;
  if (isMate) {
    // Snap to the winning edge so the bar visually screams "the game is
    // ending" — bypass the smooth tanh curve.
    mySidePercent = evalCp > 0 ? 95 : 5;
    const sign = evalCp > 0 ? '' : '−';
    const moves = Math.ceil((mateInPlies as number) / 2);
    display = moves <= 0 ? `${sign}#` : `${sign}M${moves}`;
  } else {
    // 50% baseline + tanh-shaped scale so big advantages don't peg the bar
    // to 0/100 and tiny ones still register. Clamp so the loser always
    // shows a sliver — fully empty looks broken.
    const t = Math.tanh(evalCp / 400);
    mySidePercent = Math.max(5, Math.min(95, 50 + t * 45));
    display = `${evalCp >= 0 ? '+' : '−'}${(Math.abs(evalCp) / 100).toFixed(1)}`;
  }
  // Text sits on the side opposite to my fill so it stays legible.
  const textOnBottom = mySidePercent < 50;
  return (
    <div
      className={`eval-bar${isMate ? ' is-mate' : ''}${isPending ? ' is-pending' : ''}`}
      aria-label={`Evaluation ${display}`}
    >
      <div className="eval-bar-white" style={{ height: `${mySidePercent}%` }} />
      <span
        className={`eval-bar-text${textOnBottom ? ' eval-bar-text-bottom' : ' eval-bar-text-top'}`}
      >
        {display}
      </span>
    </div>
  );
}

function glyphForPiece(color: string, type: string): string {
  const map: Record<string, string> = {
    'white-pawn': '\u265F\uFE0E',
    'white-knight': '\u265E',
    'white-bishop': '\u265D',
    'white-rook': '\u265C',
    'white-queen': '\u265B',
    'white-king': '\u265A',
    'black-pawn': '\u265F\uFE0E',
    'black-knight': '\u265E',
    'black-bishop': '\u265D',
    'black-rook': '\u265C',
    'black-queen': '\u265B',
    'black-king': '\u265A',
  };
  return map[`${color}-${type}`] ?? '';
}

export default App;
