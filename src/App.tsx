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
import { applyRotationMove, applyPassMove, toggleTopology, computeBoardLayout, tilePixelCenter } from './engine/auxetic';
import { SubutaiAgent } from './ai/agents';
import { evaluate, PIECE_VALUE } from './ai/evaluate';
import { searchPosition, ttClear } from './ai/search';
import { type MoveClass, type MoveAnalysis } from './analysis/classify';
import { classifyAsync } from './analysis/classifyClient';
import { NamePicker } from './components/NamePicker';
import { GameSummary } from './components/GameSummary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FeedbackModal } from './components/FeedbackModal';
import { MilestoneModal } from './components/MilestoneModal';
import { AutoPlayView } from './components/AutoPlayView';
import { ThemeToggle } from './components/ThemeToggle';
import { UserMenu } from './components/UserMenu';
import { Effects3DToggle } from './components/Effects3DToggle';
import { AudioToggle } from './components/AudioToggle';
import { MusicToggle } from './components/MusicToggle';
import { audio } from './audio/AudioController';
import { Icon } from './components/Icon';
import { Tooltip } from './components/Tooltip';
import { TutorialOverlay, TUTORIAL_DONE_KEY } from './components/TutorialOverlay';
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
  RotateCw,
  Sparkles,
  Trophy,
  Cast,
  Users,
  UsersRound,
} from 'lucide-react';
import type { GameReviewMeta } from './components/GameReview';
import { useMultiplayerSync } from './components/MultiplayerGameView';
import type { MatchDoc, MatchOutcome } from './firebase/matches';
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
import { localStorageAdapter } from './memory/storage';
import { MemoryPanel } from './memory/MemoryPanel';
import type { SavedGame } from './memory/types';
import { NotationParseError, parseMemoryNotation } from './memory/notation';
import { moveVoting } from './twitch/moveVoting';
import { micEq } from './audio/micEqualizer';
import { PerimeterEqualizer } from './components/PerimeterEqualizer';
import { beatBridge } from './music/beatBridge';
import { BeatCombo } from './components/BeatCombo';
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

type GameStatus =
  | 'active'
  | 'checkmate'
  | 'draw_stalemate'
  | 'draw_material'
  | 'draw_repetition'
  | 'draw_50move'
  | 'king_captured_white_wins'
  | 'king_captured_black_wins';

type GameMode = 'classic' | 'roulette';

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

// S2.5 — mm:ss elapsed-time display for the per-side clocks.
function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

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
function evalToColors(evalCp: number): { c1: string; c2: string } {
  const t = Math.tanh(evalCp / 400);
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
  const sharedGameId = useMemo(
    () => new URLSearchParams(window.location.search).get('game'),
    [],
  );

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
  const [confirmingResign, setConfirmingResign] = useState(false);
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
  const mpSavedGameIdRef = useRef<string | null>(null);
  const mpWroteOutcomeRef = useRef<string | null>(null);
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
  const [watchingGame, setWatchingGame] = useState<WatchingGame | null>(null);
  const watchAutoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameBackupRef = useRef<GameBackup | null>(null);
  const [seed, setSeed] = useState<number>(1);
  // Local single-player engine state. In multiplayer (Q.B.2) the rest of
  // App reads through the `state` / `legalMoves` / `log` / `lastMove`
  // const aliases below, which swap to mpSync-derived values; the local
  // setters keep firing for safety but their writes are visually inert
  // because the aliases ignore them.
  const [stateLocal, setState] = useState<BoardState>(() => createStartingPosition(1));
  const [initialState, setInitialState] = useState<BoardState>(() => createStartingPosition(1));
  const [selected, setSelected] = useState<string | null>(null);
  const [legalMovesLocal, setLegalMoves] = useState<Move[]>(() =>
    generateLegalMoves(createStartingPosition(1)),
  );
  const [logLocal, setLog] = useState<GameLog>(() =>
    createGameLog('game-1', createStartingPosition(1), 1),
  );
  const [gameStatus, setGameStatus] = useState<GameStatus>('active');
  const [previewTopology, setPreviewTopology] = useState<TopologyState | null>(null);
  const [lastMoveLocal, setLastMove] = useState<{ from?: SquareId; to?: SquareId } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // S2.2 — first-launch tour. Defaults to open until the user finishes
  // or skips it once; replayable from the Help dialog.
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TUTORIAL_DONE_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const closeTutorial = useCallback(() => {
    try {
      localStorage.setItem(TUTORIAL_DONE_KEY, '1');
    } catch { /* private mode — show it again next visit */ }
    setShowTutorial(false);
  }, []);
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
  // SP — Spotify dock visibility + whether the mic equalizer runs
  // (the perimeter ring mounts only while it does).
  const [showMusicDock, setShowMusicDock] = useState(false);
  const [vizOn, setVizOn] = useState(false);
  useEffect(() => micEq.onState(setVizOn), []);
  // S2.5 — per-side elapsed clocks. Pure UX (no flag-fall): the active
  // side's clock accumulates wall time while the game is live. Reset on
  // every new game log.
  const [clockMs, setClockMs] = useState<{ white: number; black: number }>({
    white: 0,
    black: 0,
  });
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

  const [boardSize, setBoardSize] = useState(() =>
    Math.min(window.innerWidth - 32, 520),
  );

  useEffect(() => {
    function onResize() {
      setBoardSize(Math.min(window.innerWidth - 32, 520));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (formationInputMode) formationInputRef.current?.focus();
  }, [formationInputMode]);

  useEffect(() => {
    if (isMultiplayer) return; // PvP games persist via /games, not local Memory
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (savedForLogIdRef.current === log.id) return;

    const sourceId = liveSavedGameIdRef.current;
    const termination: 'checkmate' | 'stalemate' =
      gameStatus === 'checkmate'
        || gameStatus === 'king_captured_white_wins'
        || gameStatus === 'king_captured_black_wins'
        ? 'checkmate'
        : 'stalemate';
    const saved = buildSavedGameFromLog(log, state, termination, sourceId);
    (localStorageAdapter.saveOrUpdateGame?.(saved) ?? localStorageAdapter.saveGame(saved));

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
    const snapshot = buildSavedGameSnapshot(log, liveId);
    (localStorageAdapter.saveOrUpdateGame?.(snapshot) ?? localStorageAdapter.saveGame(snapshot));
  }, [gameStatus, log, isMultiplayer]);

  // Game-completion pipeline: detects terminal gameStatus transitions, computes
  // points, opens the GameSummary modal, and kicks the async Firestore save.
  // The ref guards against double-fires (StrictMode + deps that move together).
  // Auto mode handles completion via its own effect — never enters this path.
  useEffect(() => {
    if (isAutoMode) return;
    if (isMultiplayer) return; // MP completion runs through a separate effect
    if (gameStatus === 'active') return;
    if (log.moves.length === 0) return;
    if (completedLogIdRef.current === log.id) return;
    // Resign sets gameOutcome before flipping status — don't overwrite it.
    if (gameOutcome) return;
    completedLogIdRef.current = log.id;

    let outcome: GameOutcome;
    if (gameStatus === 'checkmate') {
      outcome = state.sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
    } else if (gameStatus === 'king_captured_black_wins') {
      // Black wins => human (white) lost.
      outcome = 'ai-win';
    } else if (gameStatus === 'king_captured_white_wins') {
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
    // Host-only /games write — guarded by code so retries are idempotent.
    if (mpSync.isHost && mpSavedGameIdRef.current !== match.code) {
      mpSavedGameIdRef.current = match.code;
      void saveMultiplayerGameToGames(match).catch((err) => {
        console.error('[mp] save to /games failed', err);
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
    const points = computeGamePoints(log, outcome, HUMAN_COLOR, gameMode);
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
      });
      setLastGameId(gameId);
      setIsNewBest(nb);
      setCurrentRank(newRank);
      if (nb) setPersonalBest(points.total);
    } catch (err) {
      console.error('[finishGame] save failed', err);
      setSaveError('Could not save this game. Check your connection.');
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

  function requestResign() {
    if (watchingGame) return;
    if (isMultiplayer) {
      if (!mpSync || mpSync.matchState.status !== 'active') return;
      setConfirmingResign(true);
      return;
    }
    if (gameStatus !== 'active') return;
    if (log.moves.length === 0) return;
    setConfirmingResign(true);
  }

  function confirmResign() {
    setConfirmingResign(false);
    // PvP resign: route through the match doc so the opponent sees the
    // status flip; their listener will mirror the outcome. Local engine
    // state stays untouched (gameStatus etc.).
    if (isMultiplayer) {
      if (!mpSync) return;
      void mpSync.resign();
      return;
    }
    if (gameStatus !== 'active') return;
    // Pre-set the outcome so the gameStatus-watching effect skips this one.
    setGameOutcome('human-resign');
    setGameStatus('checkmate');
    completedLogIdRef.current = log.id;
    void finishGame('human-resign');
  }

  // Drive the gradient via CSS custom properties. setProperty (rather than
  // inline style) lets the @property-registered transition interpolate
  // colour-to-colour smoothly. prevEvalRef tracks the white-POV value
  // (classifier delta still expects white-POV).
  //
  // T5: paint from the viewer's perspective so each peer in a PvP match
  // sees their OWN winning/losing state — the player who's ahead gets
  // gold/warm, the player who's behind gets crimson/cool, simultaneously.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const { c1, c2 } = evalToColors(myPerspectiveEval);
    shell.style.setProperty('--eval-c1', c1);
    shell.style.setProperty('--eval-c2', c2);
    prevEvalRef.current = currentEval;
  }, [myPerspectiveEval, currentEval, view, activeMatch]);

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

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cancelFormationInput() {
    setFormationInputMode(false);
    setFormationInputValue('');
  }

  const tileBase = boardSize / 8;

  function checkKingCaptured(nextState: BoardState): boolean {
    const whiteKing = findKing(nextState, 'white');
    const blackKing = findKing(nextState, 'black');
    if (!whiteKing) {
      setGameStatus('king_captured_black_wins');
      return true;
    }
    if (!blackKing) {
      setGameStatus('king_captured_white_wins');
      return true;
    }
    return false;
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

  function checkGameOver(nextState: BoardState, lastMoveWasRotation: boolean = false) {
    // Q.D.8: roulette is capture-the-king — the ONLY terminal is a missing
    // king. No checkmate, no stalemate, no draws (the variant deliberately
    // skips them so play continues until a king is actually taken).
    if (gameMode === 'roulette') {
      checkKingCaptured(nextState);
      return;
    }
    // Classic mode: standard chess termination — checkmate, stalemate,
    // draw by repetition / 50-move / insufficient material.
    if (isCheckmate(nextState, lastMoveWasRotation)) {
      setGameStatus('checkmate');
      return;
    }
    const draw = checkDrawConditions(nextState, lastMoveWasRotation);
    if (draw === 'stalemate') setGameStatus('draw_stalemate');
    else if (draw === 'insufficient_material') setGameStatus('draw_material');
    else if (draw === 'threefold_repetition') setGameStatus('draw_repetition');
    else if (draw === 'fifty_move_rule') setGameStatus('draw_50move');
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
    completedLogIdRef.current = null;
    autoSavedLogIdRef.current = null;
    autoLastMoveAtRef.current = Date.now();
    gameStartedAtRef.current = Date.now();

    // New play session => new live snapshot id.
    liveSavedGameIdRef.current = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  useEffect(() => {
    if (gameStatus !== 'active' || watchingGame) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      const side = clockSideRef.current;
      setClockMs((c) => ({ ...c, [side]: c[side] + dt }));
    }, 500);
    return () => clearInterval(id);
  }, [gameStatus, watchingGame, logLocal.id]);

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

  const [mpNow, setMpNow] = useState(() => Date.now());
  useEffect(() => {
    if (!mpTimeControl || gameStatus !== 'active') return;
    const id = setInterval(() => setMpNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [mpTimeControl, gameStatus]);

  const mpClocks = useMemo(() => {
    if (!mpTimeControl || !mpSync) return null;
    const moves = mpSync.matchState.log.moves;
    let usedWhite = 0;
    let usedBlack = 0;
    for (let i = 1; i < moves.length; i++) {
      const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
      // Mover of entry i: entries alternate starting with white (rotations
      // consume the turn too, so parity holds in classic).
      if (i % 2 === 0) usedWhite += dt;
      else usedBlack += dt;
    }
    if (gameStatus === 'active' && moves.length > 0) {
      const live = Math.max(0, mpNow - (moves[moves.length - 1].timestamp ?? mpNow));
      if (moves.length % 2 === 0) usedWhite += live;
      else usedBlack += live;
    }
    const total = mpTimeControl * 1000;
    return {
      white: Math.max(0, total - usedWhite),
      black: Math.max(0, total - usedBlack),
    };
  }, [mpTimeControl, mpSync, mpNow, gameStatus]);

  const flagFiredRef = useRef(false);
  useEffect(() => {
    flagFiredRef.current = false;
  }, [mpSync?.matchState.code]);
  useEffect(() => {
    if (!mpClocks || !mpSync || flagFiredRef.current) return;
    if (mpSync.matchState.status !== 'active') return;
    const mine = mpSync.myColor === 'white' ? mpClocks.white : mpClocks.black;
    if (mine <= 0) {
      flagFiredRef.current = true;
      void mpSync.resign();
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
    setOpponentMode(next);
    if (next === 'friend') setView('friend-lobby');
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
  const isLocalMode = opponentMode === 'local' && !isMultiplayer;
  // Sprint 4.3.1 — derived "the user has committed to this game" flag.
  // Used to (a) hide the duplicate bottom action group in local 2P and
  // (b) lock the opponent / mode toggles so a misclick can't reset
  // mid-game state.
  const gameInProgress = log.moves.length > 0 && gameStatus === 'active';
  const currentPlayer = isMultiplayer
    ? mpSync!.isMyTurn
      ? 'human'
      : 'ai'
    : isLocalMode
      ? 'human'
      : state.sideToMove === 'white'
        ? 'human'
        : 'ai';

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
        });
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
        const move =
          gameMode === 'classic'
            ? await moveVoting.gate(boardState, moves, chosen)
            : chosen;

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
          setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, aiAnalysis));
          applyClassifyVisuals(moveIdx, aiAnalysis, move.to);
        }

        checkGameOver(next, move.kind === 'topologyToggle');
      }, 650);
    },
    [applyClassifyVisuals],
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

    const san = computeSAN(state, resolvedMove);
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
          setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, analysis));
          applyClassifyVisuals(moveIdx, analysis, resolvedMove.to);
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
    const san = computeSAN(state, move);
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
    }).then(
      (analysis) => {
        setLog((prev) => updateMoveAnalysisAt(prev, moveIdx, analysis));
        applyClassifyVisuals(moveIdx, analysis, move.to);
      },
    );
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
  }, [currentPlayer, state, gameMode, allowedPieceTypes, rouletteActionsLeft]);

  const layout = useMemo(
    () => computeBoardLayout(displayTopology, boardSize),
    [displayTopology, boardSize],
  );

  const scale = layout.tileSize / tileBase;

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

  const positionLabel = backRankString(initialState);

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
      if (mv.kind === 'topologyToggle') {
        current = applyRotationMove(current);
        nextLog = appendMove(nextLog, mv, undefined, entry.topology);
        continue;
      }
      if (!mv.from || !mv.to) continue;
      current = applyMove(current, mv);
      nextLog = appendMove(nextLog, mv, undefined, entry.topology);
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
    classifyImportedLog(nextLog);
  }
  // Keep the ref pointing at the latest resumeGame closure so the stable
  // onMemoryGameActivate callback always invokes the fresh state-bound copy.
  resumeGameRef.current = resumeGame;

  function importReplayFromNotation() {
    try {
      const parsed = parseMemoryNotation(replayText);
      const initial = createPositionFromBackRankKey(parsed.config960);
      let current: BoardState = initial;
      let replayLog: GameLog = createGameLog(`replay-${Date.now()}`, initial, Date.now());

      for (const token of parsed.moves) {
        const mv = token.move;

        // Auto-switch topology if @B/@A suffix requires it.
        // T1.2: use the pure `toggleTopology` (doesn't flip sideToMove or
        // record a move). Previously this called applyRotationMove which
        // burned a turn — and then castles by the (now wrong) side failed
        // with "No legal castle". The @B suffix is informational; if the
        // game really included a rotation, the log carries it as its own
        // entry and the toggleTopology no-ops when topology already matches.
        if (token.requiredTopology && current.topologyState !== token.requiredTopology) {
          current = toggleTopology(current);
        }

        if (mv.kind === 'topologyToggle') {
          const topoBefore = current.topologyState;
          const san = computeSAN(current, mv);
          current = applyRotationMove(current);
          replayLog = appendMove(replayLog, mv, san, topoBefore);
        } else if (mv.kind === 'castle') {
          // Resolve castle from legal moves
          const legal = getLegalMoves(current);
          const targetFile = token.castleSide === 'queen' ? 'c' : 'g';
          const castleMove = legal.find(
            (m) => m.kind === 'castle' && m.to && m.to[0] === targetFile,
          );
          if (!castleMove) {
            throw new NotationParseError('No legal castle move available at this position.');
          }
          const topoBefore = current.topologyState;
          const san = computeSAN(current, castleMove);
          current = applyMove(current, castleMove);
          replayLog = appendMove(replayLog, castleMove, san, topoBefore);
        } else if (mv.from && mv.to) {
          if (!current.pieces[mv.from]) {
            throw new NotationParseError(`Illegal move: no piece on ${mv.from}.`);
          }
          // Match against legal moves to get correct kind (capture vs normal)
          const legal = getLegalMoves(current);
          const matched = legal.find(
            (m) =>
              m.from === mv.from &&
              m.to === mv.to &&
              (!mv.promotion || m.promotion === mv.promotion),
          ) ?? mv;
          const topoBefore = current.topologyState;
          const san = computeSAN(current, matched);
          current = applyMove(current, matched);
          replayLog = appendMove(replayLog, matched, san, topoBefore);
        }
      }

      const id = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = buildSavedGameSnapshot(replayLog, id);
      (localStorageAdapter.saveOrUpdateGame?.(snapshot) ?? localStorageAdapter.saveGame(snapshot));

      // Load into the board as an unfinished game so it can be continued.
      liveSavedGameIdRef.current = id;
      setFormationLocked(true);
      setLockedFormationKey(parsed.config960);
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

  // Notation string for copy
  const notationString = useMemo(() => {
    const lines: string[] = [
      `[Chess960 "${positionLabel}"]`,
      `[Seed "${seed}"]`,
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
        const a = entry.analysis;
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
  }, [log.moves, positionLabel, seed]);

  function copyNotation() {
    navigator.clipboard.writeText(notationString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const gameOverMessage = useMemo(() => {
    if (gameStatus === 'checkmate') {
      const winner = state.sideToMove === 'white' ? 'Black' : 'White';
      return `Checkmate \u2014 ${winner} wins!`;
    }
    if (gameStatus === 'draw_stalemate') {
      return 'Draw \u2014 Stalemate';
    }
    if (gameStatus === 'draw_material') {
      return 'Draw \u2014 Insufficient material';
    }
    if (gameStatus === 'draw_repetition') {
      return 'Draw \u2014 Threefold repetition';
    }
    if (gameStatus === 'draw_50move') {
      return 'Draw \u2014 50-move rule';
    }
    if (gameStatus === 'king_captured_white_wins') {
      return 'King captured \u2014 White wins!';
    }
    if (gameStatus === 'king_captured_black_wins') {
      return 'King captured \u2014 Black wins!';
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
      <div className="app-shell" ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <GameReview
          log={activeReviewLog ?? log}
          meta={activeReviewMeta ?? undefined}
          gameId={sharedGameId ?? lastGameId ?? null}
          onBack={() => {
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
          }}
        />
        </Suspense>
      </div>
    );
  }

  if (view === 'leaderboard') {
    return (
      <div className="app-shell" ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <Leaderboard
          currentUid={user?.uid ?? null}
          watchDisabled={isMultiplayer}
          onBack={() => setView('game')}
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
      <div className="app-shell" ref={shellRef}>
        <Suspense fallback={<div className="view-loading"><span className="spinner" /></div>}>
        <FriendLobby
          uid={user?.uid ?? null}
          displayName={displayName}
          onBack={() => {
            setView('game');
            setOpponentMode('ai');
          }}
          onMatchReady={(match) => {
            // Q.B.2: hand the live match over to the regular game view.
            // The board / log / header all reuse the single-player UI,
            // sourcing their data from useMultiplayerSync.
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
      // Sprint 4.3.1 — data-opponent-mode + data-game-active drive CSS
      // selectors that hide duplicate / irrelevant controls in local
      // 2P hot-seat mode (the standard action group, standalone rotate,
      // material-score chip). Gated on game-active so the controls
      // reappear once the local game finishes and the user needs the
      // New Game / Lock buttons again.
      data-opponent-mode={opponentMode}
      data-game-active={gameInProgress ? '1' : '0'}
      ref={shellRef}
    >
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
    <div className="app-root" style={{ '--board-size': `${boardSize}px` } as React.CSSProperties}>
      <header className="app-header">
        <div className="app-brand">
          <h1>subutai</h1>
          {isMultiplayer && mpSync ? (
            <p className="app-tagline">
              vs <strong>{mpSync.opponentDisplayName}</strong> · {mpSync.matchState.code}
            </p>
          ) : (
            gameMode === 'classic' &&
            opponentMode === 'ai' && (
              <p className="app-tagline">
                Try to survive 50 moves against the AI
              </p>
            )
          )}
        </div>
        <div className="header-controls">
          <Tooltip text={showMusicDock ? 'Hide music dock' : 'Spotify + beat sync'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showMusicDock ? ' is-active' : ''}`}
              onClick={() => setShowMusicDock((v) => !v)}
              aria-label="Toggle music dock"
              aria-pressed={showMusicDock}
            >
              <Icon icon={Disc3} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text={showTwitch ? 'Hide Twitch chat' : 'Twitch chat + predictions'} side="bottom">
            <button
              type="button"
              className={`header-action-btn${showTwitch ? ' is-active' : ''}`}
              onClick={() => setShowTwitch((v) => !v)}
              aria-label="Toggle Twitch chat"
              aria-pressed={showTwitch}
            >
              <Icon icon={Cast} size="md" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Leaderboard" side="bottom">
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setView('leaderboard')}
              aria-label="Leaderboard"
            >
              <Icon icon={Trophy} size="md" aria-hidden />
            </button>
          </Tooltip>
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
          <MusicToggle />
          <AudioToggle />
          <Effects3DToggle />
          <ThemeToggle />
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

      {/* Sprint 4.1 — local hot-seat turn banner. Hands off cleanly
          between the two players sharing the device; the colour
          chip mirrors the active side so the next-to-move player
          can pick up immediately. */}
      {isLocalMode && gameStatus === 'active' && (
        <div className="local-turn-banner">
          <span className={`local-turn-chip local-turn-chip-${state.sideToMove}`} aria-hidden />
          <span className="local-turn-color">
            {state.sideToMove === 'white' ? 'White' : 'Black'}
          </span>
          <span className="local-turn-suffix">to move</span>
        </div>
      )}

      <div className="app-body">
      <div className="board-area">
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
      {/* S2.5 — per-side clocks. Elapsed time normally; in a timed MP
          match (B8) they switch to countdown, glowing red under 30s. */}
      {gameStatus === 'active' && !watchingGame && (
        <div className="game-clocks" aria-label="Game clocks">
          {(['white', 'black'] as const).map((side) => {
            const ms = mpClocks ? mpClocks[side] : clockMs[side];
            const low = mpClocks !== null && ms < 30_000;
            return (
              <span
                key={side}
                className={`clock-chip clock-chip-${side}${state.sideToMove === side ? ' is-running' : ''}${low ? ' is-low' : ''}`}
              >
                <span className="clock-chip-dot" aria-hidden />
                {side === 'white' ? 'White' : 'Black'} {formatClock(ms)}
              </span>
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
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={requestResign}
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
            className="rotate-btn-icon"
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
        className={`board-with-coords${showAfkAlert && currentPlayer === 'human' && gameStatus === 'active' ? ' is-afk-nudge' : ''}`}
        style={{ width: boardSize }}
        data-tour="board"
      >
      {/* SP — mic-driven spectrum ring; mounts only while the
          equalizer listens. Self-driving (no App re-renders). */}
      {vizOn && <PerimeterEqualizer />}
      <div
        className={`board${previewTopology || previewLocked ? ' previewing' : ''}${recentRotation ? ' is-rotated' : ''}`}
        data-topology={displayTopology}
        style={{ width: boardSize, height: boardSize }}
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

          // Sprint 3.2 — piece slide-in. When this tile is lastMove.to in
          // classic mode and both endpoints have angle 0 (no per-tile
          // rotation), compute the offset from the lastMove.from tile so
          // the piece starts at the "from" position and animates back to
          // its real center. Rotated-tile cases (topology B) skip the
          // slide rather than fight the local-frame transform math.
          let slideDx = 0;
          let slideDy = 0;
          let isSliding = false;
          if (
            piece &&
            gameMode === 'classic' &&
            lastMove?.to === sq &&
            lastMove.from &&
            lastMove.from !== lastMove.to &&
            angle === 0
          ) {
            const fromTile = tilePixelCenter(lastMove.from, displayTopology, layout);
            if (fromTile.angle === 0) {
              const fromCxView = flip ? boardSize - fromTile.cx : fromTile.cx;
              const fromCyView = flip ? boardSize - fromTile.cy : fromTile.cy;
              slideDx = fromCxView - cxView;
              slideDy = fromCyView - cyView;
              isSliding = true;
            }
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
                isEnPassantExplosion ? 'enpassant-explosion' : '',
                isLastFrom ? 'last-from' : '',
                isLastTo ? 'last-to' : '',
                olderHighlight ? 'last-older' : '',
                isCheckedKing ? (gameStatus === 'checkmate' ? 'mated-king' : 'checked-king') : '',
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
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                width: tileBase,
                height: tileBase,
                transform: `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${scale})`,
                ...(threatCount > 0 ? { '--threat-n': threatCount } as React.CSSProperties : {}),
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
                    return (
                      <span
                        className={[
                          'piece',
                          piece.color === 'white'
                            ? 'piece-white'
                            : 'piece-black',
                        ].join(' ')}
                        style={totalRot !== 0 ? { transform: `rotate(${totalRot}deg)` } : undefined}
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

      {/* Sprint 4.2 — bottom action row for the white-side player in
          local 2P mode. Mirrors the top row, rendered upright. */}
      {isLocalMode && gameStatus === 'active' && (
        <div className="local-actions local-actions-bottom" aria-hidden={state.sideToMove !== 'white'}>
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={requestResign}
            disabled={log.moves.length === 0}
            aria-label="Resign (white)"
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
            className="rotate-btn-icon"
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
                  <span className="piece piece-white">
                    {glyphForPiece('white', type)}
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
              onClick={startNewGame}
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
              onClick={requestResign}
              disabled={!!watchingGame || gameStatus !== 'active' || log.moves.length === 0}
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
                  {gameMode === 'classic' && (
                    <Tooltip text="Hint — engine suggests a move" side="top">
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
            className={`rotate-btn-icon${(showRotateHint || (hintMove && 'rotate' in hintMove)) && canRotate ? ' is-hint-pulsing' : ''}`}
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
          onClick={() => {
            setReplayError(null);
            setShowReplayDialog(true);
          }}
          title="Paste a move log to replay"
        >
          Replay
        </button>
        )}
        <span className="position-label">Chess960: {positionLabel}</span>
        {isMultiplayer || watchingGame ? null : !formationInputMode ? (
          <button
            type="button"
            className="position-edit-btn"
            onDoubleClick={() => {
              setFormationInputValue(positionLabel);
              setFormationInputMode(true);
            }}
            title="Double-click to enter formation code"
          >
            edit
          </button>
        ) : (
          <span className="position-input-wrap">
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
              onBlur={applyFormationCode}
              placeholder="e.g. RQKRNBBN"
              maxLength={8}
            />
            {formationInputValue && !isValidChess960Key(formationInputValue.trim().toUpperCase()) && (
              <span className="position-input-error">Invalid 960 code</span>
            )}
          </span>
        )}
      </div>
      </div>
      <aside className="right-sidebar">
        <section className="sidebar-panel sidebar-opponent">
          <h2 className="sidebar-panel-title">Opponent</h2>
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
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'friend' ? ' is-active' : ''}${oppLocked ? ' is-locked' : ''}`}
                  onClick={() => requestOpponentChange('friend')}
                  aria-disabled={oppLocked || undefined}
                  title={oppLocked ? lockedTitle : 'Private match by code'}
                  disabled={!user || !displayName}
                >
                  <Icon icon={Users} size="md" aria-hidden />
                  <span>vs Friend</span>
                  <span className="beta-tag-small">BETA</span>
                </button>
                {/* Sprint 4.1 — Local hot-seat. Both colours play from this
                    device; the AI scheduler short-circuits via the
                    isLocalMode flag in the currentPlayer derivation. */}
                <button
                  type="button"
                  className={`opp-tab${opponentMode === 'local' ? ' is-active' : ''}`}
                  onClick={() => requestOpponentChange('local')}
                  title="Hot-seat — both players on this device"
                >
                  <Icon icon={UsersRound} size="md" aria-hidden />
                  <span>Local</span>
                  <span className="beta-tag-small">BETA</span>
                </button>
              </div>
            );
          })()}
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
            onClick={() => setView('review')}
            disabled={log.moves.length === 0 || isMultiplayer}
            title={isMultiplayer ? 'Review opens from the end-of-match screen' : undefined}
          >
            <Icon icon={BarChart3} size="md" aria-hidden />
            Review {isMultiplayer ? '— after the match' : log.moves.length > 0 ? 'this game' : '— no moves yet'}
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

      <footer className="app-status-bar">
        {/* Sprint 2.7 — dropped the persistent "Your turn / Waiting"
            indicator. The AFK alert covers the attention case; whose
            turn it is can be read from the board + sidebar opponent
            panel. Status bar now just shows last move + game state. */}
        <span className="status-game-state">
          {gameStatus !== 'active'
            ? gameOverMessage ?? 'Game over'
            : log.moves.length > 0
              ? 'In play'
              : 'Ready'}
        </span>
        <span className="status-last-move">
          {log.moves.length > 0
            ? `Last: ${log.moves[log.moves.length - 1]?.san ??
                `${log.moves[log.moves.length - 1]?.move.from ?? ''}→${log.moves[log.moves.length - 1]?.move.to ?? ''}`}`
            : '—'}
        </span>
      </footer>

      {!isMultiplayer && (
        <MemoryPanel onGameActivate={onMemoryGameActivate} />
      )}

      {!authLoading && user && !displayName && (
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
          onCancel={() => setConfirmingResign(false)}
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

      {isMultiplayer && mpSync && mpEndOutcome && (() => {
        const myView = translateOutcomeForPlayer(mpEndOutcome, {
          uid: mpSync.myUid,
          displayName: '',
          color: mpSync.myColor,
        });
        const opp = mpSync.opponentDisplayName;
        const headline =
          myView === 'human-win'
            ? `You won vs ${opp}!`
            : myView === 'human-resign'
              ? `You resigned vs ${opp}.`
              : myView === 'ai-win'
                ? `You lost vs ${opp}.`
                : `Draw vs ${opp}.`;
        const subline =
          mpEndOutcome === 'host-resign'
            ? `${mpSync.matchState.host.displayName} resigned.`
            : mpEndOutcome === 'guest-resign'
              ? `${mpSync.matchState.guest?.displayName ?? 'Guest'} resigned.`
              : mpEndOutcome === 'draw'
                ? 'Match drawn.'
                : `${mpEndOutcome === 'white-win' ? 'White' : 'Black'} wins by checkmate.`;
        function dismiss() {
          setMpEndOutcome(null);
          setActiveMatch(null);
          setOpponentMode('ai');
          setView('game');
        }
        function backToLobby() {
          setMpEndOutcome(null);
          setActiveMatch(null);
          mpSavedGameIdRef.current = null;
          mpWroteOutcomeRef.current = null;
          setView('friend-lobby');
        }
        function reviewMatch() {
          if (!mpSync) return;
          // Snapshot the match log so leaving the live match doesn't pull
          // the data out from under the review screen. classifyAsync will
          // populate per-move analysis on the fly inside GameReview.
          setActiveReviewLog(deriveMpLog(mpSync.matchState));
          setActiveReviewMeta({
            playerName: displayName ?? 'You',
            opponentName: mpSync.opponentDisplayName,
            outcome: myView,
          });
          setMpEndOutcome(null);
          setActiveMatch(null);
          setView('review');
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

      {summaryOpen && lastGamePoints && gameOutcome && (
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
            setConfirmingResign(true);
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
